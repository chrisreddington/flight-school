# Deploying Flight School to Azure Container Apps

This doc covers the **container image** half of deploying Flight School. The
full Azure Container Apps deployment (infra, identity, secrets wiring) is
tracked in P8.

## Building the image

The repo ships a multi-stage `Dockerfile` at the root. It produces a
production-ready Next.js standalone server image based on `node:20-slim`.

```bash
docker build -t flight-school .
```

Build stages:

1. **`deps`** – installs the full dependency tree with `npm ci`. We do *not*
   prune `@github/copilot`: it ships a Node CLI binary plus native prebuilds
   (ripgrep, sharp, tree-sitter) that the Copilot SDK spawns at runtime via
   `import.meta.resolve`. Pruning it breaks every SDK-backed feature.
2. **`builder`** – runs `npm run build`, producing `.next/standalone` thanks to
   `output: 'standalone'` in `next.config.ts`.
3. **`runner`** – a clean `node:20-slim` image with only the standalone server,
   static assets, `public/`, and the `@github/*` packages copied in. Runs as
   the non-root `node` user under `tini` for clean signal handling.

## Running locally

```bash
docker run --rm -p 3000:3000 \
  -e AUTH_SECRET=test \
  -e AUTH_GITHUB_ID=test \
  -e AUTH_GITHUB_SECRET=test \
  -e AUTH_TRUST_HOST=true \
  flight-school
```

The server listens on `PORT=3000` (configurable via env). Auth-protected
pages will redirect to the GitHub OAuth flow; unauthenticated routes
(e.g. health checks, static assets) respond directly.

## Why `node:20-slim` and not `alpine`?

The Copilot CLI bundles native prebuilds for `sharp`, `ripgrep`, and
`tree-sitter`. Those binaries are built against glibc; alpine ships musl and
would require swapping in alpine-specific prebuilds (which the package does
not ship). `slim` is the smallest glibc-based Node image and works
out-of-the-box.

## Image footprint

Most of the image is `node_modules/@github/copilot` (~100 MB of prebuilds for
multiple architectures). We deliberately keep all of them so the same image
can run on both amd64 and arm64 Container Apps environments. If size becomes
a real problem, strip non-target `prebuilds/` directories in a future
revision — but verify the SDK still spawns the CLI before shipping that.

## Next steps (P8)

* Push the image to an Azure Container Registry.
* Stand up the Container App with the required GitHub OAuth + `AUTH_SECRET`
  secrets, ingress on port 3000, and a managed identity for ACR pull.
* Wire up a health probe (target route TBD — none exists today).
