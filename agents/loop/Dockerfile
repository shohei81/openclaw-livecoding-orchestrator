# Phase (a) agent: OpenClaw Gateway + sidecar loop in one container.
# The gateway listens on loopback (127.0.0.1:18789); the loop subprocesses
# `openclaw agent` to drive it. Each container is one independent agent.

FROM openclaw:local

USER root
WORKDIR /loop
COPY package.json ./
RUN npm install --omit=dev --no-package-lock
COPY loop.js entrypoint.sh ./
RUN chmod +x entrypoint.sh && chown -R node:node /loop

USER node
ENTRYPOINT ["tini", "-s", "--", "/loop/entrypoint.sh"]
