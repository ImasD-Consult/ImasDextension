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

ARG EXTENSION_URL=https://extensions.imasdconsult.com/trimble/smartprintPRO
ENV EXTENSION_URL=${EXTENSION_URL}

RUN pnpm --filter @imasd/ext-smartprint-pro build

FROM node:22-alpine

RUN npm install -g serve@latest

COPY --from=builder /app/extensions/smartprint-pro/dist/ /app/

EXPOSE 3000

CMD ["serve", "-s", "/app", "-l", "3000"]
