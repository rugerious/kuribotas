# Kuribotas server image.
# Base pinned by digest: the tag says which line, the digest says exactly which bytes.
FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Install runtime dependencies only (none yet; ws and SQLite arrive in phase 1).
# Dev tools such as ESLint and TypeScript never enter the image.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev && npm cache clean --force

# Node 26 runs the TypeScript sources directly (type stripping): no build step.
COPY server/src server/src

# Run as the unprivileged "node" user that the official image provides.
USER node

EXPOSE 3000

# Docker marks the container unhealthy if /healthz stops answering.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Exec form: node is PID 1 and receives SIGTERM directly (graceful shutdown).
CMD ["node", "server/src/index.ts"]
