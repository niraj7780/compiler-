# DevCode app image: serves the UI + API and drives the host Docker daemon
# (docker.sock) to run user code in sibling sandbox containers.
FROM node:22-slim

# Docker CLI only - the daemon comes from the host via /var/run/docker.sock.
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY api ./api
COPY public ./public
COPY server ./server
COPY docker ./docker
COPY README.md ./

# Temp workdirs and the shared build cache must sit at paths that are
# identical inside this container and on the Docker host, because sandbox
# containers bind-mount them (docker-outside-of-docker).
ENV PORT=3000 \
    TMPDIR=/var/lib/devcode/tmp \
    DEVCODE_CACHE_DIR=/var/lib/devcode/cache

RUN mkdir -p /var/lib/devcode/tmp /var/lib/devcode/cache

EXPOSE 3000
CMD ["node", "server/index.js"]
