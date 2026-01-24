---
applyTo: "**/{copilot-instructions.md,*.instructions.md,AGENTS.md,CLAUDE.md,GEMINI.md}"
description: Standards for creating and maintaining GitHub Copilot custom instruction files
---

# GitHub Copilot Custom Instructions

Standards for writing effective Copilot instruction files that define coding conventions, patterns, and constraints.

## Key Concepts

GitHub Copilot composes prompts from three file types. Understanding their roles prevents duplication:

```
┌─────────────────────────────────────────────────────────────────┐
│                     PROMPT COMPOSITION                          │
├─────────────────────────────────────────────────────────────────┤
│  System Message (built-in)                                      │
│    ↓                                                            │
│  Instructions Files (*.instructions.md)                         │
│    • Auto-loaded based on applyTo patterns                      │
│    • Injected as <instructions> in every matching session       │
│    • PURPOSE: Coding conventions, patterns, constraints         │
│    ↓                                                            │
│  Agent Instructions (from selected agent.md)                    │
│    • Injected as <modeInstructions> when agent selected         │
│    • PURPOSE: Behavioral expertise, workflow, specialization    │
│    ↓                                                            │
│  User Message (prompt file + user input)                        │
│    • Task-specific context and request                          │
│    • PURPOSE: What to do this time                              │
└─────────────────────────────────────────────────────────────────┘
```

### What Goes Where

| Content Type | Instructions (*.instructions.md) | Agents (*.agent.md) | Prompts (*.prompt.md) |
|--------------|----------------------------------|---------------------|----------------------|
| **Coding standards** | ✓ | ✗ | ✗ |
| **File patterns** | ✓ (via applyTo) | ✗ | ✗ |
| **Error handling patterns** | ✓ | ✗ | ✗ |
| **Agent personality/role** | ✗ | ✓ | ✗ |
| **Workflow phases** | ✗ | ✓ | ✗ |
| **Tool configuration** | ✗ | ✓ | ✓ (override) |
| **Model selection** | ✗ | ✓ | ✓ (override) |
| **Handoffs** | ✗ | ✓ | ✗ |
| **Task description** | ✗ | ✗ | ✓ |
| **Input variables** | ✗ | ✗ | ✓ |
| **Which agent to use** | ✗ | ✗ | ✓ |

---

## Rules and Guidelines

### Mandated Structure (Required Ordering)

Instruction files **MUST** follow this section order:

| Order | Section | Required | Description |
|-------|---------|----------|-------------|
| 1 | **Frontmatter** | ✓ | `applyTo` and `description` properties |
| 2 | **Title & Purpose** | ✓ | Clear heading + one-sentence purpose |
| 3 | **Key Concepts** | Optional | Define domain terms if needed |
| 4 | **Rules/Guidelines** | ✓ | Core content organized by category |
| 5 | **Examples** | ✓ | Demonstrate rules in practice |
| 6 | **Anti-Patterns** | Recommended | Table of patterns to avoid |
| 7 | **References** | Recommended | Links to supporting documentation |

### Frontmatter Properties

| Property | Required | Description |
|----------|----------|-------------|
| `applyTo` | ✓ | Glob pattern for file matching |
| `description` | ✓ | Brief description of scope |
| `excludeAgent` | Optional | Exclude from specific agents (e.g., `"code-review"`) |

### File Types

**Repository-Wide (`copilot-instructions.md`)**
- Location: `.github/copilot-instructions.md`
- Include: Project overview, build/test/lint commands, key file locations, security patterns
- Exclude: Language-specific rules (use path-specific files), task-specific instructions (use prompts), agent behaviors (use agents)

**Path-Specific (`*.instructions.md`)**
- Location: `.github/instructions/`
- Require frontmatter with `applyTo` and `description`
- Auto-injected into all chat sessions where pattern matches

**Agent Instructions (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)**
- For AI agent-specific instructions
- Nearest file in directory tree takes precedence

### Writing Style

- **Use imperative, direct language** — Write as if communicating to a skilled junior developer
- **Pass the "intern test"** — Can an intern correctly follow these instructions given only what's written?
- **Be specific and measurable** — Avoid vague terms like "appropriate" or "good"
- **Use constraints to narrow scope** — Define exactly what to do, not open-ended guidance

### Structure and Formatting

- **Choose one format** (XML or Markdown) and use it consistently within a single file
- **Prioritize critical instructions** — Place essential behavioral constraints at the beginning
- **Keep instructions under 500 lines** — Target ~2 pages maximum per file
- **Split large rules** into multiple, composable instruction files

### Size and Conciseness (CRITICAL)

**Research-backed limits (from GitHub, OpenAI, Anthropic):**

| Content | Target Size | Rationale |
|---------|-------------|----------|
| `copilot-instructions.md` | ≤2 pages (~1,500 words) | GitHub's official recommendation |
| Path-specific instructions | ≤500 lines | Split if larger |
| Individual sections | ≤50 lines | Break into subsections if longer |
| Anti-patterns table | 5-10 rows | Focus on critical mistakes |

**What to prioritize (static content first for prompt caching):**
1. Project structure and key file locations
2. Build/test/lint commands
3. Critical patterns and constraints
4. Anti-patterns table

**What to cut:**

| Remove | Why | Instead |
|--------|-----|--------|
| "Be thorough" prompts | Modern models don't need encouragement; causes over-searching | Omit |
| Explanations for obvious rules | Wastes tokens | State the rule directly |
| Duplicated content across files | Maintenance burden; prompt bloat | Single source of truth |
| Verbose examples | 1-2 good examples > 5 verbose ones | Keep the best |
| Edge cases rarely hit | Clutters core guidance | Separate reference doc |

**Contradictions damage model performance:**
- Modern models (GPT-5, Claude) spend reasoning tokens reconciling conflicts
- Review instruction files for contradictory guidance before committing
- Apply the "intern test": Can someone follow these instructions without asking clarifying questions?

### Context Management

- **Supply all context FIRST** — Place specific instructions at the END
- **Use anchor phrases** after large data blocks: "Based on the information above..."
- **Leverage prompt caching** — Keep reusable content at the BEGINNING

### Glob Patterns

```yaml
applyTo: "**/*.{ts,tsx}"           # All TypeScript files
applyTo: "**/*.test.{ts,tsx}"      # Test files only
applyTo: "src/components/**/*.tsx" # Components only
applyTo: "src/themes/**/*.ts"      # Theme files
applyTo: "**/*.{yml,yaml}"         # YAML files
```

Glob examples:
- `*` — All files in current directory
- `**` or `**/*` — All files recursively
- `**/*.ts` — TypeScript files recursively
- `src/**/*.ts` — TypeScript files under src/

### Maintenance

**Critical Synchronization Requirements:**
- **When adding new modules/files**: Immediately update project structure in `copilot-instructions.md`
- **When deprecating code**: Add `@deprecated` TSDoc with replacement guidance immediately
- **When modularizing components**: Update directory structure to reflect new subdirectories
- **When removing files**: Remove references from all instruction files

**Regular Validation:**
- Validate commands actually work before documenting them
- Document errors and their workarounds when discovered
- Use language like "always" or "never" for critical requirements
- Keep examples up-to-date with current codebase patterns
- Update this file when establishing new instruction file patterns
- Review quarterly to ensure instruction files reflect current codebase reality

**Documentation Quality Checks:**
- TSDoc completeness: All public functions have `@param` and `@returns`
- No point-in-time comments: Replace temporal comments ("currently", "right now") with timeless explanations
- Deprecation notices: Use `@deprecated` tag with explanation and alternative
- Project structure accuracy: Directory trees match actual filesystem
- Module listings: All significant files/subdirectories documented

---

## Examples

### Recommended Instruction File Structure

```markdown
---
applyTo: "glob/pattern/**/*.{ext}"
description: Brief description of what this instruction covers
---

# Title: Clear, Descriptive Name

One-sentence purpose statement explaining what this instruction file provides.

## Key Concepts (if needed)

| Term | Definition |
|------|------------|
| **Term 1** | Clear definition |
| **Term 2** | Clear definition |

## Rules and Guidelines

### Category 1
- Rule with specific, actionable guidance
- Rule with measurable criteria

### Category 2
- Rule using imperative language
- Rule that passes the "intern test"

## Examples

### Good Pattern
```typescript
// ✅ Descriptive example showing correct approach
const example = doThingCorrectly();
```

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|------------------|
| Pattern name | Impact description | Recommended alternative |

## References

- [Link text](url) - Brief description
```

### Writing Style Examples

```markdown
<!-- ❌ Avoid: Narrative style -->
When reviewing code, it would be good if you could try to look for...

<!-- ✅ Prefer: Imperative bullets -->
## Security
- Check for hardcoded secrets
- Validate all user inputs
- Use parameterized queries
```

### Specificity Examples

```markdown
<!-- ❌ Vague -->
- Write good tests

<!-- ✅ Specific -->
- Name tests: "should [expected behavior] when [condition]"
- Include at least one test per exported function
- Use table-driven tests for multiple input scenarios
```

```markdown
<!-- ❌ Open-ended -->
- Handle errors appropriately

<!-- ✅ Constrained -->
- Wrap all async operations in try/catch
- Log errors with context: `logger.error('operation failed', { error, userId })`
- Return structured error responses: `{ success: false, error: string }`
```

### Delimiter Format Examples

**XML-style structure:**
```xml
<role>
You are a senior solution architect.
</role>

<constraints>
- No external libraries allowed.
- Python 3.11+ syntax only.
</constraints>
```

**Markdown structure:**
```markdown
# Identity
You are a coding assistant...

# Instructions
* Use snake case names...
* Document public APIs...
```

### Positive Pattern Examples

```markdown
<!-- ❌ Less effective: Anti-pattern example -->
Don't end haikus with a question:
Haiku are fun / A short poem / Don't you enjoy them?

<!-- ✅ More effective: Positive pattern -->
Always end haikus with an assertion:
Haiku are fun / A short poem / A joy to write
```

```typescript
// ❌ Avoid: Inconsistent naming
const d = new Date();
const usr = getUser();

// ✅ Prefer: Descriptive naming
const currentDate = new Date();
const authenticatedUser = getUser();
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| Duplicating coding standards in agents | Instructions files handle this automatically | Reference instruction files; agents define behavior only |
| Putting agent behavior in instructions files | Agents define their own expertise | Keep behavior in agent files |
| Repeating agent selection logic in prompts | Creates maintenance burden | Set `agent:` once in frontmatter |
| Embedding task-specific details in agents | Agents are reusable; prompts are specific | Put task details in prompt files |
| Relying on models for factual information | Models can hallucinate | Use retrieval/tools for facts |
| Using math/logic without verification | Models make calculation errors | Verify with code execution |
| Vague or subjective instructions | Inconsistent behavior | Be specific and measurable |
| Contradictory instructions | Confuses the model | Pass the "intern test" |
| Adding complexity without need | Harder to maintain, debug | Start simple, add complexity only when necessary |
| Showing anti-patterns in examples | Model may reproduce them | Show only desired patterns |
| Excessive abstraction layers | Obscures intent | Keep implementations transparent |
| Duplicating rules across file types | Maintenance burden, inconsistency | Follow separation of concerns |

---

## References

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot) - Official Copilot documentation
- [VS Code Custom Instructions](https://code.visualstudio.com/docs/copilot/copilot-customization) - VS Code Copilot customization guide
- [custom-agents.instructions.md](.github/instructions/custom-agents.instructions.md) - Agent file standards
- [prompt-files.instructions.md](.github/instructions/prompt-files.instructions.md) - Prompt file standards
