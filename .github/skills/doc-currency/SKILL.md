---
name: doc-currency
description: |
  Use BEFORE declaring any non-trivial task complete. Sweeps the
  documentation that exists to describe the area you just touched —
  architecture docs, OTel/observability skill, AGENTS/copilot-instructions,
  README, and any other authoritative doc — and updates it so the docs
  match the code that ships. Trigger phrases: "task complete", "ship it",
  "let me wrap this up", "done", or any moment before `task_complete`.
---

# Documentation Currency skill

> Documentation that lags the code is worse than no documentation —
> it actively misleads. Before you call a task done, make sure the
> docs catch up.

This skill is **mandatory** at task completion for any change that:

- Adds, removes, or restructures an authoritative module (observability, auth, persistence, copilot-sdk, MCP, telemetry exporters).
- Changes a public contract (route handler shape, env var, exported type, on-disk format).
- Changes the way another contributor would diagnose, configure, or extend the system.

Trivial fixes (single-file bugfix with no contract change, dependency bump,
test-only edit) are exempt — you should still glance at the doc tree but
no update is required.

## Step 1 — Map the change to the docs that own it

Before editing anything, identify which authoritative docs describe the
area you touched. The canonical owners in this repo are:

> [!IMPORTANT]
> If your change touches an **architectural boundary** — auth, the
> Copilot worker dispatch, background jobs, storage, observability,
> Aspire resource graph — [`docs/architecture.md`](../../../docs/architecture.md)
> is in scope by default. It is the index doc that links everything
> else, so a drifted system diagram or stale code pointer there is
> louder than a stale rule in a deeper reference.

| Area touched | Authoritative doc(s) |
| --- | --- |
| Architectural data flow, system shape, dev-loop story, anything cross-cutting | [`docs/architecture.md`](../../../docs/architecture.md) |
| OTel exporters, samplers, attributes, browser bootstrap, env vars | [`.github/skills/opentelemetry/SKILL.md`](../opentelemetry/SKILL.md) |
| Aspire AppHost, resource graph, env injection, dev workflow | [`apphost.ts`](../../../apphost.ts), [`docs/architecture.md`](../../../docs/architecture.md) (local-dev section), [`.github/skills/aspire-debugging/SKILL.md`](../aspire-debugging/SKILL.md) |
| Auth, multi-tenant token flow, per-request Octokit | [`docs/architecture.md`](../../../docs/architecture.md) (story), [`docs/architecture-multitenant.md`](../../../docs/architecture-multitenant.md) (deep dive), [`.github/copilot-instructions.md`](../../copilot-instructions.md) |
| Copilot SDK sessions, MCP wiring, session persistence | [`docs/copilot-sdk-persistence.md`](../../../docs/copilot-sdk-persistence.md), [`.github/skills/copilot-sdk/SKILL.md`](../copilot-sdk/SKILL.md), [`.github/skills/copilot-sdk-worker-only/SKILL.md`](../copilot-sdk-worker-only/SKILL.md) |
| Copilot worker boundary, per-user runtime pool, job executors | [`docs/architecture.md`](../../../docs/architecture.md) (decisions 2–4), [`.github/skills/copilot-sdk-worker-only/SKILL.md`](../copilot-sdk-worker-only/SKILL.md) |
| Per-user storage layout, token store envelope, retention sweeps | [`docs/architecture.md`](../../../docs/architecture.md) (storage section), [`docs/architecture-multitenant.md`](../../../docs/architecture-multitenant.md) |
| Deployment to Azure Container Apps | [`docs/deployment-aca.md`](../../../docs/deployment-aca.md), [`infra/README.md`](../../../infra/README.md) |
| Documentation rules themselves | [`.github/instructions/documentation.instructions.md`](../../instructions/documentation.instructions.md) |
| TypeScript conventions, anti-patterns | [`.github/instructions/typescript.instructions.md`](../../instructions/typescript.instructions.md) |
| Testing patterns (Vitest, Playwright) | [`.github/instructions/testing.instructions.md`](../../instructions/testing.instructions.md) |
| Architectural data flow, environment variables, commands | [`.github/copilot-instructions.md`](../../copilot-instructions.md), [`docs/architecture.md`](../../../docs/architecture.md) |
| Tech-debt tooling, scripts | [`.github/copilot-instructions.md`](../../copilot-instructions.md) |
| User-facing setup, dev-loop commands | [`README.md`](../../../README.md), [`docs/architecture.md`](../../../docs/architecture.md) (local-dev section), [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) |

If your change spans more than one row, every owning doc is in scope.

## Step 2 — Diff the docs against the code

For each owning doc:

1. Open the doc.
2. Search for any **specific fact** that the change could have invalidated:
   - File paths and module names (renames, deletes).
   - Env var names and defaults.
   - Span/metric/attribute names.
   - Exported function signatures and the rules around them.
   - Step-by-step procedures (install, smoke test, debug recipes).
   - The "Red flags" or "Anti-patterns" tables — does today's change add a new one?
3. If the doc claims something that is no longer true, update it.
4. If the change introduces a new pattern that future contributors will need to follow, add it.

Treat *omissions* with as much weight as *contradictions*. If the doc
should say "we do X" and now doesn't, that's a gap.

## Step 3 — Keep the writing proportional

Doc updates follow the same proportionality as TSDoc:
- Prefer a small, surgical change to the right section over a large new section.
- A new rule or fact is worth one or two sentences in the relevant table or rule — not a whole subsection unless it materially changes a workflow.
- Cross-link rather than duplicate. If a rule lives in
  `documentation.instructions.md`, link to it from the skill, don't restate it.
- Update the "Custom metrics registry" table when adding a metric — that's
  literally why it exists.

## Step 3a — Evergreen, not blow-by-blow

**Documentation captures the current state of the system, not the
history of how it got there.** A reader coming to the docs for the
first time does not need to know what we tried before, what regression
we recovered from, or which commit introduced a rule. They need to
know what is true today and what they must do to stay aligned with it.

Anti-patterns to avoid in docs:

- ❌ "Yesterday we discovered that…" / "In commit X we changed…" / "We used to do Y but now…"
- ❌ Lists of phases, attempts, or migration notes that the codebase no longer references.
- ❌ Verbatim copies of session transcripts, rubber-duck critiques, or chat history.
- ❌ "Previously, this worked because…" — if it doesn't work that way now, drop the previous explanation.

What to write instead:

- ✅ "We do X because Y." (Present tense. Active voice. Current reality.)
- ✅ "Don't do Z — it causes W." (Concrete invariant the reader needs.)
- ✅ "See `path/file.ts:N` for the implementation." (Pointer the reader can verify.)

Migration notes have a legitimate but narrow place: when a new pattern
replaces an old one **that still appears in the codebase** so readers
recognise the deprecated form and can finish the migration. Once the
old form is gone, the migration note goes with it.

If today's change unwinds an earlier approach, **remove the earlier
explanation** rather than layering a "but now we do…" paragraph on top
of it. The doc tree is not append-only.

## Step 4 — Verify

After updating docs:

- Re-read each updated section in isolation. Does it still parse without
  the surrounding context the author had in their head?
- Check internal links (`grep` for `](../` paths if you've moved files).
- For the OTel skill specifically, re-walk the "Rules" list — any rule
  that no longer matches current code is now misleading.

## Step 5 — Commit the docs with the code, not separately

Doc updates belong in the same PR (and ideally same commit) as the code
change. A doc-only follow-up PR routinely never lands. If the code commit
is already pushed and you discover a gap, push a focused follow-up
immediately — don't queue it.

## What this skill is not

- It is **not** a license to write speculative documentation for code you didn't change.
- It is **not** a sweep of the entire doc tree on every commit. Map → diff → update.
- It is **not** a substitute for inline TSDoc — both matter, at different levels.

## Self-check before `task_complete`

- [ ] I identified every authoritative doc that owns an area I touched.
- [ ] For each, I diffed it against my change and updated specifics that drifted.
- [ ] New patterns/rules introduced by my change are documented.
- [ ] Doc updates are in the same PR (and committed) as the code.
- [ ] Internal links and tables (metrics registry, attribute tables) are current.

If any box is unticked, the task is not complete.
