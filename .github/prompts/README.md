# GitHub Copilot Prompt Files

Prompt templates for common development tasks. Use with `/command` in Copilot Chat.

## 📋 Naming Convention

All prompts follow the pattern: **`{verb}-{qualifier}-{object}`**

| Verb | Purpose | Formality |
|------|---------|-----------|
| `audit` | Comprehensive evaluation | Formal |
| `review` | Examine changes/config | Moderate |
| `create` | Make new artifacts | Formal |
| `execute` | Run documented plans | Formal |
| `implement` | Build informally (TDD) | Informal |
| `fix` | Diagnose and solve | Reactive |
| `analyze` | Understand or assess | Exploratory |

See [prompt-files.instructions.md](../instructions/prompt-files.instructions.md#prompt-naming-conventions) for full naming guidelines.

### Naming Philosophy

Prompt names are written to sound like **everyday requests**. Each name should read like something you'd ask a colleague to do.

| Name | Reads As | ✓/✗ |
|------|----------|-----|
| `fix-flaky-test` | "fix the flaky test" | ✓ Natural |
| `audit-unit-tests` | "audit the unit tests" | ✓ Natural |
| `analyze-test-priority` | "analyze test priority" | ✓ Natural |
| `test-unit-audit` | "test unit audit" | ✗ Awkward |

**Simple rule**: If you can read it aloud and it makes sense, the name is good.

---

## 🎯 Available Prompts

### Audits (Comprehensive Evaluation)

| Command | Purpose |
|---------|---------|
| `/audit-accessibility` | Level AA compliance check |
| `/audit-code` | Code quality and technical debt |
| `/audit-docs` | Documentation quality and code sync |
| `/audit-implementation` | Verify implementation matches spec |
| `/audit-public-release` | Comprehensive codebase audit |
| `/audit-security` | Security vulnerabilities |
| `/audit-e2e-tests` | E2E test coverage and quality |
| `/audit-unit-tests` | Unit test coverage and quality |
| `/audit-theme` | Theme submission quality |
| `/audit-tsdoc` | TSDoc and inline comments |

### Reviews (Examine Changes/Config)

| Command | Purpose |
|---------|---------|
| `/review-agents` | Review agent definitions |
| `/review-code` | PR-style code review |
| `/review-instructions` | Review instruction files |
| `/review-prompts` | Review prompt files |

### Creation (Make New Artifacts)

| Command | Purpose |
|---------|---------|
| `/create-plan` | Create implementation plan from spec |
| `/create-spec` | Discover requirements, create specification |
| `/create-workflow` | Create GitHub Actions workflow |

### Execution (Run Plans)

| Command | Purpose |
|---------|---------|
| `/execute-plan` | Execute plan with atomic updates |
| `/iterate-audit` | Iterative audit-fix loop until clean or max iterations |

### Implementation (Informal/TDD)

| Command | Purpose |
|---------|---------|
| `/implement-feature` | TDD-style feature implementation |

### Fixes (Problem Solving)

| Command | Purpose |
|---------|---------|
| `/fix-flaky-test` | Investigate and fix flaky tests |
| `/fix-visual-bug` | Debug visual issues with Playwright |

### Analysis (Understand/Assess)

| Command | Purpose |
|---------|---------|
| `/analyze-performance` | Profile performance bottlenecks |
| `/analyze-prompts` | Find new prompt opportunities |
| `/analyze-test-priority` | Prioritize test improvements |
| `/analyze-theme-architecture` | Assess theme architecture health |

---

## 🚀 Usage

### Basic
```
/audit-test-unit
```

### With Parameters
```
/create-spec featureName="Add galaxy theme"
```

### With File Context
1. Open file in editor
2. Run `/audit-theme`

---

## 📋 Prompt Structure

```markdown
---
description: Brief description
agent: Agent Name
---

# Task Title

## Task
Clear instructions with ${variables}.

## Expected Output
What the result should contain.
```

### Variables
| Variable | Description |
|----------|-------------|
| `${file}` | Current file path |
| `${selection}` | Selected text |
| `${input:name:hint}` | User input |

---

## 🔗 Related

- [Prompt Naming Conventions](../instructions/prompt-files.instructions.md#prompt-naming-conventions)
- [Custom Agents](../agents/README.md)
- [Instructions](../instructions/README.md)
- [VS Code Copilot](https://code.visualstudio.com/docs/copilot/copilot-chat)
