// Subscribes to every interesting Redis channel and appends one JSON record
// per event to session/<id>/transcript.jsonl. Lets us replay or analyze a
// session after the fact.

import Redis from "ioredis";
import fs from "node:fs";
import path from "node:path";

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const SESSION_ID = process.env.SESSION_ID || "session-001";
const SESSION_DIR = process.env.SESSION_DIR || "/session";

const CHANNELS = [
  "session.start",
  "bar.tick",
  "pattern.proposed",
  "pattern.committed",
  "pattern.rejected",
];

const outDir = path.join(SESSION_DIR, SESSION_ID);
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "transcript.jsonl");
const out = fs.createWriteStream(outPath, { flags: "a" });

const sub = new Redis(REDIS_URL, { enableReadyCheck: false });
await sub.subscribe(...CHANNELS);

sub.on("message", (channel, raw) => {
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { _rawString: raw }; }
  if (payload.session && payload.session !== SESSION_ID) return;
  const line = JSON.stringify({ t: Date.now(), channel, ...payload });
  out.write(line + "\n");
});

console.log(`observer: writing ${outPath} (channels: ${CHANNELS.join(", ")})`);

const flushAndExit = () => {
  out.end(() => process.exit(0));
};
process.on("SIGTERM", flushAndExit);
process.on("SIGINT", flushAndExit);
