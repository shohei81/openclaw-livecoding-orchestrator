// Loads Strudel + Hydra from CDN and wires a WebSocket for hot-eval.
// On committed pattern messages from Redis (forwarded by the host),
// the corresponding engine (strudel | hydra) re-evaluates the code.
// Strudel's REPL aligns the pattern swap to the next cycle automatically.

import { initStrudel, evaluate, samples } from "https://cdn.jsdelivr.net/npm/@strudel/web@1.3.0/dist/index.mjs";
// Hydra comes from a UMD <script> tag in index.html (window.Hydra).
const Hydra = window.Hydra;

const statusEl = document.getElementById("status");
const panes = Object.fromEntries(
  [...document.querySelectorAll(".pane")].map((el) => [el.dataset.agent, el.querySelector("pre")])
);

// ---- Chat sidebar ----
// Append-only log of each agent's INTENT line. Each commit yields one chat
// line; never trimmed (a long session can scroll back).
const AGENT_EMOJI = {
  "strudel-drums": "🥁",
  "strudel-bass": "🎸",
  "strudel-lead": "🎹",
  "hydra": "🌀",
  "user": "🎙️",
};
const AGENT_SHORT = {
  "strudel-drums": "drums",
  "strudel-bass": "bass",
  "strudel-lead": "lead",
  "hydra": "hydra",
  "user": "you",
};
const chatLog = document.getElementById("chat-log");
function appendChat(agent, intent) {
  const li = document.createElement("li");
  li.className = AGENT_SHORT[agent] || agent;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  li.innerHTML = `<span class="who">${AGENT_EMOJI[agent] || ""} ${AGENT_SHORT[agent] || agent}</span>` +
                 `<span class="text"></span>` +
                 `<span class="when">${time}</span>`;
  li.querySelector(".text").textContent = intent;
  chatLog.appendChild(li);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---- Strudel ----
// Three Strudel agents share a single scheduler. Each agent owns a named
// slot; we stack the live slots into one program and re-evaluate when any
// of them changes. Strudel aligns the swap to the next cycle internally.
const strudelSlots = { "strudel-drums": null, "strudel-bass": null, "strudel-lead": null };
let strudelReady = false;

const diagEl = document.getElementById("diag");
function updateDiag() {
  const ctx = window.__strudelCtx || null;
  const audio = ctx ? ctx.state : "no-ctx";
  const hydraOk = typeof window.osc === "function" ? "ok" : "missing";
  diagEl.textContent = `audio: ${audio} | hydra: ${hydraOk}`;
}
setInterval(updateDiag, 500);

// Start overlay: explicit user gesture to resume AudioContext + kick Hydra.
const startOverlay = document.getElementById("start-overlay");
startOverlay.addEventListener("click", async () => {
  // 1) Resume any existing AudioContexts on the page.
  // Strudel/superdough creates its own. We try to discover it.
  const allCtxs = [];
  try {
    if (window.getAudioContext) allCtxs.push(window.getAudioContext());
  } catch {}
  if (window.__strudelCtx) allCtxs.push(window.__strudelCtx);
  for (const ctx of allCtxs) {
    if (ctx?.state === "suspended") {
      await ctx.resume();
      console.log("resumed AudioContext", ctx);
    }
  }
  // 2) Sanity test tone via raw WebAudio (independent of Strudel).
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    window.__strudelCtx = window.__strudelCtx || ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.15;
    o.frequency.value = 440;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
    console.log("test tone fired, ctx.state=", ctx.state);
  } catch (e) {
    console.error("test tone failed", e);
  }
  // 3) Kick Hydra with a known-good pattern.
  try {
    runHydra("osc(30, 0.05, 1.5).out(o0)");
  } catch (e) {
    console.error("hydra kick failed", e);
  }
  startOverlay.remove();
});

initStrudel({
  prebake: async () => {
    try {
      await samples("github:tidalcycles/dirt-samples");
    } catch (e) {
      console.warn("prebake: github:tidalcycles/dirt-samples failed, retrying URL", e?.message);
      await samples("https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json");
    }
  },
}).then(() => {
  strudelReady = true;
  console.log("strudel ready");
  rebuildStrudelStack();
});

// The validator guarantees each agent commits a single Strudel expression,
// so we just parenthesize and stack. Returns true on successful eval.
function rebuildStrudelStack() {
  if (!strudelReady) return false;
  const parts = Object.values(strudelSlots).filter((c) => c && c.trim()).map((c) => `(${c.trim()})`);
  const code = parts.length ? `stack(\n${parts.join(",\n")}\n)` : "silence";
  try {
    evaluate(code);
    return true;
  } catch (e) {
    console.error("strudel eval failed:", e.message, "\ncode:\n", code);
    return false;
  }
}

// Try a new code for an agent's slot; if Strudel rejects (mini-notation
// parse error, semantic issue the syntax validator can't catch), roll back
// so the other agents' patterns aren't dragged down by one broken slot.
function trySetStrudelSlot(agent, newCode) {
  const oldCode = strudelSlots[agent];
  strudelSlots[agent] = newCode;
  if (!rebuildStrudelStack()) {
    console.warn(`[${agent}] rolled back to previous slot value`);
    strudelSlots[agent] = oldCode;
    rebuildStrudelStack();
  }
}

// ---- Hydra ----
const hydraCanvas = document.getElementById("hydra");
// Set the canvas backing-store size BEFORE constructing Hydra, then let Hydra
// own it. Resizes go through hydra.setResolution() so regl stays in sync.
hydraCanvas.width = window.innerWidth;
hydraCanvas.height = window.innerHeight;

const hydra = new Hydra({
  canvas: hydraCanvas,
  detectAudio: false,
  makeGlobal: true,
  autoLoop: true,
  enableStreamCapture: false,
});
// Hydra's EvalSandbox copies window[speed|update|bpm|fps] into synth each
// tick. Strudel overwrites window.speed with a Pattern function, which made
// synth.speed a non-number and synth.time NaN. Neutralize the sync — synth
// keeps its construction-time defaults (speed=1, bpm=30, update=noop).
hydra.sandbox.tick = () => {};
window.__hydra = hydra;
console.log(
  "hydra ready; tick=", typeof hydra.tick,
  "synth=", typeof hydra.synth,
  "o=", Array.isArray(hydra.o), hydra.o?.length,
);

window.addEventListener("resize", () => {
  try { hydra.setResolution(window.innerWidth, window.innerHeight); } catch (e) { console.error(e); }
});

// Baseline pattern so the canvas is never empty even before any agent commits.
try {
  window.osc(20, 0.05, 1).out(window.o0);
  console.log("hydra baseline issued");
} catch (e) {
  console.error("hydra baseline failed", e);
}


function runHydra(code) {
  if (!hydra) return;
  // hydra.eval ultimately runs globalThis.eval, which sees whichever module
  // installed names on window last. Strudel may have stolen `noise`, so for
  // every agent edit we restore Hydra's source/transform functions on window
  // before evaluating. The list is generated from hydra.synth at runtime.
  try {
    for (const k of Object.keys(hydra.synth)) {
      const v = hydra.synth[k];
      if (typeof v === "function") window[k] = v;
    }
    for (let i = 0; i < hydra.o.length; i++) window["o" + i] = hydra.o[i];
    for (let i = 0; i < hydra.s.length; i++) window["s" + i] = hydra.s[i];
    hydra.eval(code);
    console.log("hydra eval ok");
  } catch (e) {
    console.error("hydra eval failed", e, "code:", code);
  }
}

// ---- User chat input ----
// Submit posts to /user-message; the server publishes user.message on Redis,
// every agent (and this browser via WS echo) receives it. We don't append
// locally — wait for the WS echo so all clients see the same message order.
const chatForm = document.getElementById("chat-input-form");
const chatInput = document.getElementById("chat-input");
chatForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  try {
    await fetch("/user-message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("user-message post failed", err);
  }
});

// ---- WebSocket ----
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => (statusEl.textContent = "connected");
  ws.onclose = () => {
    statusEl.textContent = "disconnected — retrying";
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === "pattern.committed") {
      const { agent, code, intent } = msg;
      if (panes[agent]) panes[agent].textContent = code;
      if (intent) appendChat(agent, intent);
      if (agent === "hydra") {
        runHydra(code);
      } else if (agent in strudelSlots) {
        trySetStrudelSlot(agent, code);
      }
    } else if (msg.type === "user.message") {
      appendChat("user", msg.text);
    } else if (msg.type === "bar.tick") {
      statusEl.textContent = `bar ${msg.bar} @ ${msg.bpm} bpm`;
    }
  };
}
connect();
