// Loads Strudel + Hydra from CDN and wires a WebSocket for hot-eval.
// On committed pattern messages from Redis (forwarded by the host),
// the corresponding engine (strudel | hydra) re-evaluates the code.
// Strudel's REPL aligns the pattern swap to the next cycle automatically.

import { initStrudel, evaluate, samples, silence } from "https://cdn.jsdelivr.net/npm/@strudel/web@1.3.0/dist/index.mjs";
// Hydra comes from a UMD <script> tag in index.html (window.Hydra).
const Hydra = window.Hydra;

const statusEl = document.getElementById("status");
const panes = Object.fromEntries(
  [...document.querySelectorAll(".pane")].map((el) => [el.dataset.agent, el.querySelector("pre")])
);

// ---- Strudel ----
// Three Strudel agents share a single scheduler. Each agent owns a named
// slot; we stack the live slots into one program and re-evaluate when any
// of them changes. Strudel aligns the swap to the next cycle internally.
const strudelSlots = { "strudel-drums": null, "strudel-bass": null, "strudel-lead": null };
let strudelReady = false;

// Expose helpers for browser-console diagnostics.
window.__strudel = { samples, evaluate, silence };

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
    console.log("[prebake] loading samples...");
    try {
      const r = await samples("github:tidalcycles/dirt-samples");
      console.log("[prebake] samples() resolved:", r);
    } catch (e) {
      console.error("[prebake] samples() failed:", e);
      // Fallback: try the fully-qualified URL form
      try {
        const r2 = await samples(
          "https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json"
        );
        console.log("[prebake] fallback URL samples() resolved:", r2);
      } catch (e2) {
        console.error("[prebake] fallback samples() also failed:", e2);
      }
    }
  },
}).then(() => {
  strudelReady = true;
  console.log("strudel ready");
  rebuildStrudelStack();
});

function rebuildStrudelStack() {
  if (!strudelReady) return;
  const parts = Object.values(strudelSlots).filter((s) => s && s.trim());
  const code = parts.length ? `stack(\n${parts.map((p) => `  (${p})`).join(",\n")}\n)` : "silence";
  try {
    evaluate(code);
  } catch (e) {
    console.error("strudel eval failed", e);
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
      const { agent, code } = msg;
      if (panes[agent]) panes[agent].textContent = code;
      if (agent === "hydra") {
        runHydra(code);
      } else if (agent in strudelSlots) {
        strudelSlots[agent] = code;
        rebuildStrudelStack();
      }
    } else if (msg.type === "bar.tick") {
      statusEl.textContent = `bar ${msg.bar} @ ${msg.bpm} bpm`;
    }
  };
}
connect();
