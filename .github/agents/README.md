# Custom Agents

Specialized agents for domain-specific guidance. Select from the agents dropdown in Copilot Chat.

## 📚 Documentation

- [Custom agents in VS Code](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
- [Create custom agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents)
- [awesome-copilot](https://github.com/github/awesome-copilot)

## 🎭 Available Agents (11 Total)

### Manager Agents (4)

Orchestrate multi-stage workflows. **SPEC = WHAT. PLAN = HOW.**

| Agent | Purpose | Modes |
|-------|---------|-------|
| `Manager - Spec` | Discover requirements (JTBD), create specification (WHAT) | — |
| `Manager - Plan` | Create implementation plan from spec (HOW) | — |
| `Manager - Implement` | Implement plans with atomic state updates | — |
| `Manager - Audit` | Comprehensive audits with persistent plans | `structure`, `smells`, `tests`, `docs` |

### Specialist Agents (7)

Domain expertise for focused tasks. Invoked by Managers or standalone.

| Agent | Domain | Standalone? |
|-------|--------|-------------|
| `Specialist - Test` | Unit (Vitest) + E2E (Playwright) testing | ✅ |
| `Specialist - Code Quality` | Architecture, code smells, refactoring | ✅ |
| `Specialist - Accessibility` | A11y compliance, screen readers | ✅ |
| `Specialist - Performance` | Optimization, profiling, memory | ✅ |
| `Specialist - Documentation` | TSDoc + markdown documentation | ✅ |
| `Specialist - GitHub Actions` | CI/CD workflows | ✅ |
| `Specialist - Prompt Engineer` | Creating agents and prompts | ✅ |

## 🚀 Recommended Workflow

```
Spec → Plan → Implement → Audit
(WHAT)  (HOW)   (DO IT)   (VERIFY)
```

| Stage | Agent | Output |
|-------|-------|--------|
| **Spec** | Manager - Spec | `docs/specs/SPEC-NNN-*.md` |
| **Plan** | Manager - Plan | `docs/plans/PLAN-NNN-*.md` |
| **Implement** | Manager - Implement | Code changes with verification |
| **Audit** | Manager - Audit | `docs/plans/AUDIT-NNN-*.md` |

### Audit Modes

Use Manager - Audit with different modes for focused audits:

| Command | Focus | Specialist |
|---------|-------|------------|
| `/audit-structure` | Large files, long functions, arch violations | Code Quality |
| `/audit-smells` | Duplicates, magic numbers, dead code | Code Quality |
| `/audit-tests` | Coverage, overlap, test quality | Test |
| `/audit-docs` | TSDoc, markdown, stale content | Documentation |

## 🔗 Related

- [Prompts](../prompts/README.md) - Task entry points
- [Instructions](../instructions/README.md) - Coding standards
