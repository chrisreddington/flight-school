---
description: Review documentation - markdown docs or TSDoc comments
agent: Manager - Markdown Docs
argument-hint: Scope (e.g., docs/, src/core/, README.md)
---

# Review Documentation

**Scope**: `${input:scope:Enter scope - docs/, src/core/, README.md, or specific path}`
**Type**: `${input:type:Type - 'markdown' (default), 'tsdoc', or 'all'}`
**Mode**: `${input:mode:Mode - 'analyze' (read-only), 'sync' (fix issues), or 'audit' (comprehensive)}`

## Context

Unified documentation review covering markdown docs and TSDoc comments.

## Task

### Type: markdown
README, guides, instruction files, specs/plans. Checks freshness, links, code examples.

### Type: tsdoc
TSDoc comments on exports. Checks coverage, accuracy, right-sizing (doc ≤ code).
See [documentation.instructions.md](../instructions/documentation.instructions.md) for standards.

### Type: all (default)
Both markdown and TSDoc in scope.

---

### Mode: analyze
Read-only gap analysis. Reports issues without changes.

### Mode: sync
Fix identified issues: update stale content, fix links, sync examples.

### Mode: audit
Comprehensive review with quality scoring and prioritized recommendations.

## Expected Output

| Document/Symbol | Status | Issues | Priority |
|-----------------|--------|--------|----------|
| {path} | ✅/⚠️/❌ | {count} | P1/P2/P3 |

Summary with critical gaps and quick wins.
