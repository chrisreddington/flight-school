---
name: panel-review
description: |
  Use whenever you are planning, executing, or finishing any non-trivial
  architectural change — multi-file refactors, cross-cutting cleanups,
  performance work, new subsystems, or anything where "wrong design"
  costs more than "wrong implementation". Convenes a six-reviewer panel
  (three models × two personas) that critiques the plan before code
  lands and re-reviews every milestone until consensus. Trigger phrases:
  "architecture cleanup", "design review", "panel review", "rubber-duck
  this plan", "non-trivial refactor", "before I implement", "is this
  approach sound", "get this critiqued".
---

# Multi-model panel review skill

> One model is one opinion. Three models with two personas each is six
> reviewers with different priors, training data, and blind spots.
> Use the panel for any change where "wrong design" costs more than
> "wrong implementation".

This skill codifies the iterative review-and-fix loop that has caught
HIGH-severity cache-poisoning bugs, MED-severity invariant drifts, and
LOW-severity TSDoc / test-coverage gaps before they shipped. It is the
default workflow for non-trivial architectural changes in this repo.

## When to convene the panel

Convene when **any** of the following is true:

- The change touches a public contract (route handler shape, exported
  type, env var, on-disk format, cache key).
- The change spans more than one architectural seam (Web / API /
  Worker / Runtime).
- The change introduces or modifies a cross-cutting invariant
  (multi-tenant isolation, fingerprint equality, monotonic-add
  semantics, capability composition).
- The plan involves more than ~3 files or more than ~200 LOC of
  production code change.
- You catch yourself thinking "I'm not sure if this is the right
  approach but I'll just try it" — that's a panel trigger.

**Do not** convene for: typo fixes, single-file bug fixes with no
contract change, test-only edits, dependency bumps, doc-only changes.
The `rubber-duck` agent (single reviewer) is enough for those.

## Panel composition

Six reviewers, organised as a 3×2 matrix:

| Model | Architect persona | Developer persona |
|---|---|---|
| `gpt-5.3-codex` | `codex-architect-<topic>` | `codex-developer-<topic>` |
| `gpt-5.5` | `gpt55-architect-<topic>` | `gpt55-developer-<topic>` |
| `claude-sonnet-4.6` | `sonnet-architect-<topic>` | `sonnet-developer-<topic>` |

**Why three models:** each model's blind spots are different. Codex
tends to catch invariant drift and future-proofing gaps; GPT-5.5 tends
to catch contract / TSDoc inconsistencies and test-coverage holes;
Sonnet tends to catch readability, correctness of intermediate state,
and "is this comment actually true now". You want all three.

**Why two personas:** the architect lens asks "is this the right
shape?"; the developer lens asks "is this code correct, tested, and
maintainable?". A reviewer asked to do both at once usually drops one.
Splitting the role doubles the surface area at near-zero cost (the
agents run in parallel).

**Topic suffix** (`-ttft`, `-multitenant`, `-streaming`, …) keeps
multiple concurrent panels addressable and lets you reuse the same
agent across rounds.

## The loop

```
┌─ Round N ──────────────────────────────────────────────┐
│ 1. Write a short brief: what changed since round N-1,  │
│    severity-tagged, citing commits.                    │
│ 2. write_agent the same brief to all 6 panel members   │
│    in parallel. Ask each to iterate on ANY remaining   │
│    issue regardless of severity.                       │
│ 3. Wait for the 6 idle notifications. (Background work │
│    on the next phase IS allowed; pure waiting is not.) │
│ 4. read_agent each one. Aggregate findings.            │
│ 5. Fix-forward every finding of every severity in one  │
│    commit. Validate (tsc/lint/test/build/guardrails).  │
│ 6. If anyone raised an issue, go to round N+1.         │
│    If 6/6 SHIP with zero findings, exit the loop.      │
└────────────────────────────────────────────────────────┘
```

### Fix-forward, not deferred

Every finding gets fixed in the very next round, regardless of
severity. NB / LOW findings are not deferred to a follow-up backlog;
they ship in the next commit. The loop only terminates when no
reviewer raises any finding at any severity.

This matters because LOW findings compound — a stale TSDoc plus a
loose regex plus a duplicated helper looks trivial individually but
collectively represents "nobody read this carefully". Closing them
all forces the kind of attention that catches the HIGH next time.

### Convergent findings

When two or more reviewers flag the same issue independently (a
"convergent finding"), treat it as a near-certainty. When reviewers
disagree on a finding (e.g. one wants strict-throw, another wants
prune-and-warn), pick the option that preserves the strongest
invariant and document the rationale in the commit message — the
losing reviewer usually accepts the trade-off on re-review when the
reasoning is explicit.

## Briefing the panel

Every round's brief follows the same shape:

```
Round N review — round-(N-1) findings fix-forwarded as commit `<sha>`
(<files>, +<add>/-<del>). Validation: tsc / lint / <count> tests /
build / <count> guardrails all green.

Your round-(N-1) findings have shipped:
- <SEVERITY> (<reviewer if convergent>): <one-line description> →
  <one-line fix description with file:line>

Convergent panel fixes also landed:
- <SEVERITY> (<reviewer>): <one-line description> → <fix>

Your task: re-review as <Lead Architect|Lead Developer>. Iterate on
ANY remaining issue regardless of severity. `git diff <prev>..HEAD`;
HEAD is <sha>.
```

The brief is **identical across all six reviewers** for the round —
do not customise. Differential context comes from the persona.

## Initial panel kickoff

For round 1, send the plan (or a link to it) plus the relevant code
context. Ask each reviewer for:

- **Architect:** "Review this plan as Lead Architect. Are the seams
  right? Is the invariant set complete? What future-proofing gap does
  it open?"
- **Developer:** "Review this plan as Lead Developer. Is the
  implementation strategy correct? What test coverage is missing?
  What naming / TSDoc / control-flow issues will reviewers flag?"

Re-use the same agent for every subsequent round so context
accumulates. **Never start a fresh agent mid-loop** — you lose the
prior critique chain.

## Exit criteria

The loop terminates when **all six** reviewers respond with **SHIP**
(or `APPROVE` / `APPROVE-WITH-NO-FINDINGS`) and **zero** findings at
**any** severity. Anything else — even a single LOW or NB — is
another round.

In practice the loop usually converges in 4–9 rounds:
- Rounds 1–2: structural / contract findings.
- Rounds 3–5: test coverage, TSDoc, edge cases.
- Rounds 6–9: tightening regex bounds, comment polish, helper
  extraction, convergent housekeeping.

If you find yourself at round 10+ still seeing new findings, the
problem is usually that the plan itself was wrong — not that the
panel is too picky. Step back and re-plan.

## Anti-patterns

- ❌ Asking for "high-priority findings only". The panel is most
  valuable on the things you didn't think to look for.
- ❌ Acknowledging a finding ("noted, will defer") without fixing it.
  The loop only works if every finding closes.
- ❌ Running the same model with two personas. You get two
  correlated reviews, not two independent ones. Three models is the
  cheapest way to get diverse priors.
- ❌ Sequential dispatch. Always `write_agent` to all six in the
  same response and wait on completion notifications in parallel.
- ❌ Skipping the doc-currency sweep after the panel ships. Panel
  consensus on code does not include doc updates — run the
  [`doc-currency`](../doc-currency/SKILL.md) skill before
  `task_complete`.

## Self-check before declaring a panel-reviewed change done

- [ ] All 6 reviewers responded SHIP / APPROVE on the most recent
      round.
- [ ] Zero findings outstanding at any severity.
- [ ] Every commit in the loop validates clean
      (tsc / lint / tests / build / guardrails).
- [ ] Commit messages attribute each fix to the reviewer who raised
      it ("codex-arch MED:", "gpt55-dev LOW:", …).
- [ ] [`doc-currency`](../doc-currency/SKILL.md) sweep has run and any
      doc updates landed in the same branch.

If any box is unticked, the change is not ready.
