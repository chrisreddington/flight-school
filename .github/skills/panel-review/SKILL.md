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

## Pre-flight veto gate (run BEFORE convening)

The panel critiques *correctness*, not *necessity*. It will happily harden
a design that should not exist. So before you convene anyone, the design
must pass these non-negotiable filters. **A design that fails any of these
is rejected and re-scoped — no panel, no exceptions:**

- **No migrations.** If the design proposes a data migration, a backend→backend
  copier, an intermediate/transition state, or a resume/rollback FSM — stop.
  Find the fix-forward path instead (new state moves forward; existing state
  keeps what it has).
- **Fix-forward only.** No reversible/staged apparatus. If you're building
  machinery to undo or half-apply the change, the design is wrong.
- **Fix-fast / proportionality.** State the blast radius and a review budget
  up front. Match ceremony to risk: a local-app default is not a tenancy
  boundary. If the review will cost more than the change, shrink the change.
- **Smallest viable change.** Added machinery must be *justified*, not assumed.
  Default to deleting scope. A subsystem is a liability until proven necessary.
- **Cleanup as you go.** The change removes the thing it replaces in the same
  commit; it does not leave dead code, stale docs, or orphaned artifacts.

If a design trips any of these, the answer is to **re-plan**, not to send it
to review and let six reviewers make a wrong design more correct.

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
│ 5. Fix-forward every BLOCKING/HIGH/MED finding in one     │
│    commit. Validate (tsc/lint/test/build/guardrails).     │
│ 6. EXIT when no BLOCKING/HIGH/MED findings remain (see    │
│    severity-gated exit below). Else go to round N+1.      │
│    At round 3+ still seeing findings, RE-PLAN — don't     │
│    just keep fixing (see round-3 re-plan trigger).        │
└────────────────────────────────────────────────────────┘
```

### Severity-gated exit (this is the convergence forcing-function)

The loop stays open **only while a BLOCKING, HIGH, or MED finding is
outstanding.** The moment the only remaining findings are NB / LOW, the
change **ships** — fold those nits into the shipping commit if they're
one-liners, or drop them. Do **not** run another full 6-reviewer round to
chase a stale LOC number or a clearer error string.

Why this replaces the old "zero findings at any severity" rule: three
models × two personas asked to "find ANY issue" on a living document will
*always* surface a fresh NB. "Nobody can nitpick" is asymptotic, not
convergent — especially on a plan doc that grows every round as you address
findings (more text = more nit surface = more findings = a loop you built
yourself). Gate on severity and the loop terminates in 2–3 rounds.

### Round-3 re-plan trigger

If you reach **round 3 and are still generating findings**, stop asking
"what's the next fix?" and ask **"is the premise wrong?"** The panel
hardens whatever you give it; it cannot tell you a whole subsystem is
unnecessary. Persistent findings at round 3 usually mean the *design* is
over-scoped, not that the panel is picky. Zoom out, apply the pre-flight
veto gate again, and cut scope. (The old guidance said "round 10+" — that
is far too generous; by then you've burned the budget the change was worth.)

### Review the decision once, not a living document

Panel the **core seams and invariants a single time**, get the shape right,
then implement and (optionally) run **one** diff review. Never iterate a
panel across many rounds on a design *document* — a diff has fixed surface
area; a growing doc does not. If you find yourself re-reviewing prose, you
are polishing, not designing.

### Fix-forward, not deferred (within the severity gate)

Every BLOCKING/HIGH/MED finding gets fixed in the very next round, never
deferred to a backlog. NB / LOW findings do not hold the loop open: fix the
cheap ones in the shipping commit, drop the rest. The discipline is "close
every finding that matters fast", not "achieve a state where no reviewer can
say anything".

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

The loop terminates when **no BLOCKING, HIGH, or MED finding is
outstanding** — i.e. every reviewer either responds SHIP or raises only
NB / LOW findings (which ship folded into the final commit, not as another
round). Do not hold the loop open for a single NB; that is the asymptotic
trap this skill exists to avoid.

In practice a well-scoped change converges in **2–3 rounds**:
- Round 1: structural / contract / invariant findings.
- Round 2: the fixes for those, plus any test-coverage gaps.
- Round 3: should be SHIP or NB-only. If it is **not** — if round 3 still
  surfaces BLOCKING/HIGH/MED — that is the **re-plan signal**: the design
  is over-scoped, not the panel over-picky. Apply the pre-flight veto gate
  again and cut scope. Do not grind to round 4, 5, … 9.

> Historical note: an earlier version of this skill exited only at "zero
> findings at any severity" and tolerated "round 10+". That produced a real
> 9-round spiral on a storage plan that hardened an unnecessary
> migration apparatus — six reviewers making a wrong design more correct.
> The severity gate + round-3 re-plan trigger above exist specifically to
> make that impossible.

## Anti-patterns

- ❌ **Chasing zero findings.** Holding the loop open for NB/LOW nits.
  Gate on BLOCKING/HIGH/MED; ship when those are closed.
- ❌ **Iterating a panel on a growing design document.** The doc grows as
  you address findings, manufacturing new nit surface every round. Panel
  the decision once, then review the diff.
- ❌ **Skipping the pre-flight veto gate.** Sending a design that proposes
  a migration / intermediate state / resume FSM to review instead of
  re-planning it. The panel can't tell you a subsystem shouldn't exist.
- ❌ Asking for "high-priority findings only". The panel is most
  valuable on the things you didn't think to look for.
- ❌ Acknowledging a finding ("noted, will defer") without fixing it.
  Every BLOCKING/HIGH/MED finding closes in the next round.
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

- [ ] The design passed the **pre-flight veto gate** (no migration /
      intermediate state / resume FSM; fix-forward; smallest viable scope).
- [ ] **No BLOCKING / HIGH / MED finding outstanding** on the most recent
      round (NB/LOW either folded into the shipping commit or dropped).
- [ ] The loop closed in ≤3 rounds — or, if it ran longer, you hit the
      round-3 re-plan trigger and re-scoped rather than grinding on.
- [ ] Every commit in the loop validates clean
      (tsc / lint / tests / build / guardrails).
- [ ] Commit messages attribute each fix to the reviewer who raised
      it ("codex-arch MED:", "gpt55-dev MED:", …).
- [ ] [`doc-currency`](../doc-currency/SKILL.md) sweep has run and any
      doc updates landed in the same branch.

If any box is unticked, the change is not ready.
