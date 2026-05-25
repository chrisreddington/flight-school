# Deploying Flight School to Azure Container Apps

> [!WARNING]
> **Exploratory only — not for production use.** Flight School is a
> single-developer side project mid-iteration. This document describes how
> *the experiment* is deployed; it is **not** a reference architecture and
> almost certainly contains shortcuts you should not copy into a production
> system. Treat everything here as "how I'm currently kicking the tires" and
> review independently before reusing.

This doc covers the **container image** half of deploying Flight School. The
full Azure Container Apps deployment (infra, identity, secrets wiring) is
tracked in P8.

## Current Copilot runtime architecture

The platform deploys **two container images** built from the same monorepo:

1. **Web image** — Next.js app served from `Dockerfile`. Handles browser
   traffic, OAuth, Octokit calls. Has no Copilot SDK reachable from its
   import graph.
2. **Worker image** — standalone Hono/Node process built from
   `Dockerfile.worker` over `dist-worker/*.mjs` (esbuild bundle, no Next
   runtime). Owns the per-user Copilot runtime pool, the SDK, the CLI
   subprocesses, and all `/api/internal/*` routes.

The split is enforced in CI by
[`scripts/check-worker-next-free.mjs`](../scripts/check-worker-next-free.mjs)
(no `next/*` reachable from the worker entrypoint) and
[`scripts/check-copilot-sdk-boundary.mjs`](../scripts/check-copilot-sdk-boundary.mjs)
(no `@github/copilot-sdk` reachable outside the worker).

The worker is a **single-replica** service: the in-process scheduler,
runtime pool, and local job storage all assume one process. Until a
durable queue (Service Bus / KEDA) lands, the ACA worker app must be
declared with `maxReplicas = 1`.

## Building the images

Both images must be pushed with the **same** `imageTag` for a given
deployment — the Bicep template wires both Container Apps to that tag.

```bash
# Pick one tag for this deployment (e.g. the git SHA).
TAG=sha-$(git rev-parse --short HEAD)
REGISTRY=<acrLoginServer>   # e.g. ghcr.io/your-org or myregistry.azurecr.io
APPNAME=<appName>           # matches your bicep parameter

# Web (Next.js)
docker build -t "${REGISTRY}/${APPNAME}:${TAG}" .
docker push  "${REGISTRY}/${APPNAME}:${TAG}"

# Worker (Hono/Node, no Next)
docker build -t "${REGISTRY}/${APPNAME}-worker:${TAG}" -f Dockerfile.worker .
docker push  "${REGISTRY}/${APPNAME}-worker:${TAG}"
```

There is no CI workflow that builds either image yet; this is currently
a manual flow. After pushing both images, redeploy with
`--parameters imageTag=${TAG}` (see [Redeploying with a new image
tag](../infra/README.md#redeploying-with-a-new-image-tag)).

The worker image is intentionally minimal: `npm run build:worker`
emits `dist-worker/{bootstrap,server-main}.mjs` plus a generated
`dist-worker/package.json` listing only the externalised runtime
packages (`@github/copilot`, `@github/copilot-*` platform variants,
`@hono/node-server`, `@azure/cosmos`, OTel SDK, …). The runtime stage
runs `npm install --omit=dev` inside `dist-worker/` and starts via
`CMD ["node", "bootstrap.mjs"]`.

### Web image (`Dockerfile`) stages

The web image runs Next.js only — the Copilot SDK and CLI live in the
worker image. The runner stage ships zero `@github/*` packages.

1. **`deps`** – installs the full dependency tree with `npm ci`. The
   `@github/copilot*` packages are present in this stage because the
   build needs to resolve their type definitions, but they are never
   copied forward into the runner.
2. **`builder`** – runs `npm run build`, producing `.next/standalone` thanks to
   `output: 'standalone'` in `next.config.ts`. The Next.js tracer
   includes only the modules actually reachable from a value-imported
   server entry; SDK execution lives in the worker, so the standalone
   trace excludes the `@github/*` namespace.
3. **`runner`** – a clean `node:20-slim` image with only the standalone server,
   static assets, and `public/`. Runs as the non-root `node` user under
   `tini` for clean signal handling. The `@github/copilot*` packages are
   deliberately **not** copied into this stage — SDK execution lives in
   the worker image.

> The web image is provably free of the `@github/*` namespace, enforced
> by four CI gates running on every PR:
>
> 1. [`scripts/check-copilot-sdk-boundary.mjs`](../scripts/check-copilot-sdk-boundary.mjs)
>    bans SDK imports outside worker scopes at the source level.
> 2. `scripts/check-web-image-copilot-free.mjs` Assertion A lints the
>    `Dockerfile` for any `COPY ... @github` instruction and any
>    `COPY ... /app/node_modules` in the runner stage.
> 3. Assertion B walks `.next/standalone/**` after build and fails if any
>    `node_modules/@github/*` directory exists.
> 4. Assertion C scans every built `.js`/`.mjs`/`.cjs` for runtime
>    `require`/`import` edges into `@github/copilot*`. The
>    `serverExternalPackages` entry in `next.config.ts` is the runtime
>    fail-loud net — if all four gates were bypassed, the container would
>    crash at startup with "Cannot find module".

### Worker image notes

`Dockerfile.worker` builds in two stages: the `build` stage runs
`npm ci` + `npm run build:worker`, and the `runtime` stage copies only
`dist-worker/` then runs `npm install --omit=dev` to pull the
externalised native prebuilds for the current platform
(`@github/copilot-{linux,linuxmusl,darwin,win32}-{x64,arm64}`,
`@img/sharp-*`, `tree-sitter-*`). Target image size: < 200 MB.

The Hono worker configures HTTP server timeouts explicitly to support
long SSE streams (previously handled by Next's `maxDuration = 300`):

| Setting | Value | Why |
| --- | --- | --- |
| `server.keepAliveTimeout` | 310 s | > 300 s SSE budget |
| `server.headersTimeout` | 320 s | must exceed keepAlive |
| `server.requestTimeout` | 0 (disabled) | rely on SSE heartbeat for liveness |

**ACA ingress idle timeout (default 240 s) must be raised above 300 s
or paired with a shorter SSE heartbeat** — otherwise long authoring /
job streams disconnect at the ingress proxy.

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

Most of the **worker** image is `node_modules/@github/copilot` (~100 MB
of prebuilds for multiple architectures). We deliberately keep all of
them so the same worker image can run on both amd64 and arm64 Container
Apps environments. If size becomes a real problem, strip non-target
`prebuilds/` directories in a future revision — but verify the SDK
still spawns the CLI before shipping that. The web image does not
spawn the CLI and is a future candidate for dropping these packages
entirely (see the "Web image" note above).

## Next steps (P8)

* Push the image to an Azure Container Registry.
* Stand up the Container App with the required GitHub OAuth + `AUTH_SECRET`
  secrets, ingress on port 3000, and a managed identity for ACR pull.
* Wire up a health probe (target route TBD — none exists today).

## Deployment checklist (lab/test environments only)

Use this checklist before promoting an image to a shared **non-production** ACA revision.
The Bicep modules in [`infra/`](../infra/) provision everything; this section
is the operator's "have I configured it right?" view.

### 1. Environment variables / secrets

Set as Key Vault secrets resolved by Container App secret refs (see
[`infra/README.md`](../infra/README.md) for `az keyvault secret set`
commands). Canonical list lives in [`.env.example`](../.env.example).

| Variable | Source | Why |
|---|---|---|
| `AUTH_SECRET` | Key Vault `auth-secret` | Auth.js JWT encryption key. Rotate by writing a new secret version + restarting the revision. |
| `AUTH_GITHUB_ID` | Key Vault `auth-github-id` | GitHub App client ID. |
| `AUTH_GITHUB_SECRET` | Key Vault `auth-github-secret` | GitHub App client secret. |
| `AUTH_TRUST_HOST` | Env (`true`) | ACA terminates TLS at the edge; required for Auth.js URL resolution. |
| `COPILOT_WORKER_SECRET` | Key Vault `copilot-worker-secret` | Bearer secret used by the public web app to call the private worker route. |
| `COPILOT_WORKER_URL` | Bicep output/env | Internal URL of the private worker Container App. Required for public Copilot chat execution. |
| `AUDIT_SALT` | Key Vault `audit-salt` | Stable hash salt for user IDs in audit logs. Long random string (`openssl rand -hex 32`). |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Key Vault `appinsights-connection-string` (auto-seeded) | App telemetry. |
| `COSMOS_CONNECTION_STRING` | Key Vault `cosmos-conn-string` (auto-seeded) | Future server-side session/token store. |
| `RATE_LIMIT_*` | Env (optional) | Override per-user rate limits and concurrent-session caps without code changes — see `.env.example`. |

### 2. GitHub App configuration

1. The GitHub App must be a **GitHub App**, not an OAuth App (Auth.js v5 +
   user-to-server token model).
2. **Callback URL** = `https://<containerAppFqdn>/api/auth/callback/github`.
   The FQDN is emitted as the `containerAppFqdn` Bicep output; ACA may
   suffix the hostname with a hash on collision so always read it from
   deployment outputs rather than guessing.
3. Enable **"Request user authorization (OAuth) during installation"** and
   **"Expire user authorization tokens"** so refresh tokens are issued.
4. Scopes: at minimum `read:user user:email read:org repo` — adjust per the
   features you ship.

### 3. Monitoring

| Signal | Where |
|---|---|
| HTTP request traces, GitHub API spans, Copilot session spans | Application Insights (OpenTelemetry export via `@vercel/otel`). |
| Web→worker job correlation | Application Insights distributed traces. A single chat/job flow should contain web `POST /api/jobs`, web→worker `/api/internal/jobs/execute`, worker execution spans, and Copilot spans under one trace lineage (with replay/retry linked via span links). |
| Audit events (`copilot.session.create`, rate-limit denials, cap hits) | Application Insights traces, filterable on `eventType`. User IDs are hashed with `AUDIT_SALT`. |
| Revision health | `az containerapp revision list` — startup/readiness probes hit `/api/health` (owned by another phase). |
| Worker health | `az containerapp show -n <appName>-worker` — internal ingress only; probes also hit `/api/health`. |
| Cost / scaling | ACA portal; web HTTP scaler at 50 req/replica. Worker is fixed single replica (`maxReplicas=1` — in-process scheduler, restart-sweep, job store, and per-user runtime pool all assume one process; see `infra/modules/copilot-worker-app.bicep`). |

### 4. Rate-limit tuning

Defaults live alongside the route handlers and match the names in
`.env.example` (`RATE_LIMIT_CHAT_PER_MIN=30`, `RATE_LIMIT_CHAT_CAP=3`, etc.).
To tighten without a redeploy: set the env var as a Container App env entry
and restart the revision. Per-user rate limit and concurrent-session-cap
state lives in-process (see `src/lib/security/rate-limit.ts` and
`session-cap.ts`); with `minReplicas=1` and sticky sessions this is fine for
the current load model. If you scale out aggressively, move that state to
the Cosmos session store before lowering the limits.

### 5. After every deploy

1. `az containerapp revision list` — confirm the new revision is `Active` and
   `Provisioning: Provisioned`.
2. Hit `https://<fqdn>/` in an incognito window — verify the GitHub OAuth
   redirect lands on the **new** revision's callback URL.
3. Run one chat round-trip — confirm an audit event with the expected
   `eventType` shows up in App Insights.
4. Check the **rate-limit remaining** GitHub header on a sample API request
   to confirm the per-user token (not a shared one) is in use.

## Related docs

- [`infra/README.md`](../infra/README.md) — Bicep modules, Key Vault secret
  bootstrap, redeploy / rotate / cleanup recipes.
- [`docs/architecture-multitenant.md`](architecture-multitenant.md) —
  Multi-tenancy design (Auth.js → per-request Octokit → Copilot execution
  boundary → required worker → per-user runtime).
- [`docs/migrations/2025-multitenant-auth.md`](migrations/2025-multitenant-auth.md)
  — Upgrade notes for existing developers.
