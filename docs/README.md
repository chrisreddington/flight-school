# Flight School docs

Start with **[`architecture.md`](architecture.md)** — the story, with
diagrams, and links into everything else.

## Narrative

- [`architecture.md`](architecture.md) — system shape, the five
  load-bearing decisions, chat + job sequence diagrams, Aspire / local
  dev, storage layout, observability. Read this first.

## Reference (deep dives)

- [`architecture-multitenant.md`](architecture-multitenant.md) —
  multi-tenant invariants in detail: per-request Octokit, Copilot
  per-session identity, Token store CAS / AAD binding / DEK cache, no
  tokens on the public session, background jobs.
- [`copilot-sdk-persistence.md`](copilot-sdk-persistence.md) — ADR for
  keeping `infiniteSessions` on and not sweeping the SDK's session-state
  directory.

## Operations

- [`deployment-aca.md`](deployment-aca.md) — container image, Azure
  Container Apps deployment checklist, monitoring, rate-limit tuning.
- [`../infra/README.md`](../infra/README.md) — Bicep modules, Key Vault
  secret bootstrap, deploy / rotate / cleanup recipes.

## History

- [`migrations/2025-multitenant-auth.md`](migrations/2025-multitenant-auth.md)
  — upgrade notes for developers pulling the multi-tenant branch onto an
  existing checkout.
- [`superpowers/specs/`](superpowers/specs/) and
  [`superpowers/plans/`](superpowers/plans/) — design proposals and
  implementation plans that produced the current shape. Kept for
  context, not for guidance.

## Skills (in `.github/skills/`)

- [`copilot-sdk-worker-only`](../.github/skills/copilot-sdk-worker-only/SKILL.md)
  — enforces the worker boundary.
- [`opentelemetry`](../.github/skills/opentelemetry/SKILL.md) — span /
  metric / log instrumentation rules.
- [`aspire-debugging`](../.github/skills/aspire-debugging/SKILL.md) —
  agent-driven debugging through the Aspire MCP.
- [`doc-currency`](../.github/skills/doc-currency/SKILL.md) — keep these
  docs honest when the code changes.
- [`readable-code`](../.github/skills/readable-code/SKILL.md) —
  TypeScript readability contract.
- [`panel-review`](../.github/skills/panel-review/SKILL.md) —
  multi-reviewer panel for non-trivial design changes.
