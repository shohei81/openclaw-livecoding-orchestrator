// Phase (a) agent loop: drive OpenClaw via `openclaw agent --message ...`
// instead of calling NIM directly. The role + reference live in the workspace
// (AGENTS.md is auto-injected into the system prompt by OpenClaw).

import Redis from "ioredis";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const {
  AGENT_ID,
  AGENT_ROLE,
  REDIS_URL = "redis://redis:6379",
  VALIDATOR_URL = "http://validator:8081",
  SESSION_ID = "session-001",
  SESSION_DIR = "/session",
  OPENCLAW_BIN = "/usr/local/bin/openclaw",
  OPENCLAW_AGENT_ID = "main",
  OPENCLAW_THINKING = "low",
  OPENCLAW_TIMEOUT_MS = "60000",
  EDIT_EVERY_N_BARS = "16",
  EDIT_PHASE_OFFSET = "0",
  LLM_MODEL = "", // empty = use openclaw.json's primary; otherwise --model override
} = process.env;

if (!AGENT_ID) throw new Error("AGENT_ID required");
if (!AGENT_ROLE) throw new Error("AGENT_ROLE required");

const editEvery = Math.max(1, Number(EDIT_EVERY_N_BARS));
const phase = Number(EDIT_PHASE_OFFSET) % editEvery;
const openclawTimeoutMs = Number(OPENCLAW_TIMEOUT_MS);

const pub = new Redis(REDIS_URL, { enableReadyCheck: false });
const sub = new Redis(REDIS_URL, { enableReadyCheck: false });

const peers = {};
let currentCode = null;
let busy = false;

await sub.subscribe("bar.tick", "pattern.committed", "session.start");
sub.on("message", async (channel, raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.session && msg.session !== SESSION_ID) return;

  if (channel === "pattern.committed") {
    peers[msg.agent] = { code: msg.code, intent: msg.intent || null };
    return;
  }
  if (channel === "bar.tick") {
    const bar = Number(msg.bar) || 0;
    if (bar % editEvery !== phase) return;
    if (busy) { console.log(`[${AGENT_ID}] bar=${bar} skipped (busy)`); return; }
    busy = true;
    console.log(`[${AGENT_ID}] bar=${bar} cycle starting`);
    try {
      await cycle(bar);
    } catch (e) {
      console.error(`[${AGENT_ID}] cycle failed:`, e.message);
    } finally {
      busy = false;
    }
  }
});

async function cycle(bar) {
  const message = buildPromptMessage(bar);
  console.log(`[${AGENT_ID}] bar=${bar} invoking openclaw agent (msg ${message.length} chars)`);
  const t0 = Date.now();
  const raw = await runOpenClawAgent(message);
  console.log(`[${AGENT_ID}] bar=${bar} openclaw returned in ${Date.now()-t0}ms (${raw.length} chars)`);
  const code = extractCode(raw);
  const intent = extractIntent(raw);

  const v = await fetch(`${VALIDATOR_URL}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, lang: AGENT_ROLE }),
  }).then((r) => r.json());

  if (!v.ok) {
    console.log(`[${AGENT_ID}] bar=${bar} rejected: ${v.error}`);
    await pub.publish(
      "pattern.rejected",
      JSON.stringify({ session: SESSION_ID, agent: AGENT_ID, code, error: v.error, bar })
    );
    return;
  }

  await writeSessionFile(code);
  currentCode = code;
  console.log(`[${AGENT_ID}] bar=${bar} committed (${code.length} chars)${intent ? ` intent="${intent}"` : ""}`);
  await pub.publish(
    "pattern.committed",
    JSON.stringify({ session: SESSION_ID, agent: AGENT_ID, code, intent, bar })
  );
}

function buildPromptMessage(bar) {
  const peerLines = Object.entries(peers)
    .filter(([id]) => id !== AGENT_ID)
    .map(([id, p]) => {
      // Old runs stored peers[id] as a bare string; new runs store { code, intent }.
      // Tolerate both during the transition.
      const code = typeof p === "string" ? p : p?.code ?? "";
      const intent = typeof p === "string" ? null : p?.intent ?? null;
      return `--- ${id} ---${intent ? `\nintent: ${intent}` : ""}\n${code}`;
    })
    .join("\n\n");
  const self = currentCode ? `--- your previous code ---\n${currentCode}` : "(no previous code)";
  return [
    `bar: ${bar}`,
    peerLines ? `other agents currently playing (intent + code):\n${peerLines}` : "no other agents yet",
    self,
    `Write the next iteration of your part. Output EXACTLY two lines:\n` +
      `  Line 1: \`INTENT: <one short sentence — react to what the others said>\`\n` +
      `  Line 2: ONE ${AGENT_ROLE === "hydra" ? "Hydra" : "Strudel"} expression on a single line. No prose, no markdown, no <thinking> blocks.`,
  ].join("\n\n");
}

function runOpenClawAgent(message) {
  return new Promise((resolve, reject) => {
    // Pin a stable --session-key so OpenClaw doesn't try to resolve "current"
    // (which fails with "No session found: current" when no channel sent a
    // message recently). The same key is reused across cycles so the agent
    // accumulates session memory of its previous patterns.
    const sessionKey = `agent:${OPENCLAW_AGENT_ID}:livecoding-${SESSION_ID}`;
    const args = [
      "agent",
      "--agent", OPENCLAW_AGENT_ID,
      "--session-key", sessionKey,
      "--thinking", OPENCLAW_THINKING,
      ...(LLM_MODEL ? ["--model", LLM_MODEL] : []),
      "--message", message,
    ];
    const child = spawn(OPENCLAW_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`openclaw agent timed out after ${openclawTimeoutMs}ms`));
    }, openclawTimeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`openclaw agent exit ${code}: ${Buffer.concat(err).toString().slice(0, 300)}`));
      }
      resolve(Buffer.concat(out).toString());
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// Gemini 2.5 Flash often emits prose with the code appended to the final
// sentence WITHOUT a newline (e.g. "...slower lead.note(\"a2\")..."), AND a
// fully-formed expression contains nested calls (noise(...) inside
// modulate(...)). Both naive line-splitting and "last top-token" pick the
// wrong piece. Strategy: scan all top-token starts at word boundary, build
// the full balanced-paren expression (plus any chained .method(...) calls)
// at each, and pick the LONGEST valid candidate. The longest match in a
// noisy response is almost always the outermost code expression.
const TOP_TOKEN_RE =
  /\b(?:stack|cat|seq|note|n|s|freq|osc|noise|voronoi|shape|gradient|solid|src|silence)\b/g;

function readBalancedExpr(s, start) {
  // Expect ident, then optional `(...)`, then any number of `.ident(...)` chains.
  let i = start;
  while (i < s.length && /[\w$]/.test(s[i])) i++;
  if (s[i] !== "(") return null;
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { i++; break; }
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === "\\") i++;
        i++;
      }
    } else if (c === "\n") return null; // expression broke before closing
  }
  if (depth !== 0) return null;
  // Chained calls: .method(...)
  while (s[i] === "." && /[A-Za-z_$]/.test(s[i + 1] || "")) {
    let j = i + 1;
    while (j < s.length && /[\w$]/.test(s[j])) j++;
    if (s[j] !== "(") break;
    let d = 0;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === "(") d++;
      else if (c === ")") {
        d--;
        if (d === 0) { j++; break; }
      } else if (c === '"' || c === "'" || c === "`") {
        const q = c;
        j++;
        while (j < s.length && s[j] !== q) {
          if (s[j] === "\\") j++;
          j++;
        }
      } else if (c === "\n") return null;
    }
    if (d !== 0) return null;
    i = j;
  }
  return s.slice(start, i);
}

function extractCode(raw) {
  let s = raw.trim();
  const fence = s.match(/```(?:[a-zA-Z0-9_+\-]*)\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();

  let best = null;
  for (const m of s.matchAll(TOP_TOKEN_RE)) {
    const expr = readBalancedExpr(s, m.index);
    if (expr && (!best || expr.length > best.length)) best = expr;
  }
  return (best || s).trim();
}

// Agents are asked to prefix each response with `INTENT: <one short sentence>`
// so we can show what they're thinking in the side chat. The line may appear
// anywhere in a long reasoning blob (Gemini sometimes wraps it); we grab the
// first match and cap the length so a runaway model can't flood the UI.
function extractIntent(raw) {
  const m = raw.match(/^\s*INTENT\s*[:：]\s*(.+?)\s*$/im);
  if (!m) return null;
  return m[1].replace(/^[`"']|[`"']$/g, "").slice(0, 200);
}

async function writeSessionFile(code) {
  const dir = path.join(SESSION_DIR, SESSION_ID, AGENT_ID);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "current.js"), code);
}

console.log(`[${AGENT_ID}] ready. role=${AGENT_ROLE} every=${editEvery}bars phase=${phase} (driving openclaw on loopback)`);
