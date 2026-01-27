# GitHub Copilot Custom Instructions

> ⚠️ **Migrated**: This directory previously contained Copilot instruction files. They have been migrated to the AGENTS.md + SKILLS.md standard.

## New Architecture

The project now uses:

| Location | Purpose |
|----------|---------|
| `AGENTS.md` (repo root) | Global project instructions |
| `.github/skills/*/SKILL.md` | On-demand skills (progressive disclosure) |
| `{dir}/AGENTS.md` | Directory-specific rules |

### Skills Available

| Skill | Purpose |
|-------|---------|
| `typescript-patterns` | TypeScript best practices |
| `testing-practices` | Vitest & Playwright testing |
| `primer-react` | Primer React component patterns |
| `agent-authoring` | Creating custom agents |
| `prompt-authoring` | Creating prompt files |

### Nested AGENTS.md Files

| Location | Purpose |
|----------|---------|
| `.github/workflows/AGENTS.md` | GitHub Actions workflow rules |
| `docs/AGENTS.md` | Spec/plan documentation standards |

## Why the Migration?

### Progressive Disclosure (60-80% Context Savings)

**Old approach**: All instructions loaded into every session.

**New approach (SKILLS.md)**:
- **Tier 1** (~100 tokens): Name + description only - always loaded
- **Tier 2** (<5000 tokens): Full skill body - loaded on activation
- **Tier 3** (as needed): Scripts, references - just-in-time loading

### Cross-Platform Compatibility

AGENTS.md is supported by:
- GitHub Copilot
- Claude (Anthropic)
- Cursor
- Codex CLI
- Gemini
- GitLab Duo

### Single Source of Truth

One file (`AGENTS.md`) instead of multiple instruction files with overlapping `applyTo` patterns.

## References

- [AGENTS.md Specification](https://agents.md)
- [SKILLS.md Specification](https://agentskills.io)
- Root `AGENTS.md` for current project conventions
