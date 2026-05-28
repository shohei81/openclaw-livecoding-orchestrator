import express from "express";
import { WebSocketServer } from "ws";
import Redis from "ioredis";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const SESSION_ID = process.env.SESSION_ID || "session-001";

const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "src")));
app.use("/session", express.static(path.join(__dirname, "session")));

// User chat → Redis. Browser POSTs a directive here, we publish it as a
// `user.message` event that agents subscribe to (treated as a 5th peer).
const pub = new Redis(REDIS_URL);
app.post("/user-message", async (req, res) => {
  const text = String(req.body?.text || "").slice(0, 500).trim();
  if (!text) return res.status(400).json({ ok: false, error: "empty" });
  await pub.publish(
    "user.message",
    JSON.stringify({ session: SESSION_ID, text, t: Date.now() })
  );
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set();
// Latest committed code per agent, kept so a reloaded browser sees the
// current performance state instead of an empty canvas.
const latestByAgent = new Map();
// Recent user directives (cap so reload-replay stays bounded).
const recentUserMessages = [];
const MAX_USER_MESSAGES = 50;

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.send(JSON.stringify({ type: "hello", session: SESSION_ID }));
  for (const msg of latestByAgent.values()) {
    ws.send(JSON.stringify({ type: "pattern.committed", ...msg }));
  }
  for (const msg of recentUserMessages) {
    ws.send(JSON.stringify({ type: "user.message", ...msg }));
  }
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

const sub = new Redis(REDIS_URL);
sub.subscribe("pattern.committed", "bar.tick", "user.message", (err) => {
  if (err) console.error("redis subscribe error", err);
});
sub.on("message", (channel, raw) => {
  try {
    const msg = JSON.parse(raw);
    if (msg.session && msg.session !== SESSION_ID) return;
    if (channel === "pattern.committed" && msg.agent) {
      latestByAgent.set(msg.agent, msg);
    }
    if (channel === "user.message") {
      recentUserMessages.push(msg);
      if (recentUserMessages.length > MAX_USER_MESSAGES) recentUserMessages.shift();
    }
    broadcast({ type: channel, ...msg });
  } catch (e) {
    console.error("bad redis message", channel, raw);
  }
});

server.listen(PORT, () => {
  console.log(`livecoding-host on :${PORT}, session=${SESSION_ID}`);
});
