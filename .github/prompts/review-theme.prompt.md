---
description: Review theme submission for standards compliance and quality
agent: Specialist - Code Quality
argument-hint: Theme path (e.g., src/themes/my-theme/)
---

# Review Theme

**Theme**: `${input:themePath:Theme path to review (e.g., src/themes/my-theme/)}`
**Mode**: `${input:mode:Mode - 'quick' (structure + exports) or 'full' (all checks)}`

## Context

Friendly review for theme contributors. Validates against project standards and provides actionable feedback.

## Task

Review theme at specified path. Agent handles checklist details per `themes.instructions.md`.

### Quick Mode
Structure, exports, and critical architecture violations only.

### Full Mode (default)
All checks: structure, exports, ThemeController compliance, architecture, code quality, accessibility, tests, registry.

## Expected Output

| Category | Status | Issues |
|----------|--------|--------|
| {category} | ✅/⚠️/❌ | {count} |

**Verdict**: Approve / Suggestions / Needs Changes

Prioritized feedback with specific fixes.
