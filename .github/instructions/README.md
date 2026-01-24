# GitHub Copilot Custom Instructions

This directory contains instruction files that embed the countdown project's coding standards, patterns, and best practices directly into GitHub Copilot. As you work on the codebase, Copilot receives context about what we expect—from TypeScript naming conventions to theme architecture—to provide relevant guidance.

## 📚 Documentation

**VS Code Guide:** [Use custom instructions in VS Code](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)

**GitHub Docs:** [Add repository custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)

**Best Practices:** [Writing effective custom instructions](https://docs.github.com/en/copilot/concepts/prompting/response-customization#writing-effective-custom-instructions) - Learn how to write short, self-contained instructions that are broadly applicable and effective.

**Coding Agent Guide:** [Adding custom instructions to your repository](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results#adding-custom-instructions-to-your-repository) - Part of the best practices guide for getting the best results from Copilot coding agent, including repository-wide and path-specific instructions.

**Tutorial:** [Using custom instructions to unlock the power of Copilot code review](https://docs.github.com/en/copilot/tutorials/use-custom-instructions) - Comprehensive guide on structuring, organizing, and testing custom instructions for code review workflows.

**Community Examples:** [awesome-copilot repository](https://github.com/github/awesome-copilot) - See curated examples and patterns from other projects to inspire your own custom instructions.

## 📋 Available Instruction Files

| File | Applies To | Purpose |
|------|------------|---------|
| [`assets-sync.instructions.md`](assets-sync.instructions.md) | `**/ASSETS.md` | Asset synchronization rules for theme and root ASSETS.md files |
| [`complex-theme-patterns.instructions.md`](complex-theme-patterns.instructions.md) | `src/themes/**/*.{ts,css,scss}` | Advanced patterns for complex themes with animations and state |
| [`copilot-instructions.instructions.md`](copilot-instructions.instructions.md) | `**/{copilot-instructions.md,*.instructions.md,AGENTS.md,CLAUDE.md,GEMINI.md}` | Standards for creating custom instruction files |
| [`custom-agents.instructions.md`](custom-agents.instructions.md) | `**/*.agent.md` | Guidelines for creating GitHub Copilot custom agents |
| [`documentation.instructions.md`](documentation.instructions.md) | `**/*.{ts,tsx}` | TSDoc and code documentation standards (SINGLE SOURCE OF TRUTH) |
| [`github-actions.instructions.md`](github-actions.instructions.md) | `.github/workflows/**/*.{yml,yaml}` | Workflow patterns, security, SHA pinning |
| [`manager-agents.instructions.md`](manager-agents.instructions.md) | `.github/agents/manager-*.agent.md` | Patterns for Manager agents that orchestrate multi-stage workflows |
| [`perf-analysis.instructions.md`](perf-analysis.instructions.md) | `**/*.{ts,tsx,spec.ts}` | Performance monitoring and analysis guidelines |
| [`prompt-files.instructions.md`](prompt-files.instructions.md) | `**/*.prompt.md` | Guidelines for creating VS Code prompt files |
| [`pwa.instructions.md`](pwa.instructions.md) | `src/{app,components}/pwa/**/*.ts` | Progressive Web App development guidelines |
| [`spec-plan-docs.instructions.md`](spec-plan-docs.instructions.md) | `docs/{specs,plans}/*.md` | Standards for specification and implementation plan documents |
| [`specialist-agents.instructions.md`](specialist-agents.instructions.md) | `.github/agents/specialist-*.agent.md` | Patterns for Specialist agents that provide domain expertise |
| [`testing.instructions.md`](testing.instructions.md) | `**/*.{test,spec}.{ts,tsx}` | Testing best practices for Vitest and Playwright tests |
| [`themes.instructions.md`](themes.instructions.md) | `src/themes/**/*.ts` | Theme architecture, lifecycle, and development patterns |
| [`typescript.instructions.md`](typescript.instructions.md) | `**/*.{ts,tsx}` | TypeScript best practices for clean, maintainable code |


## ✍️ Creating New Instructions

### File Structure

```markdown
---
applyTo: "glob/pattern/**/*.ext"
description: Brief description of what this covers
---

# Title

Purpose statement explaining what this instruction file provides.

## Rules and Guidelines

Specific, actionable rules organized by category.

## Examples

Code examples showing correct patterns.

## Anti-Patterns

Table of patterns to avoid with explanations.

## References

Links to relevant documentation.
```

### Best Practices

1. **Be specific** - Use concrete examples, not vague guidelines
2. **Use imperative language** - "Use X" not "You should consider X"
3. **Show examples** - Code snippets are more effective than descriptions
4. **Keep it focused** - One instruction file per domain
5. **Link to docs** - Reference official documentation for deep dives

### Glob Pattern Examples

```yaml
applyTo: "**/*.ts"              # All TypeScript files
applyTo: "**/*.test.ts"         # Test files only
applyTo: "src/themes/**/*.ts"   # Theme files
applyTo: ".github/workflows/**" # GitHub Actions workflows
```

## 🔄 Testing Your Instructions

1. **Create or edit** an instruction file
2. **Open a matching file** in VS Code
3. **Ask Copilot** a question related to your instructions
4. **Verify** it follows your guidelines

Example: If you add instructions about naming conventions, open a TypeScript file and ask Copilot to create a new function - it should follow your naming rules.

## 📏 Instruction File Standards

This project follows these standards for instruction files:

### Required Sections

1. **Frontmatter** - `applyTo` and `description`
2. **Title & Purpose** - Clear heading + one-sentence purpose
3. **Rules/Guidelines** - Core content organized by category
4. **Examples** - Demonstrate rules in practice
5. **Anti-Patterns** - Table of patterns to avoid (recommended)
6. **References** - Links to supporting documentation (recommended)

### File Naming

Use kebab-case with `.instructions.md` suffix:
- `typescript.instructions.md`
- `theme-development.instructions.md`
- `github-actions.instructions.md`

### Content Guidelines

- **Target length:** Under 500 lines (2 pages)
- **Use tables** for structured information
- **Use code blocks** for examples
- **Use callouts** (✅ ❌ ⚠️) for emphasis
- **Link to docs** for additional context

## 🎯 Common Patterns

### TypeScript Standards

```typescript
// ✅ Prefer - Descriptive naming
const authenticatedUser = await getUser();

// ❌ Avoid - Single-letter or vague names
const u = await getUser();
```

### Test Patterns

```typescript
// ✅ Prefer - Descriptive test names
it('should display countdown when mounted', () => { ... });

// ❌ Avoid - Vague test names
it('works', () => { ... });
```

### Architecture Patterns

- Themes are renderers, orchestrator owns timing
- State manager handles persistence
- Cleanup all resources on destroy

## 🔗 Related Documentation

- [Custom Agents](../agents/README.md) - Specialized AI agents
- [Prompt Files](../prompts/README.md) - Reusable prompt templates
- [Prompt Naming Conventions](prompt-files.instructions.md#prompt-naming-conventions) - Standard naming patterns for prompts
- [Copilot Instructions Guide](https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot)
- [VS Code Copilot Setup](https://code.visualstudio.com/docs/copilot/setup)

## 📖 Learning Resources

### VS Code Documentation

- [Copilot in VS Code](https://code.visualstudio.com/docs/copilot/overview)
- [Copilot Chat](https://code.visualstudio.com/docs/copilot/copilot-chat)
