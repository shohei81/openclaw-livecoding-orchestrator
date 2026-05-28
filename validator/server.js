// Lightweight pre-flight check for Strudel / Hydra code.
// This service does NOT fully simulate either engine — it catches the
// cheap failure modes (syntax errors, obviously-undefined references)
// before the host page wastes a bar boundary on broken code.
// Deeper validation (1-cycle dry-eval) is intentionally deferred until
// we know it's worth the complexity.

import express from "express";
import * as acorn from "acorn";

const PORT = process.env.PORT || 8081;
const app = express();
app.use(express.json({ limit: "256kb" }));

const STRUDEL_GLOBALS = new Set([
  "stack", "cat", "seq", "n", "s", "note", "sound", "freq", "saw", "sine", "square", "tri",
  "lpf", "hpf", "room", "delay", "gain", "pan", "speed", "rev", "jux", "every", "slow", "fast",
  "struct", "euclid", "chop", "fold", "iter", "off", "ply", "scale", "silence", "polyrhythm",
  "_", "Math", "Array", "Object",
]);

const HYDRA_GLOBALS = new Set([
  "osc", "noise", "voronoi", "shape", "gradient", "solid", "src", "out", "o0", "o1", "o2", "o3",
  "s0", "s1", "s2", "s3", "render", "speed", "time", "mouse",
  "rotate", "scale", "kaleid", "pixelate", "repeat", "modulate", "modulateRotate", "modulateScale",
  "modulatePixelate", "diff", "add", "mult", "blend", "layer", "mask", "color", "colorama", "invert",
  "contrast", "brightness", "luma", "thresh", "shift", "saturate", "hue", "posterize",
  "Math", "Array",
]);

function checkSyntax(code) {
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  } catch (e) {
    return `syntax: ${e.message}`;
  }
  // Enforce single top-level expression. Multiple statements or comma-operator
  // sequences break the host's stack-wrap step and produce silent failures.
  if (ast.body.length !== 1) {
    return `expected 1 top-level statement, got ${ast.body.length}`;
  }
  const stmt = ast.body[0];
  if (stmt.type !== "ExpressionStatement") {
    return `expected ExpressionStatement, got ${stmt.type}`;
  }
  if (stmt.expression.type === "SequenceExpression") {
    return "use stack(a, b, c) instead of (a, b, c) — bare commas are the comma operator";
  }
  return null;
}

// Strip string and template literals so the identifier check doesn't pick up
// names that live INSIDE mini-notation. Without this, code like
// `s("hh(3,8)")` matched the regex's `hh(` and `hh` was reported as an
// unknown function call even though it's just a sample name in a string.
function stripStrings(code) {
  return code.replace(/(['"`])(?:\\.|(?!\1).)*\1/gs, '""');
}

function checkIdentifiers(code, allowed) {
  // Cheap heuristic: surface unknown bare identifiers that look like top-level calls.
  // This is conservative — false positives are fine, the agent just retries.
  const stripped = stripStrings(code);
  const ids = new Set();
  const re = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(stripped)) !== null) ids.add(m[1]);
  const unknown = [...ids].filter((id) => !allowed.has(id));
  if (unknown.length) return `unknown identifiers: ${unknown.slice(0, 5).join(", ")}`;
  return null;
}

app.post("/validate", (req, res) => {
  const { code, lang } = req.body || {};
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ ok: false, error: "empty code" });
  }
  if (lang !== "strudel" && lang !== "hydra") {
    return res.status(400).json({ ok: false, error: "lang must be strudel|hydra" });
  }
  const synErr = checkSyntax(code);
  if (synErr) return res.json({ ok: false, error: synErr });

  const allowed = lang === "strudel" ? STRUDEL_GLOBALS : HYDRA_GLOBALS;
  const idErr = checkIdentifiers(code, allowed);
  if (idErr) return res.json({ ok: false, error: idErr });

  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`validator on :${PORT}`));
