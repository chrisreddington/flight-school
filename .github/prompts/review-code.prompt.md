---
description: Review code quality - quick check or deep audit
agent: Manager - Implement
argument-hint: Path, 'staged', or 'unstaged'
---

# Review Code

**Scope**: `${input:scope:Enter file path, 'staged', or 'unstaged' for git changes}`
**Mode**: `${input:mode:Mode - 'quick' (default), 'deep', 'structure', 'smells', or 'debt'}`

## Context

Code quality review from quick PR checks to deep refactoring audits with automated tech debt detection.

## Task

### Mode: quick (default)
Fast review: patterns, DRY, type safety, error handling, naming.

### Mode: deep
Iterative audit (max 3 iterations per subfolder). Runs both structure and smells, flags doc/test gaps.

### Mode: structure
File size (>350 lines), function length (>40 lines), nesting depth (>3 levels), architecture violations.

### Mode: smells
Duplicated code, magic numbers, cryptic names, dead code.

### Mode: debt
Full tech debt analysis using automated tools:
1. **Unused code**: `npm run debt:unused` (knip)
2. **Unused exports**: `npm run debt:exports` (ts-prune)
3. **Unused deps**: `npm run debt:deps` (depcheck)
4. **Circular deps**: `npm run debt:circular` (madge)

**Analysis order**:
1. Run all debt checks
2. Filter false positives (test mocks, build configs)
3. Prioritize findings: P0 (breaks build) > P1 (dead code) > P2 (tech debt)
4. For circular deps: identify breaking point, suggest refactor pattern

## Tech Debt Tools

| Tool | Command | Checks | When to Run |
|------|---------|--------|-------------|
| **knip** | `npm run debt:unused` | Unused files, exports, deps, types | Before major refactor |
| **ts-prune** | `npm run debt:exports` | Unused TypeScript exports | PR review |
| **depcheck** | `npm run debt:deps` | Unused dependencies | Monthly |
| **madge** | `npm run debt:circular` | Circular dependencies | Architecture changes |

**Running all checks**: `npm run debt:check`

## Expected Output

| Priority | Issue | Location | Tool | Recommendation |
|----------|-------|----------|------|----------------|
| P0/P1/P2 | {desc} | {file:line} | {tool} | {fix} |

**Verdict**: Approve / Suggestions / Needs Changes

**Summary stats** (debt mode only):
- Unused files: N
- Unused exports: N
- Unused deps: N
- Circular deps: N cycles

