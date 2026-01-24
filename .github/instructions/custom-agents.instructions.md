---
applyTo: "**/*.agent.md"
description: Guidelines for creating GitHub Copilot custom agents
---

# Creating GitHub Copilot Custom Agents

Guidelines for creating agent files in `.github/agents/` that define behavioral expertise, workflows, and specializations.

## Key Concepts

Agents are **behavioural specialists**. They define HOW to work, not WHAT conventions to follow:

```
┌─────────────────────────────────────────────────────────────────┐
│  Instructions (*.instructions.md)                               │
│    ← Auto-injected based on applyTo patterns                    │
│    ← Contains: Coding standards, patterns, file conventions     │
│    ← DO NOT DUPLICATE THIS IN AGENTS                            │
├─────────────────────────────────────────────────────────────────┤
│  Agent (*.agent.md) ← YOU ARE HERE                              │
│    ← Selected from agents dropdown or via prompt file `agent:`  │
│    ← Contains: Workflow, expertise, personality, handoffs       │
│    ← Injected as <modeInstructions> in the prompt               │
├─────────────────────────────────────────────────────────────────┤
│  Prompt (*.prompt.md)                                           │
│    ← Triggered via /command                                     │
│    ← Contains: Task description, variables, agent selection     │
└─────────────────────────────────────────────────────────────────┘
```

### What Belongs in Agents (vs Other Files)

| Content | Agent File | Instruction File | Prompt File |
|---------|------------|------------------|-------------|
| Workflow phases | ✓ | ✗ | ✗ |
| Role/personality | ✓ | ✗ | ✗ |
| Tool configuration | ✓ | ✗ | ✓ (override) |
| Model selection | ✓ | ✗ | ✓ (override) |
| Handoffs to other agents | ✓ | ✗ | ✗ |
| Stopping rules | ✓ | ✗ | ✗ |
| Coding standards | ✗ | ✓ | ✗ |
| Project patterns | ✗ | ✓ | ✗ |
| Task description | ✗ | ✗ | ✓ |
| Input variables | ✗ | ✗ | ✓ |

### Core Agent Patterns

| Pattern | When to Use |
|---------|-------------|
| **Prompt Chaining** | Task cleanly decomposes into fixed subtasks; trade latency for accuracy |
| **Routing** | Distinct categories better handled separately; classification can be accurate |
| **Parallelisation** | Subtasks can run in parallel; multiple perspectives needed for confidence |
| **Orchestrator-Workers** | Complex tasks where subtasks can't be predicted; flexible decomposition needed |
| **Evaluator-Optimiser** | Clear evaluation criteria exist; iterative refinement provides measurable value |

---

## Rules and Guidelines

### Mandated Agent File Structure (Required Ordering)

Agent files **MUST** follow this section order:

| Order | Section/Tag | Required | Applies To | Description |
|-------|-------------|----------|------------|-------------|
| 1 | **Frontmatter** | ✓ | All | `name`, `description`, and optional properties |
| 2 | **Title** | ✓ | All | Clear identifier matching `name` property |
| 3 | `<role_boundaries>` | ✓ | All | What agent does/doesn't do |
| 4 | `<workflow>` | ✓ | All | Step-by-step process in phases |
| 5 | `<stopping_rules>` | ✓ | All | When to stop or escalate |
| 6 | `<error_handling>` | ✓ | All | Recovery strategies |
| 7 | `<stage_awareness>` | ✓ | Specialists | How to adapt based on invoking stage |
| 8 | `<critical_subagent_behavior>` | ✓ | Specialists | JSON response format for subagent returns |
| 9 | `<advisory_protocols>` | ✓ | Specialists | Manager integration table |
| 10 | `<context_consumption>` | ✓ | Managers | How to consume prior stage outputs |
| 11 | `<output_format>` | ✓ | All | Structured response format |
| 12 | `<todo_list_usage>` | ✓ | All | Todo list management rules |

### Manager-Specific Sections (Lessons Learned)

Manager agents orchestrating multi-step workflows benefit from these additional sections:

| Section | Purpose | Example |
|---------|---------|---------|
| `<configuration>` | Parameters table with defaults, routing rules | `maxIterationsPerSpecialist: 3` |
| `<domain_quality_framework>` | Domain-specific criteria, thresholds, severity classifications | Test quality indicators, code smell thresholds |
| `<evaluation_criteria>` | Success criteria, quality metrics, continue/move-on conditions | "Move on when iteration = 3" |
| `<specialist_invocation>` | Exact delegation templates with return format | JSON schema for specialist responses |

**Why these matter:**
- **Configuration**: Makes agent behavior predictable and tunable
- **Domain framework**: Provides consistent criteria across sessions
- **Evaluation criteria**: Prevents infinite loops, clarifies "done"
- **Invocation templates**: Ensures specialists return usable, structured data

### Frontmatter Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | ✓ | Display name and handoff reference |
| `description` | ✓ | Shown in chat participant picker |
| `model` | Recommended | Language model to use |
| `tools` | Optional | Tool list (omit for all tools) |
| `handoffs` | Optional | Workflow transitions to other agents |
| `infer` | Optional | Auto-invoke as subagent (default: `true`) |

### XML Tag Structure

| Tag | Purpose | Required |
|-----|---------|----------|
| `<role_boundaries>` | What agent does/doesn't do | ✓ All agents |
| `<workflow>` | Step-by-step process | ✓ All agents |
| `<stopping_rules>` | When to stop or escalate | ✓ All agents |
| `<error_handling>` | Recovery strategies | ✓ All agents |
| `<stage_awareness>` | Adapt behaviour per invoking stage | ✓ Specialists only |
| `<critical_subagent_behavior>` | JSON response format for subagent returns | ✓ Specialists only |
| `<advisory_protocols>` | Manager integration table | ✓ Specialists only |
| `<context_consumption>` | How to consume prior stage context | ✓ Managers only |
| `<output_format>` | Structured response format | ✓ All agents |
| `<todo_list_usage>` | Todo list management rules | ✓ All agents |
| `<guardrails>` | Input/output validation rules | Optional |
| `<configuration>` | Parameters, routing rules, defaults | Recommended for Managers |
| `<domain_quality_framework>` | Domain-specific criteria and thresholds | Recommended for Managers |
| `<evaluation_criteria>` | Success criteria, continue/stop conditions | Recommended for Managers |
| `<specialist_invocation>` | Delegation templates with exact format | Recommended for Managers |

### Tool Configuration

| Alias | Tools Included |
|-------|----------------|
| `execute` | shell, bash, powershell |
| `read` | view file contents |
| `edit` | str_replace, write |
| `search` | grep, glob |
| `agent` | invoke different custom agents |
| `web` | fetch URLs, web search |
| `todo` | task list management |

**Tool Design Best Practices:**
- Keep tool count small — aim for fewer than 20 functions
- Make tools obvious and intuitive — principle of least surprise
- Use enums and object structure — make invalid states unrepresentable

### Agent Specialization

**Prefer specialized agents** that excel at one task over general-purpose agents.

| Specialist | Focus Area |
|------------|------------|
| **Testing** | Test coverage, quality, testing best practices |
| **Documentation** | Creating and maintaining project docs |
| **Security** | Vulnerability scanning, security patterns |
| **Performance** | Optimization, profiling, memory management |
| **Accessibility** | Level AA compliance, a11y best practices |
| **Architecture** | Pluggable design, extensibility, separation of concerns |

### Specialist Invocation Rules

| Stage | Specialist Usage |
|-------|------------------|
| **Spec** | All relevant specialists review requirements (parallel) |
| **Plan** | Only specialists for affected domains (from handoff checklist) |
| **Implement** | Escalation only — invoke when blocked, not by default |
| **Audit** | Lightweight verification against plan + spec acceptance criteria |

### Handoff Contracts

| From | To | Handoff Contains |
|------|-----|------------------|
| Discovery | Spec | User stories, acceptance criteria drafts, context |
| Spec | Plan | Affected domains checklist, files touched, specialist recommendations |
| Plan | Implement | Step-by-step actions, specialist guidance per step, verification commands |
| Implement | Audit | Implementation summary, deviations documented, verification results |

### Model Selection Guidance

| Agent Type | Recommended Model | Why |
|------------|-------------------|-----|
| **Manager - Discovery** | `Claude Opus 4.5` | Handles ambiguous conversations, synthesises requirements |
| **Manager - Spec** | `Claude Opus 4.5` or `Gemini 3 Pro` | Deep reasoning over long requirements |
| **Manager - Plan** | `Claude Sonnet 4.5` or `Gemini 3 Pro` | Technical planning, actionable steps |
| **Manager - Implement** | `GPT-5.1-Codex` or `Claude Sonnet 4.5` | Optimised for agentic coding |
| **Specialists (coding)** | `GPT-5.1-Codex-Mini` or `Grok Code Fast 1` | Cost-efficient (0.25x-0.33x) |
| **Specialists (audit)** | `Claude Haiku 4.5` or `Gemini 3 Flash` | Fast verification (0.33x) |

### Task Selection

**Good Tasks for Agents:**
- Fix bugs with clear reproduction steps
- Alter user interface features
- Implement well-defined features with clear specs

**Handle Manually:**
- Complex cross-repository refactoring
- Production issues, security, PII
- Ambiguous or open-ended exploration
- Tasks where you want deeper understanding

### Design Principles

1. Maintain simplicity in your agent's design
2. Prioritise transparency by showing planning steps
3. Allow agents to introspect and improve
4. Have specialised agents that excel at one task
5. **Use explicit checkpoints** in workflows for resumability
6. **Define iteration limits** to prevent infinite loops (typically 3)
7. **Provide exact delegation templates** for specialist invocations

### Checkpoint-Based Workflows (CRITICAL for Managers)

Manager agents should use **explicit checkpoints** to enable:
- Session resumption after interruption
- Handoffs to other agents mid-workflow
- Clear progress tracking for users

**Checkpoint Pattern:**
```markdown
## Phase N: {Name}
1. **CHECKPOINT**: Update Resumption Section with current phase
2. Perform work step
3. **CHECKPOINT**: Write results to plan BEFORE proceeding
4. Verify results
5. **CHECKPOINT**: Update iteration count, move to next phase
```

**Resumption Section Must Track:**
- Current phase and step
- Last completed action (specific)
- Next action (specific)
- Iteration counts per specialist
- Files/items processed (N of M)

### Size and Conciseness (CRITICAL)

**Research-backed limits:**

| Content | Target Size | Rationale |
|---------|-------------|----------|
| Agent file total | ≤400 lines | Beyond this, split into manager + specialists |
| `<workflow>` section | ≤60 lines | Phases should be actionable, not exhaustive |
| `<role_boundaries>` | ≤20 lines | If longer, scope is too broad |
| Anti-patterns table | 5-10 rows | Focus on critical mistakes only |
| Domain framework | ≤50 lines | Tables > prose for criteria |

**What to cut:**

| Remove | Why | Instead |
|--------|-----|--------|
| "Be thorough" prompts | Modern models are naturally thorough; causes over-searching | Omit or use stopping conditions |
| Duplicated coding standards | Auto-injected from instruction files | Reference instruction files |
| Verbose examples | 1-2 good examples > 5 verbose ones | Keep the best, cut the rest |
| Explanations for obvious rules | Wastes tokens | State the rule directly |
| Edge cases rarely hit | Clutters core guidance | Move to separate reference doc |

**Contradictions waste reasoning tokens:**
- GPT-5/Claude spend tokens trying to reconcile conflicts
- Review for conflicting instructions before finalizing
- Use the "intern test": Can someone follow this without asking clarifying questions?

---

## Examples

### Basic Agent File Structure

```markdown
---
name: Agent Name
description: Brief description shown in chat
model: Claude Sonnet 4.5 (copilot)
tools: ['tool1', 'tool2']
---

# Agent Instructions

Your prompt and behavioural instructions.
```

### Tool Configuration Examples

```yaml
# Read-only agent
tools: ['search', 'fetch', 'read', 'usages', 'problems', 'changes']

# Full implementation agent
tools: ['search', 'read', 'edit', 'run', 'fetch']
```

### Handoff Configuration

```yaml
handoffs:
  - label: Start Implementation
    agent: agent
    prompt: Implement the plan above.
    send: false  # Require user confirmation
```

### Complete Agent Template

```markdown
---
name: Agent Name
description: Brief description shown in chat participant picker
model: Claude Sonnet 4.5 (copilot)
tools: ['tool1', 'tool2']
handoffs:
  - label: Handoff Label
    agent: target-agent
    prompt: Context for handoff
    send: false
infer: true
---

# Agent Name

<role_boundaries>
## What You DO:
- Primary responsibility 1
- Primary responsibility 2

## What You DON'T Do:
- Anti-responsibility 1 (with reason)
- Redefine coding standards (handled by instruction files)
- Tasks outside your specialisation (delegate to appropriate agent)
</role_boundaries>

<workflow>
## Phase 1: {Phase Name}
1. Step with specific action
2. Step with verification criteria
3. Step with output expectation

## Phase 2: {Phase Name}
1. Step building on Phase 1 output
2. Step with decision point
</workflow>

<stopping_rules>
## Stop When:
- Condition that signals completion
- Condition requiring user input
- Condition requiring escalation

## Escalate When:
- Blocker condition with structured data to include
- Uncertainty condition with questions to ask
</stopping_rules>

<error_handling>
## Error Recovery
- **Transient errors**: Retry with exponential backoff
- **Validation errors**: Log context, attempt correction
- **Blocking errors**: Escalate with full context

## Risk Assessment
- Evaluate consequences before destructive actions
- Prefer reversible operations when possible
</error_handling>

<stage_awareness>
## Stage-Aware Behavior (for specialists)

| Stage | Role | DO | DON'T |
|-------|------|-----|-------|
| **Spec** | Advisor | Evaluate requirements | Re-analyze code |
| **Plan** | Advisor | Confirm approach | Re-evaluate requirements |
| **Implement** | Validator | Fix specific issues | Re-review plan |
</stage_awareness>

<critical_subagent_behavior>
## Subagent Response Format (for specialists)

When invoked as a subagent, return structured JSON:

```json
{
  "status": "approve" | "concern" | "blocker",
  "summary": "Brief assessment",
  "findings": ["Finding 1", "Finding 2"],
  "suggestions": ["Actionable fix 1"],
  "filesReviewed": ["path/to/file.ts"]
}
```

- Keep response focused and actionable
- Do NOT include conversational preamble
- Manager will consume this JSON directly
</critical_subagent_behavior>

<advisory_protocols>
## Manager Integration (for specialists)

| Invoking Manager | Your Role | Response Focus |
|------------------|-----------|----------------|
| **Manager - Spec** | Requirements advisor | Feasibility, risks, missing criteria |
| **Manager - Plan** | Approach advisor | Implementation notes, edge cases |
| **Manager - Implement** | Validator/fixer | Specific issues, targeted fixes |
</advisory_protocols>

<context_consumption>
## Consuming Context from Prior Stage (CRITICAL)

1. **Read artifact** from previous stage
2. **Parse handoff section** — extract file lists, recommendations
3. **DO NOT re-analyze** what prior stage validated
</context_consumption>

<output_format>
## Output Requirements (if applicable)

### Structured Response Format
```json
{
  "status": "approve" | "concern" | "blocker",
  "feedback": "Assessment summary",
  "suggestions": ["Actionable improvement 1"]
}
```

### Artifact Location
Write output to: `docs/{type}/ARTIFACT-NNN-{slug}.md`
</output_format>

<todo_list_usage>
## Todo List (ALWAYS Use)

1. Create todo list at session start
2. Mark in-progress before starting each phase
3. Mark completed immediately when done
4. Add new todos only for blockers/scope changes
</todo_list_usage>
```

### Subagent Usage

Use `#tool:agent/runSubagent` to delegate with isolated context. Provide self-contained prompts, specify exact output format, scope to ONE question per call.

### Specialist Invocation Templates (CRITICAL for Managers)

Manager agents should define **exact delegation templates** with:
1. File/item manifest for context
2. Quality criteria to apply
3. Specific checks to perform
4. Exact JSON return format

See [manager-agents.instructions.md](.github/instructions/manager-agents.instructions.md) for full template examples.

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|------------------|
| Duplicating coding standards in agents | Instructions files auto-inject; causes maintenance burden | Reference instruction files; agents define behaviour only |
| Missing `<error_handling>` section | Agent gives up too easily or crashes on errors | Always include recovery strategies |
| Missing `<stopping_rules>` | Agent runs indefinitely or stops too early | Define clear completion and escalation conditions |
| General-purpose agents | Jack of all trades, master of none | Create focused specialists for each domain |
| Hardcoded model names | Breaks when models deprecated | Use model selection guidance; prefer aliases |
| Missing `<todo_list_usage>` | User has no visibility into agent progress | Always use todo lists for multi-step work |
| Vague `<role_boundaries>` | Agent scope creep; unclear handoffs | Be explicit about what agent does AND doesn't do |

---

## References

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot) - Official Copilot documentation
- [Supported AI Models](https://docs.github.com/en/copilot/reference/ai-models/supported-models) - Available models for agents
- [Model Comparison](https://docs.github.com/en/copilot/reference/ai-models/model-comparison) - Model selection by task type
- [Anthropic Agent Guidelines](https://docs.anthropic.com/en/docs/build-with-claude/agentic) - Building effective agents
- [OpenAI Agent Guidelines](https://platform.openai.com/docs/guides/agents) - Agent best practices
- [copilot-instructions.instructions.md](.github/instructions/copilot-instructions.instructions.md) - Instruction file standards
- [manager-agents.instructions.md](.github/instructions/manager-agents.instructions.md) - Manager agent patterns
- [specialist-agents.instructions.md](.github/instructions/specialist-agents.instructions.md) - Specialist agent patterns
- [prompt-files.instructions.md](.github/instructions/prompt-files.instructions.md) - Prompt file standards