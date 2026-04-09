FROM node:22-alpine AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/tailwind-config/package.json ./packages/tailwind-config/
COPY extensions/smartprint-pro/package.json ./extensions/smartprint-pro/

RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY tsconfig.base.json ./
COPY types/ ./types/
COPY packages/ ./packages/
COPY extensions/smartprint-pro/ ./extensions/smartprint-pro/

# Baked into the bundle so cross-origin fetches target the same Connect host as the viewer (set per region).
ARG VITE_TRIMBLE_CONNECT_ORIGIN=
ENV VITE_TRIMBLE_CONNECT_ORIGIN=${VITE_TRIMBLE_CONNECT_ORIGIN}

RUN pnpm --filter @imasd/ext-smartprint-pro build

FROM node:22-alpine

ARG EXTENSION_URL=https://extensions.imasdconsult.com/trimble/smartprintPRO
ENV EXTENSION_URL=${EXTENSION_URL}

RUN npm install -g serve@latest

COPY --from=builder /app/extensions/smartprint-pro/dist/ /app/
COPY extensions/smartprint-pro/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["serve", "-s", "/app", "-l", "3000", "--cors"]
