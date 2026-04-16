# PDF + QR API — production image (API or worker via CMD).
#
# OCI labels (override at build for your registry):
#   docker build -f apps/pdf-qr-api/Dockerfile \
#     --label org.opencontainers.image.source=https://github.com/your-org/your-repo \
#     -t ghcr.io/your-org/pdf-qr-api:1.0.0 .
#
# Build from monorepo root:
#   docker build -f apps/pdf-qr-api/Dockerfile -t imasd/pdf-qr-api:latest .
#
# Run API (default):
#   docker run --rm -e REDIS_URL=redis://host:6379 -p 4050:4050 imasd/pdf-qr-api:latest
#
# Run worker:
#   docker run --rm -e REDIS_URL=redis://host:6379 imasd/pdf-qr-api:latest node dist/worker.js

FROM node:20-bookworm-slim AS builder

ENV CI=true \
	PNPM_HOME="/pnpm" \
	PATH="/pnpm:$PATH"

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/pdf-qr-api ./apps/pdf-qr-api

RUN pnpm install --frozen-lockfile --filter @imasd/pdf-qr-api

RUN pnpm --filter @imasd/pdf-qr-api run build

# --- production dependencies only (install as non-root; no slow chown) ---
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production \
	PNPM_HOME="/pnpm" \
	PATH="/pnpm:$PATH"

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

USER node

WORKDIR /repo

COPY --chown=node:node pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --chown=node:node apps/pdf-qr-api/package.json ./apps/pdf-qr-api/

RUN pnpm install --frozen-lockfile --filter @imasd/pdf-qr-api --prod \
	&& pnpm store prune

COPY --chown=node:node --from=builder /repo/apps/pdf-qr-api/dist ./apps/pdf-qr-api/dist

WORKDIR /repo/apps/pdf-qr-api

EXPOSE 4050

# Override to run the BullMQ worker: node dist/worker.js
CMD ["node", "dist/index.js"]
