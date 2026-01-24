---
applyTo: "**/*.prompt.md"
description: Guidelines for creating VS Code prompt files
---

# Creating VS Code Prompt Files

Guidelines for creating prompt files (`.prompt.md`) that define reusable tasks triggered via `/prompt-name` in Copilot Chat.

## Key Concepts

Prompt files are **task entry points**. They select the agent, model, and define what to do:

```
┌─────────────────────────────────────────────────────────────────┐
│  Instructions (*.instructions.md)                               │
│    ← Auto-injected based on applyTo patterns                    │
│    ← Contains: Coding standards, patterns, file conventions     │
│    ← AUTOMATICALLY INCLUDED - no need to repeat                 │
├─────────────────────────────────────────────────────────────────┤
│  Agent (*.agent.md)                                             │
│    ← Selected via `agent:` frontmatter property                 │
│    ← Contains: Workflow, expertise, personality, handoffs       │
│    ← REFERENCE BY NAME - don't duplicate agent behavior         │
├─────────────────────────────────────────────────────────────────┤
│  Prompt (*.prompt.md) ← YOU ARE HERE                            │
│    ← Triggered via /command                                     │
│    ← Contains: Task description, variables, overrides           │
│    ← THIS IS WHERE TASK-SPECIFIC DETAILS GO                     │
└─────────────────────────────────────────────────────────────────┘
```

### What Belongs in Prompts (vs Other Files)

| Content | Prompt File | Agent File | Instruction File |
|---------|-------------|------------|------------------|
| Task description | ✓ | ✗ | ✗ |
| Input variables | ✓ | ✗ | ✗ |
| Which agent to use | ✓ | ✗ | ✗ |
| Model override | ✓ | ✓ (default) | ✗ |
| Tool override | ✓ | ✓ (default) | ✗ |
| Workflow phases | ✗ | ✓ | ✗ |
| Agent personality | ✗ | ✓ | ✗ |
| Coding standards | ✗ | ✗ | ✓ |
| Project patterns | ✗ | ✗ | ✓ |

### Prompt vs Agent Files

| Aspect | Prompt (`.prompt.md`) | Agent (`.agent.md`) |
|--------|----------------------|---------------------|
| **Trigger** | `/command` | Selected from dropdown or via prompt `agent:` |
| **Scope** | Single task | Entire session |
| **Use case** | Repeatable tasks | Specialized workflows |
| **Defines** | What to do | How to work |
| **Reusability** | Task-specific | Behavior-specific |

### Composability

When you run `/generate-tests`, here's what happens:

1. **Instructions loaded**: All `*.instructions.md` files matching the current file(s) are auto-injected
2. **Agent selected**: The agent specified in frontmatter provides its workflow
3. **Prompt body added**: Your task description becomes the user message

```
Final prompt = [System] + [Instructions] + [Agent Mode] + [Prompt Body + Variables]
```

---

## Rules and Guidelines

### Mandated Prompt File Structure (Required Ordering)

Prompt files **MUST** follow this section order:

| Order | Section | Required | Description |
|-------|---------|----------|-------------|
| 1 | **Frontmatter** | ✓ | `description` and `agent` properties (minimum) |
| 2 | **Task Title** | Recommended | Clear heading for complex prompts |
| 3 | **Context** | Recommended | When/why to use this prompt |
| 4 | **Task** | ✓ | Clear, specific instructions |
| 5 | **Expected Output** | Recommended | What the result should contain |

### Frontmatter Properties

| Property | Required | Description |
|----------|----------|-------------|
| `description` | ✓ | Shown when selecting prompt |
| `agent` | ✓ | Agent name: built-in (`agent`, `ask`, `edit`) or custom agent name |
| `model` | Recommended | Override model for specific reasoning needs |
| `name` | Optional | Command name (defaults to filename) |
| `tools` | Optional | Override available tools |
| `argument-hint` | Optional | Hint text in chat input |

### File Location

- **Team-shared:** `.github/prompts/`
- **Personal:** User profile (not version controlled)

### Agent Selection (Required)

**Always specify an agent** — this is how prompt composition works:

```yaml
# Built-in agents
agent: ask    # Research/read-only tasks
agent: edit   # File modifications
agent: agent  # Complex multi-step tasks

# Custom agents (use exact name from agent.md)
agent: Specialist - Test
agent: Specialist - Technical Writing
agent: Plan
```

### Model Selection (Optional Override)

Override the agent's default model when needed:

```yaml
# For heavy reasoning tasks
model: Claude Opus 4.5 (copilot)

# For fast, simple tasks
model: Claude Haiku 4.5 (copilot)

# For coding-focused tasks
model: GPT-5.1-Codex-Max (copilot)
```

### Variables

| Variable | Description |
|----------|-------------|
| `${file}` | Full path to current file |
| `${fileBasename}` | Current filename |
| `${selection}` | Currently selected text |
| `${workspaceFolder}` | Workspace root path |
| `${input:varName}` | Prompt user for input |
| `${input:varName:Hint text}` | Prompt with hint |

### When to Create a Prompt vs Agent

**Create a Prompt when:**
- You have a specific, repeatable task
- You want to combine an existing agent with a task description
- You need to capture task-specific variables

**Create an Agent when:**
- You need a new behavioral specialization
- The workflow requires multiple phases or handoffs
- You want reusable expertise across many prompts

### Size and Conciseness (CRITICAL)

**Research-backed limits:**

| Content | Target Size | Rationale |
|---------|-------------|----------|
| Prompt body | ≤30 lines | If longer, extract workflow to agent |
| Task description | ≤10 lines | Be direct; agent handles the "how" |
| Context section | ≤5 lines | Just enough to know when to use |

**Minimal is better:**
- Prompts should be **task entry points**, not mini-agents
- The agent provides workflow; the prompt provides what to do
- If your prompt has phases or stopping rules, it should be an agent

**What to cut:**

| Remove | Why | Instead |
|--------|-----|--------|
| Workflow phases | Agent's responsibility | Use `agent:` to select agent |
| Coding standards | Auto-injected from instructions | Delete entirely |
| "Be thorough" guidance | Model doesn't need encouragement | Omit |
| Long examples | Task-specific; clutters prompt | Link to docs or omit |

---

## Examples

### Recommended Prompt File Structure

```markdown
---
description: Brief description shown when selecting this prompt
agent: Agent Name
model: Model Name (copilot)
tools: ['tool1', 'tool2']
---

# Task Title (optional but recommended for complex prompts)

## Context
Brief explanation of when/why this prompt is useful.

## Task
Clear, specific instructions for what the agent should do.

Use ${file} for the current file.
Use ${selection} for selected text.
Use ${input:varName:Hint} for user input.

## Expected Output (if applicable)
Describe what the result should look like or contain.
```

### Minimal Prompt (Preferred for Simple Tasks)

```markdown
---
description: Generate unit tests for current file
agent: Specialist - Test
---

Generate comprehensive unit tests for ${file}.
```

### Standard Prompt (For Tasks Needing Context)

```markdown
---
description: Refactor function for readability
agent: Specialist - Refactor
model: Claude Sonnet 4.5 (copilot)
---

# Refactor for Readability

## Context
Use this prompt when a function has grown too complex or violates
single-responsibility principle.

## Task
Refactor the function ${input:functionName:Enter function name} in ${file}:

1. Extract helper functions for distinct responsibilities
2. Improve variable naming for clarity
3. Add TSDoc comments to extracted functions
4. Ensure all existing tests still pass

## Expected Output
- Refactored code with smaller, focused functions
- Each function under 30 lines
- Descriptive names that explain intent
```

### Advanced Prompt (With Variables and Overrides)

```markdown
---
description: Security review with compliance check
agent: Specialist - Security
model: Claude Opus 4.5 (copilot)
tools: ['search', 'read', 'fetch']
---

# Security Compliance Review

## Context
Perform a security review focused on ${input:compliance:Compliance standard (e.g., OWASP, SOC2)}.

## Task
Review ${file} for security vulnerabilities:

1. **Input Validation**: Check all user inputs are sanitized
2. **Authentication**: Verify auth checks on sensitive operations
3. **Data Exposure**: Ensure no PII leakage in logs or responses
4. **Dependencies**: Flag any known vulnerable patterns

Focus areas: ${input:focusAreas:Specific areas to prioritize (optional)}

## Expected Output
Structured report with:
- Severity-ranked findings
- Code locations with line numbers
- Recommended fixes with examples
```

### Prompt with Tool Override (Read-Only)

```markdown
---
description: Research-only analysis (no edits)
agent: ask
tools: ['search', 'read', 'fetch']
---

Analyze the architecture of ${workspaceFolder} and document:
1. Component dependencies
2. Data flow patterns
3. Potential improvements
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| Duplicating agent behavior | Creates maintenance burden; agent already defines workflow | Use `agent:` to select an existing agent |
| Repeating coding standards | Instruction files are auto-injected | Remove standards from prompt body |
| Defining workflow phases | That's the agent's job | Keep prompts task-focused |
| Long prompt bodies | Signal that you need an agent | Extract workflow to agent file |
| Missing `agent:` property | Prompt won't compose correctly | Always specify an agent |
| Missing `description:` | Won't show in prompt picker | Always include description |
| Hardcoding file paths | Breaks portability | Use `${file}`, `${workspaceFolder}` variables |

---

## Prompt Naming Conventions

Prompt filenames follow the pattern: `{verb}-{qualifier}-{object}.prompt.md`

- **verb** (required): The action being performed
- **qualifier** (optional): Narrows the scope (e.g., `flaky`, `visual`)
- **object** (required): What the verb acts on (e.g., `test`, `docs`, `feature`)

### Standard Verbs (5 Total)

| Verb | Purpose | Formality | Examples |
|------|---------|-----------|----------|
| `audit` | Compliance evaluation against standards | Formal | `audit-accessibility`, `audit-security`, `audit-implementation` |
| `review` | Quality review with modes (quick/deep/etc.) | Moderate | `review-code`, `review-docs`, `review-tests`, `review-theme` |
| `create` | Make new artifacts | Formal | `create-spec`, `create-plan`, `create-workflow` |
| `implement` | Build something or execute a plan | Formal | `implement-feature`, `implement-plan` |
| `fix` | Diagnose and solve problems | Reactive | `fix-flaky-test`, `fix-visual-bug` |

### Formality Spectrum

```
Formal Workflow (Spec → Plan → Implement → Audit)
├── create-spec              # Define what to build
├── create-plan              # Plan how to build it
├── implement-plan           # Build following the plan
└── audit-implementation     # Verify it was built correctly

Informal Workflow (just do it)
└── implement-feature        # TDD-style, build as you go
```

### Naming Philosophy

Prompt names are designed to read like **plain English sentences**. When you see a prompt name, you should be able to read it aloud and immediately understand what it does.

**The pattern**: `{verb}-{noun}` or `{verb}-{adjective}-{noun}`

**Good examples** (read naturally):
- `fix-flaky-test` → "fix flaky test"
- `create-plan` → "create plan"
- `audit-unit-tests` → "audit unit tests"
- `review-code` → "review code"

**Flexibility for readability**: Sometimes the natural word order isn't strictly verb-noun. That's fine! Readability wins:
- `analyze-test-priority` → "analyze test priority" ✓ (reads naturally)
- `analyze-priority-test` → "analyze priority test" ✗ (awkward)

**The test**: Read the prompt name aloud. If it sounds like something you'd say to a colleague ("Hey, can you audit the unit tests?"), it's named well.

### Current Prompts by Verb

| Verb | Prompts |
|------|---------|
| `audit` | accessibility, implementation, security |
| `review` | agents, code, docs, instructions, prompts, tests, theme |
| `create` | plan, spec, workflow |
| `implement` | feature, plan |
| `fix` | flaky-test, visual-bug |

### Naming Guidelines

1. **Verb-first**: Always start with the action verb
2. **Use kebab-case**: `review-code` not `review_code`
3. **Use modes over separate prompts**: `review-tests` with `type: unit/e2e` instead of separate prompts
4. **Be specific**: `audit-accessibility` not `audit-a11y`
5. **Match formality**: Use `audit` for compliance, `review` for quality checks

---

## References

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot) - Official Copilot documentation
- [VS Code Custom Instructions](https://code.visualstudio.com/docs/copilot/copilot-customization) - VS Code Copilot customization guide
- [copilot-instructions.instructions.md](.github/instructions/copilot-instructions.instructions.md) - Instruction file standards
- [custom-agents.instructions.md](.github/instructions/custom-agents.instructions.md) - Agent file standards
