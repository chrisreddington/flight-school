---
name: agent-authoring
description: Guidelines for creating custom agents and specialists. Use when creating new agent files (.agent.md), reviewing agent definitions, or designing multi-agent workflows.
---

# Agent Authoring

Comprehensive guidelines for creating GitHub Copilot custom agents, including manager and specialist patterns.

## When to Use This Skill

- Creating new agent files (`.agent.md`)
- Reviewing or improving agent definitions
- Designing multi-agent workflows
- Converting specialists to managers or vice versa

## Agents vs Prompts vs Instructions

```
┌─────────────────────────────────────────────────────────────────┐
│  Instructions (*.instructions.md)                               │
│    ← Auto-injected based on applyTo patterns                    │
│    ← Contains: Coding standards, patterns, file conventions     │
├─────────────────────────────────────────────────────────────────┤
│  Agent (*.agent.md) ← THIS SKILL                                │
│    ← Selected from dropdown or via prompt file `agent:`         │
│    ← Contains: Workflow, expertise, personality, handoffs       │
├─────────────────────────────────────────────────────────────────┤
│  Prompt (*.prompt.md)                                           │
│    ← Triggered via /command                                     │
│    ← Contains: Task description, variables, agent selection     │
└─────────────────────────────────────────────────────────────────┘
```

| Content | Agent File | Instruction File | Prompt File |
|---------|------------|------------------|-------------|
| Workflow phases | ✓ | ✗ | ✗ |
| Role/personality | ✓ | ✗ | ✗ |
| Tool configuration | ✓ | ✗ | ✓ (override) |
| Handoffs | ✓ | ✗ | ✗ |
| Stopping rules | ✓ | ✗ | ✗ |
| Coding standards | ✗ | ✓ | ✗ |
| Task description | ✗ | ✗ | ✓ |

## Mandated Agent File Structure

Agent files **MUST** follow this section order:

| Order | Section/Tag | Required | Description |
|-------|-------------|----------|-------------|
| 1 | **Frontmatter** | ✓ | `name`, `description`, `model`, `tools` |
| 2 | **Title** | ✓ | Clear identifier |
| 3 | `<role_boundaries>` | ✓ | What agent does/doesn't do |
| 4 | `<workflow>` | ✓ | Step-by-step process |
| 5 | `<stopping_rules>` | ✓ | When to stop or escalate |
| 6 | `<error_handling>` | ✓ | Recovery strategies |
| 7 | `<stage_awareness>` | Specialists | Adapt per invoking stage |
| 8 | `<critical_subagent_behavior>` | Specialists | JSON response format |
| 9 | `<advisory_protocols>` | Specialists | Manager integration |
| 10 | `<context_consumption>` | Managers | Consume prior stage outputs |
| 11 | `<output_format>` | ✓ | Structured response format |
| 12 | `<todo_list_usage>` | ✓ | Todo list rules |

## Frontmatter Properties

```yaml
---
name: Agent Name
description: Brief description shown in chat
model: Claude Sonnet 4.5 (copilot)
tools: ['search', 'read', 'edit', 'run']
handoffs:
  - label: Start Implementation
    agent: agent
    prompt: Implement the plan above.
    send: false
infer: true
---
```

| Property | Required | Description |
|----------|----------|-------------|
| `name` | ✓ | Display name and handoff reference |
| `description` | ✓ | Shown in chat picker |
| `model` | Recommended | Language model to use |
| `tools` | Optional | Tool list (omit for all) |
| `handoffs` | Optional | Workflow transitions |
| `infer` | Optional | Auto-invoke as subagent |

## Tool Aliases

| Alias | Tools Included |
|-------|----------------|
| `execute` | shell, bash, powershell |
| `read` | view file contents |
| `edit` | str_replace, write |
| `search` | grep, glob |
| `agent` | invoke custom agents |
| `web` | fetch URLs, web search |
| `todo` | task list management |

## Agent Types

### Specialists

Focus on ONE domain. Used as subagents by managers.

**Required sections:**
- `<stage_awareness>` - Adapt behavior per invoking stage
- `<critical_subagent_behavior>` - JSON response format
- `<advisory_protocols>` - Manager integration

### Managers

Orchestrate workflows. Invoke specialists for domain expertise.

**Required sections:**
- `<context_consumption>` - Consume prior stage outputs
- `<configuration>` - Parameters, routing rules
- `<specialist_invocation>` - Delegation templates

## Model Selection

| Agent Type | Recommended Model | Why |
|------------|-------------------|-----|
| Manager - Discovery | `Claude Opus 4.5` | Ambiguous conversations |
| Manager - Spec | `Claude Opus 4.5` | Deep reasoning |
| Manager - Plan | `Claude Sonnet 4.5` | Technical planning |
| Manager - Implement | `GPT-5.1-Codex` | Agentic coding |
| Specialists (coding) | `GPT-5.1-Codex-Mini` | Cost-efficient |
| Specialists (audit) | `Claude Haiku 4.5` | Fast verification |

## Specialist Template

```markdown
---
name: Specialist - {Domain}
description: {Domain} expertise
model: Claude Haiku 4.5 (copilot)
tools: ['search', 'read']
---

# Specialist - {Domain}

<role_boundaries>
## What You DO:
- Provide {domain} expertise
- Review code through {domain} lens
- Identify {domain}-specific risks

## What You DON'T Do:
- Redefine coding standards
- Re-analyze prior stage work
- Implement features (advise only)
</role_boundaries>

<workflow>
## Phase 1: Context
1. Read files from manager
2. Identify {domain} concerns

## Phase 2: Assessment
1. Evaluate against {domain} criteria
2. Identify issues (critical vs nice-to-have)

## Phase 3: Response
1. Determine status
2. Return JSON response
</workflow>

<stopping_rules>
## Stop When:
- All files reviewed
- Assessment complete

## Escalate When:
- Requires architectural changes
- Cross-domain concerns
</stopping_rules>

<error_handling>
- **File not found**: Report in findings, continue
- **Ambiguous requirements**: Request clarification
</error_handling>

<stage_awareness>
| Stage | Role | DO | DON'T |
|-------|------|-----|-------|
| **Spec** | Advisor | Evaluate requirements | Analyze code |
| **Plan** | Advisor | Review approach | Re-evaluate requirements |
| **Implement** | Validator | Fix issues | Re-design |
</stage_awareness>

<critical_subagent_behavior>
When invoked by a Manager, return **ONLY** this JSON:

```json
{
  "status": "approve" | "concern" | "blocker",
  "summary": "Brief assessment",
  "findings": ["Finding 1"],
  "suggestions": ["Fix 1"],
  "filesReviewed": ["path/file.ts"]
}
```
</critical_subagent_behavior>

<advisory_protocols>
| Invoking Manager | Your Role | Response Focus |
|------------------|-----------|----------------|
| **Manager - Spec** | Advisor | Feasibility, risks |
| **Manager - Plan** | Advisor | Implementation notes |
| **Manager - Implement** | Validator | Specific fixes |
</advisory_protocols>

<output_format>
Return structured JSON (see above).
</output_format>

<todo_list_usage>
**Standalone**: Use todo lists.
**Subagent**: No todo lists.
</todo_list_usage>
```

## Handoff Contracts

| From | To | Handoff Contains |
|------|-----|------------------|
| Discovery | Spec | User stories, context |
| Spec | Plan | Domains checklist, files, recommendations |
| Plan | Implement | Steps, verification commands |
| Implement | Audit | Summary, deviations, results |

## Design Principles

1. **Simplicity** - Keep agent design straightforward
2. **Transparency** - Show planning steps
3. **Specialization** - One task per agent
4. **Checkpoints** - Enable resumability
5. **Iteration limits** - Prevent infinite loops (typically 3)

## Size Limits

| Content | Target Size |
|---------|-------------|
| Agent file total | ≤400 lines |
| `<workflow>` section | ≤60 lines |
| `<role_boundaries>` | ≤20 lines |
| Anti-patterns table | 5-10 rows |

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|------------------|
| Duplicating coding standards | Auto-injected from instructions | Reference instruction files |
| Missing `<error_handling>` | Agent crashes on errors | Include recovery strategies |
| Missing `<stopping_rules>` | Agent runs indefinitely | Define completion conditions |
| General-purpose agents | Master of none | Create focused specialists |
| Missing `<todo_list_usage>` | No visibility into progress | Always use todo lists |
| Vague `<role_boundaries>` | Scope creep | Be explicit about scope |

## References

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [Anthropic Agent Guidelines](https://docs.anthropic.com/en/docs/build-with-claude/agentic)
- [OpenAI Agent Guidelines](https://platform.openai.com/docs/guides/agents)
