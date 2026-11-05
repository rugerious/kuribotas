# Kuribotas server image, built in two stages.
# Base pinned by digest: the tag says which line, the digest says exactly which bytes.

# --- Stage 1: build the web client. Needs dev tools (esbuild), which never reach the final image. ---
FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS web

WORKDIR /build
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY shared shared
COPY web web
RUN npm run build --workspace web

# --- Stage 2: the image that runs. Server sources, runtime dependencies and the built web files only. ---
FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

# Install runtime dependencies only. Dev tools such as ESLint, TypeScript and esbuild never enter the image.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev && npm cache clean --force

# Node 26 runs the TypeScript sources directly (type stripping): no build step for the server.
COPY server/src server/src
# The web client built in stage 1: index.html, main.js, style.css (and source maps).
COPY --from=web /build/web/dist web/dist

# The chat database lives in /data, owned by the app user. Mount a volume there so
# messages survive replacing the container: docker run -v kuribotas-data:/data ...
RUN mkdir /data && chown node:node /data

# Run as the unprivileged "node" user that the official image provides.
USER node

EXPOSE 3000

# Docker marks the container unhealthy if /healthz stops answering.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Exec form: node is PID 1 and receives SIGTERM directly (graceful shutdown).
CMD ["node", "server/src/index.ts"]
