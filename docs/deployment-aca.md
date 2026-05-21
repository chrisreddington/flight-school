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

## Production checklist

Use this checklist before promoting an image to a production ACA revision.
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
| `ACA_DEPLOYMENT` | Env (`true`) | Disables the dev-only `gh` CLI token fallback in `src/lib/github/client.ts`. |
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
| Audit events (`copilot.session.create`, rate-limit denials, cap hits) | Application Insights traces, filterable on `eventType`. User IDs are hashed with `AUDIT_SALT`. |
| Revision health | `az containerapp revision list` — startup/readiness probes hit `/api/health` (owned by another phase). |
| Cost / scaling | ACA portal; HTTP concurrency scaler at 50 req/replica, 1–5 replicas. |

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
  Multi-tenancy design (Auth.js → per-request Octokit → per-session Copilot).
- [`docs/migrations/2025-multitenant-auth.md`](migrations/2025-multitenant-auth.md)
  — Upgrade notes for existing developers.
