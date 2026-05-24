<!-- Describe the change in one or two sentences. -->

## Tenant-invariant checklist

This is a **multi-tenant** application. Every PR must preserve tenant isolation. Tick each box or note `N/A` with a one-line reason.

- [ ] No new module-level GitHub client, Copilot client, or auth state.
- [ ] Every new/modified API route, Server Action, or Server Component data loader resolves the user via `requireUserContext()` / `requireGuardedUserContext()` / `withUserGuards()`.
- [ ] Per-session `gitHubToken` flow preserved end-to-end. Tokens are never cached, logged, or reused across tenants.
- [ ] Workspace storage isolation enforced via the path-safety primitives (no raw `userId` from request body / query).
- [ ] Any cache key/tag introduced or modified is fully tenant-scoped (`user:${userId}` plus `:session:`, `:repo:`, `:installation:` as relevant), **or** is prefixed `public:` with a one-line justification below.
- [ ] Web / API code does **not** perform in-process Copilot SDK calls — execution still routes through the worker.

### Cache scope justification (only if you used `public:` above)

<!-- One line per `public:` tag explaining why the cached data is safe to share across tenants. -->

## What changed

<!-- Concise description of what and why. -->

## How it was tested

<!-- vitest, manual, multi-tenant smoke, etc. -->
