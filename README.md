# openclaw-livecoding-orchestrator

Experimental repo. **Run four [OpenClaw](https://github.com/openclaw/openclaw) gateways in parallel via docker compose to orchestrate a local Strudel + Hydra live-coding session.** Each agent is its own OpenClaw Gateway container. The LLM is **Google Gemini 2.5 Flash**.

## Demo



https://github.com/user-attachments/assets/00cc6f6e-f309-4d0e-83a5-5c1feda4f1eb



(30s recording: four agents jamming, with their intent posted live in the right-side chat.)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Host Chrome  →  http://localhost:8080                      │
│  (Strudel + Hydra hot-eval in one page)                     │
└────────────▲────────────────────────────────────────────────┘
             │ WebSocket (pattern.committed events)
┌────────────┴──────────┐   ┌──────────────┐   ┌────────────┐
│   livecoding-host     │   │   validator  │   │  conductor │
│  (Express + WS + SPA) │   │  (acorn      │   │  (bar.tick │
│                       │   │   + ident.)  │   │   publish) │
└──────▲────────────────┘   └──────▲───────┘   └─────┬──────┘
       │                           │                 │
       │ pattern.committed         │ POST /validate  │ bar.tick
       │                           │                 │
       │                ┌──────────┴─────────────────▼───────┐
       │                │            Redis pub/sub            │
       │                └─┬──────────┬──────────┬───────────┬─┘
       │                  │          │          │           │
       │       ┌──────────▼──┐ ┌─────▼────┐ ┌───▼─────┐ ┌──▼───┐
       └───────┤ strudel-    │ │ strudel- │ │ strudel-│ │hydra │
               │  drums      │ │  bass    │ │  lead   │ │      │
               │ (OpenClaw + │ │(OpenClaw │ │(OpenClaw│ │(OpenC│
               │  sidecar)   │ │ +sidecar)│ │ +sidecar│ │+side)│
               └─────────────┘ └──────────┘ └─────────┘ └──────┘
                          4 independent OpenClaw gateways
                          (Google Gemini 2.5 Flash)
```

Each agent container runs the **OpenClaw Gateway** and a **sidecar Node loop** under tini. The sidecar subscribes to `bar.tick` on Redis, and when its phase comes up it shells out to `openclaw agent --message "<context>"`, which routes through OpenClaw to Gemini and returns generated code.

An `observer` service also subscribes to every Redis channel and appends each event as one line of JSON to `session/<id>/transcript.jsonl` for later replay or analysis.

## Agent roles (fixed for now)

| Agent | Role | Prompt |
|---|---|---|
| strudel-drums | Drums / percussion | `agents/strudel-drums/prompt.md` |
| strudel-bass  | Bass / harmony     | `agents/strudel-bass/prompt.md`  |
| strudel-lead  | Lead / melody      | `agents/strudel-lead/prompt.md`  |
| hydra         | Visuals reacting to strudel | `agents/hydra/prompt.md` |

A **Strudel/Hydra reference** (`agents/_shared/*.md`) is concatenated in front of each role prompt to form the system prompt. The references are extracted from the official Strudel docs and from the hydra-synth source, so the model has authoritative syntax and signatures and is less likely to hallucinate operators that don't exist.

## Loop

```
[bar.tick]
   ↓
sidecar checks phase (fires when bar % 16 == phase)
   ↓
build context (your previous code + every other agent's latest committed)
   ↓
spawn `openclaw agent --message ...`
   ↓ (Gemini responds)
extractCode strips reasoning and pulls the single expression
   ↓
POST validator: parse + single-expression + known-identifier check
   ↓ ok
write session/<id>/<agent>/current.js
publish pattern.committed on Redis
   ↓
livecoding-host forwards over WebSocket
   ↓
browser's Strudel / Hydra evaluates at the next cycle boundary
```

If anything goes wrong, **the audio and visuals never stop**:
- validator rejects → that agent retries next tick, others stay put.
- browser eval throws → host rolls the slot back to its last-good value.
- LLM rate-limited → cycle logs the failure and tries again next tick.

## Run

### 1. Build the OpenClaw image (once)

```bash
git clone --depth 1 https://github.com/openclaw/openclaw.git third_party/openclaw
docker build -t openclaw:local ./third_party/openclaw   # 5–15 min
```

`third_party/` is gitignored.

### 2. Configure the LLM

```bash
cp .env.example .env
# edit .env: set LLM_MODEL and the matching provider key.
```

`LLM_MODEL` picks which LLM the agents use; only the corresponding API key has to be filled.

| Provider | `LLM_MODEL` example | API key env |
|---|---|---|
| Google Gemini | `google/gemini-2.5-flash` (default) | `GEMINI_API_KEY` ([get one](https://aistudio.google.com/apikey)) |
| OpenAI        | `openai/gpt-5.5`                    | `OPENAI_API_KEY` |
| Anthropic     | `anthropic/claude-sonnet-4-6`       | `ANTHROPIC_API_KEY` |
| NVIDIA NIM    | `nvidia/meta/llama-3.3-70b-instruct` | `NVIDIA_API_KEY` ([build.nvidia.com](https://build.nvidia.com)) |

`OPENCLAW_THINKING=off` is the safe default and is required for Gemini 2.5 Flash, Kimi K2.6, NIM Nemotron, and similar models that don't expose reasoning levels. OpenAI / Anthropic agent models accept `low`/`medium`/`high`.

### 3. Start

```bash
docker compose up -d
open http://localhost:8080
# click the start overlay (needed once to unlock AudioContext)
```

Within 30–40 seconds each agent should commit its first pattern; audio + visuals appear in the page.

Gateway auth tokens are generated at container startup by `entrypoint.sh` via `openssl rand -hex 32` and passed as `OPENCLAW_GATEWAY_TOKEN`, which both the gateway and the in-container CLI honor. Pin a fixed value by exporting `OPENCLAW_GATEWAY_TOKEN` in the env if you need restart-stable tokens.

## File layout

```
agents/
  loop/                       Sidecar loop image (FROM openclaw:local)
    Dockerfile / entrypoint.sh / loop.js / package.json
  homes/<agent-id>/           Mounted as /home/node/.openclaw
    openclaw.json             gateway + Gemini provider + agent definition
    workspace/AGENTS.md       Injected into the system prompt by OpenClaw
  <agent-id>/prompt.md        Role prompt (source of workspace/AGENTS.md)
  _shared/                    Strudel / Hydra reference cards
    strudel-reference.md
    hydra-reference.md
livecoding-host/              Serves the SPA, bridges Redis → WebSocket
  src/{index,app}.html/.js    Strudel @1.3.0 + Hydra @1.3.29 (UMD)
validator/                    acorn-based syntax + single-expression check
conductor/                    Publishes bar.tick (absolute-time scheduler)
observer/                     Appends every Redis event to transcript.jsonl
session/<id>/<agent>/         Each agent's latest committed code
session/<id>/transcript.jsonl Full event timeline (observer output)
docker-compose.yml
third_party/openclaw/         (gitignored) cloned upstream
```

## Status

Bugs, limitations, and TODOs live in [GitHub Issues](https://github.com/shohei81/openclaw-livecoding-orchestrator/issues), not in this file.

## References

- OpenClaw: <https://github.com/openclaw/openclaw> · [Docs](https://docs.openclaw.ai)
- Strudel: <https://strudel.cc> · [mini-notation](https://strudel.cc/learn/mini-notation/)
- Hydra: <https://hydra.ojack.xyz/docs/>
- NVIDIA NIM (used in earlier phase (c)): <https://build.nvidia.com>
