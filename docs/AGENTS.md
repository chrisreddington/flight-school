# Specification & Plan Documentation Standards

> Nested AGENTS.md for `docs/` directory. These rules apply when working with specification and implementation plan documents.

## Core Principles

### Less is More
- **Prefer bullets over prose** - Lists scan faster than paragraphs
- **Prefer tables over narratives** - Structured data is easier to consume
- **Omit empty sections** - Don't include sections with "None"
- **One source of truth** - Don't repeat information

### Separation of Concerns
- **SPEC = WHAT** - Requirements, acceptance criteria, user stories
- **PLAN = HOW** - Implementation steps, file changes, verification commands
- **No code in specs** - Code belongs in plans or implementation

## Document Size Limits

| Document Type | Target | Hard Limit |
|---------------|--------|------------|
| Specification | 150-250 lines | 300 lines |
| Implementation Plan | 200-350 lines | 400 lines |

If exceeding limits:
1. Split into multiple focused specs/plans
2. Reduce detail (defer to implementation)
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

### Design Decisions Format

```markdown
## Design Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DD1 | Use Grid pattern over Listbox | WCAG APG recommends for interactive items |
| DD2 | Store duration as seconds | Single source of truth, avoids parsing |
```

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
| Multi-paragraph actions | Too verbose | Use bullet points |
| Re-analysis of codebase | Spec did this | Reference spec's file list |
| >10 phases | Too granular | Consolidate related steps |

## File Naming

### Specs
```
docs/specs/SPEC-NNN-kebab-case-title.md
```

### Plans
```
docs/plans/PLAN-NNN-kebab-case-title.md
```

## Architecture Review Checklist

Plans MUST address these concerns:

### Code Organization
- [ ] Large modules (>300 lines) are split
- [ ] Tests are co-located with source
- [ ] Entry points export only
- [ ] Related functionality grouped in folders

### Naming Consistency
- [ ] New code follows existing patterns
- [ ] Constants use consistent casing
- [ ] Functions are descriptively named

### Separation of Concerns
- [ ] Core modules don't import feature-specific code
- [ ] Features don't cross-import from siblings
- [ ] State management follows established patterns

### DRY Principles
- [ ] No duplicate interfaces/types
- [ ] Shared utilities extracted
- [ ] Configuration centralized

## Anti-Patterns

| Anti-Pattern | Problem | Correct Approach |
|--------------|---------|------------------|
| Code in specs | Mixes WHAT with HOW | Defer code to plans |
| 500+ line specs | Unreadable | Split or condense |
| Empty sections | Visual noise | Omit entirely |
| Narrative feedback | Hard to scan | Use tables and bullets |
| Timeframe estimates | False expectations | Use S/M/L complexity only |
| Full file content in plans | Execute agent's job | Describe changes only |
