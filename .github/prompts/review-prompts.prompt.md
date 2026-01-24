---
description: Review prompt files for quality and standards conformity
agent: Specialist - Prompt Engineer
model: Claude Sonnet 4.5 (copilot)
---

# Review Prompt Files

## Task

Review all `.prompt.md` files in `.github/prompts/` against `.github/instructions/prompt-files.instructions.md`.

Skip this file (`review-prompt-files.prompt.md`) to avoid self-modification.

For each file:

1. Verify required frontmatter (`description`, `agent`)
2. Check task definition is clear and specific
3. Confirm variables use correct syntax (`${file}`, `${input:name:hint}`)
4. Ensure prompt is task-focused (workflow belongs in agents)
5. Apply any needed fixes immediately

## Expected Output

| Prompt | Quality | Agent Mode | Issues Fixed |
|--------|---------|------------|--------------|
| {name} | excellent/good/needs_improvement | ask/edit/agent | {summary} |

Report common patterns and recommendations.
