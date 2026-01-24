---
description: Review instruction files for quality and standards conformity
agent: Specialist - Prompt Engineer
argument-hint: Instruction file path or 'all' (e.g., .github/instructions/testing.instructions.md)
---

# Review Instruction Files

## Task

Review all `.instructions.md` files in `.github/instructions/` and `.github/copilot-instructions.md` against `.github/instructions/copilot-instructions.instructions.md`.

For each file:

1. Evaluate frontmatter (`applyTo`, `description`)
2. Check structure follows recommended order
3. Verify imperative language and specificity
4. Confirm examples are concrete and positive
5. Check file is under 500 lines
6. Apply any needed fixes immediately

## Expected Output

| File | Quality | Issues Fixed |
|------|---------|--------------|
| {name} | excellent/good/needs_improvement | {summary} |

Report common patterns and recommendations.
