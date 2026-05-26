// Generic livecoding agent loop.
// One instance per role. Subscribes to bar.tick, periodically generates a new
// Strudel/Hydra snippet via NIM, validates, and publishes to Redis.

import Redis from "ioredis";
import fs from "node:fs/promises";
import path from "node:path";
import { chat, extractCode } from "./nim.js";

const {
  AGENT_ID,
  AGENT_ROLE,                       // "strudel" | "hydra"
  PROMPT_PATH = "/prompt.md",
  REDIS_URL = "redis://redis:6379",
  VALIDATOR_URL = "http://validator:8081",
  SESSION_ID = "session-001",
  SESSION_DIR = "/session",
  NVIDIA_API_KEY,
  NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1",
  NVIDIA_MODEL = "qwen/qwen2.5-coder-32b-instruct",
  EDIT_EVERY_N_BARS = "8",
  EDIT_PHASE_OFFSET = "0",
  TEMPERATURE = "0.8",
} = process.env;

if (!AGENT_ID) throw new Error("AGENT_ID required");
if (!AGENT_ROLE) throw new Error("AGENT_ROLE required");
if (!NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY required");

const editEvery = Math.max(1, Number(EDIT_EVERY_N_BARS));
const phase = Number(EDIT_PHASE_OFFSET) % editEvery;
const temperature = Number(TEMPERATURE);

const pub = new Redis(REDIS_URL);
const sub = new Redis(REDIS_URL);

// Latest committed code from every agent (including ourselves), for context.
const peers = {};
let currentCode = null;
let busy = false;

const rolePrompt = await fs.readFile(PROMPT_PATH, "utf8").catch(() => {
  console.warn(`[${AGENT_ID}] no prompt at ${PROMPT_PATH}, using empty role`);
  return "";
});

const systemPrompt = `${rolePrompt.trim()}

Output ONLY raw ${AGENT_ROLE === "hydra" ? "Hydra (hydra-synth)" : "Strudel"} code.
No prose, no markdown, no commentary. The output is fed directly to eval().
Keep it short — a few lines.`;

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
      await generateAndPublish(bar);
    } catch (e) {
      console.error(`[${AGENT_ID}] cycle failed:`, e.message);
    } finally {
      busy = false;
    }
  }
});

async function generateAndPublish(bar) {
  const userPrompt = buildUserPrompt(bar);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  let raw;
  try {
    raw = await chat({
      baseUrl: NVIDIA_BASE_URL,
      apiKey: NVIDIA_API_KEY,
      model: NVIDIA_MODEL,
      system: systemPrompt,
      user: userPrompt,
      temperature,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

function buildUserPrompt(bar) {
  const peerLines = Object.entries(peers)
    .filter(([id]) => id !== AGENT_ID)
    .map(([id, c]) => `--- ${id} ---\n${c}`)
    .join("\n");
  const self = currentCode ? `--- your previous code ---\n${currentCode}` : "(no previous code)";
  return [
    `bar: ${bar}`,
    peerLines ? `other agents currently playing:\n${peerLines}` : "no other agents yet",
    self,
    `Write the next iteration of your ${AGENT_ROLE} part. Keep musical/visual coherence with the others. Small evolution is preferred over rewrites.`,
  ].join("\n\n");
}

async function writeSessionFile(code) {
  const dir = path.join(SESSION_DIR, SESSION_ID, AGENT_ID);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "current.js"), code);
}

console.log(`[${AGENT_ID}] ready. role=${AGENT_ROLE} model=${NVIDIA_MODEL} every=${editEvery}bars phase=${phase}`);
