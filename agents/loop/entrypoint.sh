#!/usr/bin/env bash
# Start the OpenClaw gateway in the background, wait for it to become ready,
# then hand off to the loop. The gateway's logs go to stdout interleaved with
# the loop's.

set -euo pipefail

# Generate a fresh gateway token if one isn't provided. The CLI in the same
# container reads OPENCLAW_GATEWAY_TOKEN as a remote fallback, so setting it
# here lets gateway and CLI agree on a token without committing one to the
# config file in agents/homes/<id>/openclaw.json.
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  export OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
fi

# Run the gateway with the per-agent home that docker-compose has mounted at
# /home/node/.openclaw (volume mount from agents/homes/<id>/).
node /app/openclaw.mjs gateway --bind loopback --port 18789 &
GATEWAY_PID=$!

# Wait for /healthz to come up before letting the loop send any agent calls.
for i in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "[entrypoint] gateway ready after ${i}s"
    break
  fi
  if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
    echo "[entrypoint] gateway died before becoming ready" >&2
    exit 1
  fi
  sleep 1
done

cd /loop
exec node loop.js
