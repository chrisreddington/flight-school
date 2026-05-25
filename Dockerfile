# syntax=docker/dockerfile:1.7

# ---------- Stage 1: deps ----------
# Install the full dependency tree. `@github/copilot*` ships large native
# prebuilds that USED to be spawned from this container; SDK execution now
# lives in the worker image (`Dockerfile.worker`). The packages are still
# pulled in here because the Next.js bundle reaches their import graph;
# trimming them is a follow-up gated by `scripts/check-copilot-sdk-boundary.mjs`.
FROM node:20-slim AS deps
WORKDIR /app

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- Stage 2: builder ----------
FROM node:20-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---------- Stage 3: runner ----------
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Tini for clean PID 1 signal handling. The web container no longer spawns
# the Copilot CLI subprocess (that runs in the worker image), so the native
# prebuilds shipped by `@github/copilot*` are not exercised here — but slim
# still gives us the glibc + libstdc++ they need in case any code path
# reaches them transitively before the trim lands.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Next.js standalone output ships a minimal server + traced node_modules.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Copy `@github/*` packages into the runtime layer. The web container does
# NOT spawn the Copilot CLI any more — that responsibility moved to the
# worker image — but the Next.js standalone tracer still wants these
# packages on disk because shared code in the Next.js bundle imports
# their types/entry points. Dropping them is a follow-up optimisation
# guarded by `scripts/check-copilot-sdk-boundary.mjs` (which enforces
# that SDK *execution* stays worker-only).
COPY --from=builder --chown=node:node /app/node_modules/@github ./node_modules/@github

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
