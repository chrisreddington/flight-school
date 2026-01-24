---
applyTo: "docs/{specs,plans}/*.md"
description: Standards for specification and implementation plan documents
---

# Specification & Plan Documentation Standards

This document defines standards for specification (SPEC) and implementation plan (PLAN) documents to ensure consistency, brevity, and actionability.

## Core Principles

### Less is More
- **Prefer bullets over prose** - Lists scan faster than paragraphs
- **Prefer tables over narratives** - Structured data is easier to consume
- **Omit empty sections** - Don't include sections with "None" or "All resolved"
- **One source of truth** - Don't repeat information in multiple places

### Separation of Concerns
- **SPEC = WHAT** - Requirements, acceptance criteria, user stories
- **PLAN = HOW** - Implementation steps, file changes, verification commands
- **No code in specs** - Code belongs in plans or implementation

## Document Size Limits

| Document Type | Target | Hard Limit |
|---------------|--------|------------|
| Specification | 150-250 lines | 300 lines |
| Implementation Plan | 200-350 lines | 400 lines |

If exceeding limits, either:
1. Split into multiple focused specs/plans
2. Reduce detail (defer to implementation phase)
3. Use references instead of inline content

## Specification Standards

### Required Sections

| Section | Purpose | Line Budget |
|---------|---------|-------------|
| Header (Status/Date) | Metadata | 3 lines |
| Resumption Section | State tracking | 5-8 lines |
| Job Story | Core user need | 3 lines |
| Current State | What exists today | 5-10 lines |
| Goals / Non-Goals | Scope boundaries | 5-10 lines |
| User Stories + ACs | Requirements | 40-80 lines |
| Design Decisions | Key choices made | 10-20 lines |
| Specialist Sign-Off | Review status | 5-10 lines |
| Handoff for Planning | Transition data | 10-15 lines |

### Forbidden in Specs

| Content | Why | Where It Belongs |
|---------|-----|------------------|
| TypeScript code blocks | Implementation detail | Plan or code files |
| CSS examples | Implementation detail | Plan or code files |
| Full interface definitions | Implementation detail | Plan or code files |
| Step-by-step instructions | Plan content | Plan document |
| File content previews | Implementation detail | Plan document |

### Design Decisions Format

Use table format, not numbered narratives:

```markdown
## Design Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DD1 | Use Grid pattern over Listbox | WCAG APG recommends for interactive items |
| DD2 | Store duration as seconds | Single source of truth, avoids parsing |
```

### Specialist Feedback Format

Keep condensed summary for decision context:

```markdown
## Specialist Sign-Off

| Specialist | Status | Notes |
|------------|--------|-------|
| Test | approve | All ACs testable; added boundary cases |
| Accessibility | concern | Added focus ring token (DD3) |

### Key Specialist Recommendations
- **Test**: Add boundary tests for MAX_DURATION ±1 second
- **Accessibility**: Include `aria-describedby` for error states
```

### Sections to Omit When Empty

- Open Questions (only include if questions exist)
- Pending Decisions (only include if decisions pending)
- Anxieties & Considerations (fold into Current State if brief)

## Plan Standards

### Required Sections

| Section | Purpose | Line Budget |
|---------|---------|-------------|
| Header (Status/Spec link) | Metadata | 3 lines |
| Resumption Section | State tracking | 5-8 lines |
| From Spec | Handoff data | 10-15 lines |
| Implementation Steps | The plan itself | 100-200 lines |
| Rollback Plan | Recovery strategy | 10-20 lines |
| Specialist Sign-Off | Review status | 5-10 lines |

### Step Format

Each step should be 3-5 lines max:

```markdown
**Step 1.1**: Create duration utility module
- Files: F1 (src/core/utils/duration/index.ts)
- Story: S1, AC1.1-AC1.3
- Verify: `npm run test -- duration`
- Complexity: M
```

### Forbidden in Plans

| Content | Why | Better Approach |
|---------|-----|-----------------|
| Full code implementations | Execute agent writes code | Describe intent in 1-2 sentences |
| Multi-paragraph action descriptions | Too verbose | Use bullet points |
| Re-analysis of codebase | Spec did this | Reference spec's file list |
| >10 phases | Too granular | Consolidate related steps |

### Notes Per Step

Maximum 2-3 bullet points. If more context needed, link to spec.

## File Naming

### Specs
```
docs/specs/SPEC-NNN-kebab-case-title.md
```

### Plans
```
docs/plans/PLAN-NNN-kebab-case-title.md
```

Other artifacts (audits, reports, quality reviews) should NOT be in `docs/plans/`.

## Anti-Patterns

| Anti-Pattern | Problem | Correct Approach |
|--------------|---------|------------------|
| Code in specs | Mixes WHAT with HOW | Defer code to plans |
| 500+ line specs | Unreadable, hard to maintain | Split or condense |
| Empty sections | Visual noise | Omit entirely |
| Narrative feedback | Hard to scan | Use tables and bullets |
| Repeated AC lists | Duplication | Single AC Summary table |
| Timeframe estimates | Creates false expectations | Use S/M/L complexity only |
| Full file content in plans | Execute agent's job | Describe changes, don't write code |
| Missing architecture review | Tech debt accumulates | Include architecture checklist |
| Ignoring existing patterns | Inconsistent codebase | Follow established conventions |

## Architecture Review Checklist

Plans MUST address these architecture concerns before execution:

### Code Organization
- [ ] Large modules (>300 lines) are split into focused submodules
- [ ] Tests are co-located with source files (`foo.ts` + `foo.test.ts`)
- [ ] Entry points export only, implementation in dedicated files
- [ ] Related functionality grouped in folders (not flat file dumps)

### Naming Consistency
- [ ] New code follows existing naming patterns in the same domain
- [ ] Constants use consistent casing (match surrounding code)
- [ ] Functions/methods are descriptively named for their purpose

### Separation of Concerns
- [ ] Core modules don't import feature-specific code directly
- [ ] Features don't cross-import from sibling features
- [ ] State management follows established patterns

### DRY Principles
- [ ] No duplicate interfaces or types across files
- [ ] Shared utilities extracted to common locations
- [ ] Configuration centralized in appropriate places

## Templates

### Spec Template (Target: ≤250 lines)

```markdown
# SPEC-NNN: {Title}

**Status**: Draft | Review | Approved
**Date**: {YYYY-MM-DD}

## Resumption Section
- **Scope**: {1-sentence description}
- **Current Phase**: Phase {N}: {Name}
- **Next Action**: {What to do next}
- **Blockers**: {None | Description}

## Job Story
When {situation}, I want {motivation}, so I can {outcome}.

## Current State
- {Bullet point 1 - what exists}
- {Bullet point 2 - pain points}
- {Max 5-7 bullets}

## Goals
1. {Primary goal}
2. {Secondary goal}

## Non-Goals
- {Explicitly out of scope item}

## User Stories

### Must Have
- [ ] **S1**: As {user}, I want {goal}, so that {benefit}
  - AC1.1: {Testable criterion}
  - AC1.2: {Testable criterion}

### Should Have
- [ ] **S2**: As {user}, I want {goal}, so that {benefit}
  - AC2.1: {Testable criterion}

## Acceptance Criteria Summary
| ID | Criterion | Testable? | Story |
|----|-----------|-----------|-------|
| AC1.1 | {criterion} | Yes | S1 |

## Design Decisions
| ID | Decision | Rationale |
|----|----------|-----------|
| DD1 | {decision} | {1-sentence why} |

## Specialist Sign-Off
| Specialist | Status | Notes |
|------------|--------|-------|
| {Name} | approve/concern | {1 sentence} |

### Key Specialist Recommendations
- **{Specialist}**: {Key recommendation for Plan to incorporate}

## Handoff for Planning
- **Affected Domains**: [x] Test [ ] E2E [ ] Accessibility [ ] Performance [ ] Code Quality [ ] Technical Writing [ ] Code Documentation
- **Migration Strategy**: {Fix forward | Deprecation | Indirection | N/A}
- **Files**: {comma-separated paths or F1, F2 notation}
- **Risks**: {1-2 sentences from specialist feedback}
```

### Plan Template (Target: ≤350 lines)

```markdown
# PLAN-NNN: {Title}

**Status**: Draft | Approved
**Spec**: [SPEC-NNN](../specs/SPEC-NNN-title.md)

## Resumption Section
- **Scope**: {From spec}
- **Current Phase**: Phase {N}: {Name}
- **Next Action**: {What to do next}
- **Blockers**: {None | Description}

## From Spec
- **Stories**: S1 ({brief}), S2 ({brief})
- **Affected Domains**: Test, E2E
- **Migration Strategy**: {Fix forward | Deprecation | Indirection | N/A}
- **Files**: F1: {path}, F2: {path}
- **Specialist Recommendations**: {Key points from spec handoff}
- **Risks**: {From spec}

## Codebase Analysis
| # | File | Changes Needed | Story |
|---|------|----------------|-------|
| F1 | {path} | {1-sentence change} | S1 |
| F2 | {path} | {1-sentence change} | S2 |

## Implementation Steps

### Phase 1: {Name}
**Step 1.1**: {Action verb + brief description}
- Files: F1
- Story: S1, AC1.1
- Verify: `{command}`
- Complexity: S

**Step 1.2**: {Action}
- Files: F1, F2
- Story: S1, AC1.2
- Verify: `{command}`
- Complexity: M

### Phase N: Final Validation
**Step N.1**: Run full validation suite
- Verify: `npm run validate:iteration`

## Verification Commands Summary
| Step | Command | Expected |
|------|---------|----------|
| 1.1 | `{command}` | {outcome} |

## Rollback Plan
| Phase | Command |
|-------|---------|
| 1 | `git checkout -- {files}` |

## Specialist Sign-Off
| Specialist | Status | Notes |
|------------|--------|-------|
| {Name} | approve | {1 sentence} |

## Execution Handoff
- **Start At**: Step 1.1
- **Escalation Path**: {who to contact}
- **Final Verification**: `npm run validate:iteration`
```
