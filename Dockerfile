# syntax=docker/dockerfile:1.7

# ---------- Stage 1: deps ----------
# Install full dependency tree (including @github/copilot which ships native
# prebuilds the SDK spawns as a CLI subprocess at runtime).
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

# The Copilot CLI bundles ripgrep + sharp + tree-sitter prebuilds. Slim already
# has the glibc + libstdc++ those native binaries need; no extra apt installs
# required. Keep tini for clean PID 1 signal handling.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Next.js standalone output ships a minimal server + traced node_modules.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# CRITICAL: the Copilot SDK spawns the @github/copilot CLI binary at runtime
# via `import.meta.resolve`. Next.js' nft tracer does not detect this dynamic
# resolution, so the package is not copied into .next/standalone. Copy the
# whole package (and the SDK that resolves it) explicitly. This adds ~100 MB
# but is required for any Copilot SDK feature to work in the container.
COPY --from=builder --chown=node:node /app/node_modules/@github ./node_modules/@github

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
