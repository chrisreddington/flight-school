---
name: prompt-authoring
description: Guidelines for creating VS Code prompt files. Use when creating new prompt files (.prompt.md) or reviewing prompt definitions.
---

# Prompt Authoring

Guidelines for creating prompt files (`.prompt.md`) that define reusable tasks triggered via `/prompt-name` in Copilot Chat.

## When to Use This Skill

- Creating new prompt files (`.prompt.md`)
- Reviewing or improving prompt definitions
- Converting inline prompts to reusable files
- Questions about prompt composition

## Prompt Composition

When you run `/generate-tests`, here's what happens:

```
Final prompt = [System] + [Instructions] + [Agent Mode] + [Prompt Body + Variables]
```

1. **Instructions loaded**: All `*.instructions.md` matching current file(s)
2. **Agent selected**: Agent from frontmatter provides workflow
3. **Prompt body added**: Your task description becomes user message

## Prompts vs Agents

| Aspect | Prompt (`.prompt.md`) | Agent (`.agent.md`) |
|--------|----------------------|---------------------|
| **Trigger** | `/command` | Dropdown or `agent:` |
| **Scope** | Single task | Entire session |
| **Defines** | What to do | How to work |
| **Reusability** | Task-specific | Behavior-specific |

**Create a Prompt when:**
- You have a specific, repeatable task
- You want to combine an existing agent with a task
- You need to capture task-specific variables

**Create an Agent when:**
- You need new behavioral specialization
- Workflow requires multiple phases
- You want reusable expertise

## Mandated Structure

| Order | Section | Required | Description |
|-------|---------|----------|-------------|
| 1 | **Frontmatter** | ✓ | `description` and `agent` |
| 2 | **Task Title** | Recommended | Clear heading |
| 3 | **Context** | Recommended | When/why to use |
| 4 | **Task** | ✓ | Specific instructions |
| 5 | **Expected Output** | Recommended | What result contains |

## Frontmatter Properties

```yaml
---
description: Brief description shown when selecting
agent: Agent Name
model: Claude Sonnet 4.5 (copilot)
tools: ['search', 'read', 'edit']
name: custom-command-name
argument-hint: Hint text in chat input
---
```

| Property | Required | Description |
|----------|----------|-------------|
| `description` | ✓ | Shown when selecting prompt |
| `agent` | ✓ | Agent name (built-in or custom) |
| `model` | Recommended | Override model |
| `name` | Optional | Command name (defaults to filename) |
| `tools` | Optional | Override available tools |

## Agent Selection

```yaml
# Built-in agents
agent: ask    # Research/read-only
agent: edit   # File modifications
agent: agent  # Complex multi-step

# Custom agents
agent: Specialist - Test
agent: Specialist - Technical Writing
```

## Variables

| Variable | Description |
|----------|-------------|
| `${file}` | Full path to current file |
| `${fileBasename}` | Current filename |
| `${selection}` | Currently selected text |
| `${workspaceFolder}` | Workspace root path |
| `${input:varName}` | Prompt user for input |
| `${input:varName:Hint text}` | Prompt with hint |

## Size Limits

| Content | Target Size | Rationale |
|---------|-------------|----------|
| Prompt body | ≤30 lines | Extract workflow to agent if longer |
| Task description | ≤10 lines | Agent handles "how" |
| Context section | ≤5 lines | Just enough to know when to use |

## Examples

### Minimal Prompt (Simple Tasks)

```markdown
---
description: Generate unit tests for current file
agent: Specialist - Test
---

Generate comprehensive unit tests for ${file}.
```

### Standard Prompt (With Context)

```markdown
---
description: Refactor function for readability
agent: Specialist - Refactor
model: Claude Sonnet 4.5 (copilot)
---

# Refactor for Readability

## Context
Use when a function violates single-responsibility principle.

## Task
Refactor ${input:functionName:Enter function name} in ${file}:

1. Extract helper functions
2. Improve variable naming
3. Add TSDoc comments
4. Ensure tests still pass

## Expected Output
- Refactored code with smaller functions
- Each function under 30 lines
```

### Read-Only Prompt

```markdown
---
description: Research-only analysis (no edits)
agent: ask
tools: ['search', 'read', 'fetch']
---

Analyze the architecture of ${workspaceFolder}:
1. Component dependencies
2. Data flow patterns
3. Potential improvements
```

## Naming Conventions

Pattern: `{verb}-{qualifier}-{object}.prompt.md`

### Standard Verbs

| Verb | Purpose | Examples |
|------|---------|----------|
| `audit` | Compliance evaluation | `audit-accessibility`, `audit-security` |
| `review` | Quality review | `review-code`, `review-tests` |
| `create` | Make new artifacts | `create-spec`, `create-plan` |
| `implement` | Build something | `implement-feature`, `implement-plan` |
| `fix` | Solve problems | `fix-flaky-test`, `fix-visual-bug` |

### File Location

- **Team-shared**: `.github/prompts/`
- **Personal**: User profile (not version controlled)

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| Duplicating agent behavior | Maintenance burden | Use `agent:` to select |
| Repeating coding standards | Auto-injected | Remove from prompt body |
| Defining workflow phases | Agent's job | Keep prompts task-focused |
| Long prompt bodies (>30 lines) | Need an agent | Extract to agent file |
| Missing `agent:` property | Won't compose correctly | Always specify |
| Missing `description:` | Won't show in picker | Always include |
| Hardcoding file paths | Breaks portability | Use variables |

## What to Cut

| Remove | Why | Instead |
|--------|-----|--------|
| Workflow phases | Agent's responsibility | Use `agent:` |
| Coding standards | Auto-injected | Delete entirely |
| "Be thorough" guidance | Model doesn't need it | Omit |
| Long examples | Clutters prompt | Link to docs |

## References

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [VS Code Copilot Customization](https://code.visualstudio.com/docs/copilot/copilot-customization)
