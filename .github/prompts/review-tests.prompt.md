---
description: Review tests - unit or E2E, quality or coverage
agent: Manager - Implement
argument-hint: Scope (e.g., src/core/, e2e/, or 'all')
---

# Review Tests

**Scope**: `${input:scope:Enter path - src/ for unit, e2e/ for E2E, or 'all'}`
**Type**: `${input:type:Type - 'unit' (default), 'e2e', or 'all'}`
**Mode**: `${input:mode:Mode - 'quality' (default), 'coverage', or 'priority'}`

## Task

Apply all patterns from [testing.instructions.md](../instructions/testing.instructions.md):
- **Test type boundary**: Use the decision rule to classify as unit vs E2E
- **Review modes**: Apply the mode-specific actions from the Test Review Modes table
- **Quality indicators**: Check against the Test Quality Indicators thresholds
- **Anti-patterns**: Identify and fix issues from the Anti-Patterns table

## Expected Output

| Rank | Target | Gap/Issue | Type | Priority | Effort |
|------|--------|-----------|------|----------|--------|
| 1 | {path} | {issue} | Unit/E2E | P0/P1/P2 | S/M/L |
