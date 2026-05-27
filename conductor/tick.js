// Publishes a bar.tick event to Redis on every musical bar boundary.
// Agents subscribe to this to align their proposed pattern edits.
//
// Uses an absolute-time scheduler (bar N fires at startedAt + N*barMs)
// instead of setInterval so the cadence doesn't drift after long runs
// or after the event loop blocks for GC / I/O.

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const SESSION_ID = process.env.SESSION_ID || "session-001";
const BPM = Number(process.env.BPM || 110);
const BEATS_PER_BAR = Number(process.env.BEATS_PER_BAR || 4);

const barMs = (60_000 / BPM) * BEATS_PER_BAR;
const pub = new Redis(REDIS_URL);

const startedAt = Date.now();

pub.publish(
  "session.start",
  JSON.stringify({ session: SESSION_ID, bpm: BPM, beatsPerBar: BEATS_PER_BAR, startedAt })
);
console.log(`conductor: session=${SESSION_ID} bpm=${BPM} bar=${barMs.toFixed(1)}ms`);

let bar = 0;
function scheduleNext() {
  bar += 1;
  const nextAt = startedAt + bar * barMs;
  const delay = Math.max(0, nextAt - Date.now());
  setTimeout(fire, delay);
}
function fire() {
  pub.publish(
    "bar.tick",
    JSON.stringify({ session: SESSION_ID, bar, bpm: BPM, beatsPerBar: BEATS_PER_BAR, t: Date.now() })
  );
  scheduleNext();
}
scheduleNext();
