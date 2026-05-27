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
    peers[msg.agent] = msg.code;
    return;
  }
  if (channel === "bar.tick") {
    const bar = Number(msg.bar) || 0;
    if (bar % editEvery !== phase) return;
    if (busy) return;
    busy = true;
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
  const raw = await runOpenClawAgent(message);
  const code = extractCode(raw);

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
  console.log(`[${AGENT_ID}] bar=${bar} committed (${code.length} chars)`);
  await pub.publish(
    "pattern.committed",
    JSON.stringify({ session: SESSION_ID, agent: AGENT_ID, code, bar })
  );
}

function buildPromptMessage(bar) {
  const peerLines = Object.entries(peers)
    .filter(([id]) => id !== AGENT_ID)
    .map(([id, c]) => `--- ${id} ---\n${c}`)
    .join("\n");
  const self = currentCode ? `--- your previous code ---\n${currentCode}` : "(no previous code)";
  return [
    `bar: ${bar}`,
    peerLines ? `other agents currently playing:\n${peerLines}` : "no other agents yet",
    self,
    `Write the next iteration of your part as ONE ${AGENT_ROLE === "hydra" ? "Hydra" : "Strudel"} expression. Output ONLY the code — no prose, no markdown.`,
  ].join("\n\n");
}

function runOpenClawAgent(message) {
  return new Promise((resolve, reject) => {
    const args = [
      "agent",
      "--agent", OPENCLAW_AGENT_ID,
      "--thinking", OPENCLAW_THINKING,
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

function extractCode(raw) {
  let s = raw.trim();
  const fence = s.match(/```(?:[a-zA-Z0-9_+\-]*)\s*([\s\S]*?)```/);
  if (fence) s = fence[1];
  return s.trim();
}

async function writeSessionFile(code) {
  const dir = path.join(SESSION_DIR, SESSION_ID, AGENT_ID);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "current.js"), code);
}

console.log(`[${AGENT_ID}] ready. role=${AGENT_ROLE} every=${editEvery}bars phase=${phase} (driving openclaw on loopback)`);
