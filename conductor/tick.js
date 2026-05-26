// Publishes a bar.tick event to Redis on every musical bar boundary.
// Agents subscribe to this to align their proposed pattern edits.

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const SESSION_ID = process.env.SESSION_ID || "session-001";
const BPM = Number(process.env.BPM || 110);
const BEATS_PER_BAR = Number(process.env.BEATS_PER_BAR || 4);

const barMs = (60_000 / BPM) * BEATS_PER_BAR;
const pub = new Redis(REDIS_URL);

let bar = 0;
const startedAt = Date.now();

pub.publish(
  "session.start",
  JSON.stringify({ session: SESSION_ID, bpm: BPM, beatsPerBar: BEATS_PER_BAR, startedAt })
);
console.log(`conductor: session=${SESSION_ID} bpm=${BPM} bar=${barMs.toFixed(1)}ms`);

setInterval(() => {
  bar += 1;
  pub.publish(
    "bar.tick",
    JSON.stringify({ session: SESSION_ID, bar, bpm: BPM, beatsPerBar: BEATS_PER_BAR, t: Date.now() })
  );
}, barMs);
