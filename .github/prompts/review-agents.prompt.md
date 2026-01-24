---
description: Review agent definitions for quality and standards conformity
agent: Specialist - Prompt Engineer
argument-hint: Agent file path or 'all' (e.g., .github/agents/specialist-test.agent.md)
---

# Review Agent Definitions

## Task

Review all `.agent.md` files in `.github/agents/` against `.github/instructions/custom-agents.instructions.md`.

For each agent:

1. Evaluate frontmatter completeness
2. Check role boundaries clarity
3. Verify workflow structure and stopping rules
4. Confirm output format templates exist
5. Apply any needed fixes immediately

## Expected Output

| Agent | Quality | Issues Fixed |
|-------|---------|--------------|
| {name} | excellent/good/needs_improvement | {summary} |

Report common patterns and recommendations.
