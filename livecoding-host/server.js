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
app.use(express.static(path.join(__dirname, "src")));
app.use("/session", express.static(path.join(__dirname, "session")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set();
// Latest committed code per agent, kept so a reloaded browser sees the
// current performance state instead of an empty canvas.
const latestByAgent = new Map();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.send(JSON.stringify({ type: "hello", session: SESSION_ID }));
  for (const msg of latestByAgent.values()) {
    ws.send(JSON.stringify({ type: "pattern.committed", ...msg }));
  }
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

const sub = new Redis(REDIS_URL);
sub.subscribe("pattern.committed", "bar.tick", (err) => {
  if (err) console.error("redis subscribe error", err);
});
sub.on("message", (channel, raw) => {
  try {
    const msg = JSON.parse(raw);
    if (msg.session && msg.session !== SESSION_ID) return;
    if (channel === "pattern.committed" && msg.agent) {
      latestByAgent.set(msg.agent, msg);
    }
    broadcast({ type: channel, ...msg });
  } catch (e) {
    console.error("bad redis message", channel, raw);
  }
});

server.listen(PORT, () => {
  console.log(`livecoding-host on :${PORT}, session=${SESSION_ID}`);
});
