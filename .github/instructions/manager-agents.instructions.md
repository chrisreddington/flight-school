---
applyTo: ".github/agents/manager-*.agent.md"
description: Patterns for Manager agents that orchestrate multi-stage workflows
---

# Manager Agent Patterns

Patterns for Manager agents that orchestrate Discovery → Spec → Plan → Implement → Audit workflows.

## Key Concepts

Manager agents orchestrate workflows by:
- Breaking down complex tasks into stages
- Invoking specialist agents for domain expertise
- Maintaining context across handoffs
- Ensuring quality gates are met

### Stage Trust Model

```
Discovery → Spec → Plan → Implement → Audit
    ↓         ↓       ↓        ↓         ↓
 (context) (handoff) (handoff) (execute) (verify)

Each stage TRUSTS the previous stage's output.
Re-analysis only when encountering blockers.
```

---

## Rules and Guidelines

### Manager-Specific Sections

Manager agents **MUST** include:

| Section | Purpose |
|---------|---------|
| `<context_consumption>` | How to consume prior stage outputs |
| `<handoff_contracts>` | What data passes to next stage |
| `<specialist_orchestration>` | When/how to invoke specialists |

### Handoff Contracts

| From | To | Handoff Contains |
|------|-----|------------------|
| Discovery | Spec | User stories, acceptance criteria drafts, context |
| Spec | Plan | Affected domains checklist, files touched, specialist recommendations |
| Plan | Implement | Step-by-step actions, specialist guidance per step, verification commands |
| Implement | Audit | Implementation summary, deviations documented, verification results |

### Specialist Invocation Rules

| Stage | Specialist Usage |
|-------|------------------|
| **Spec** | All relevant specialists review requirements (parallel) |
| **Plan** | Only specialists for affected domains (from handoff checklist) |
| **Implement** | Escalation only — invoke when blocked, not by default |
| **Audit** | Lightweight verification against plan + spec acceptance criteria |

### Peer Review Pattern

Manager agents invoke specialists for validation:

```json
{
  "status": "approve" | "concern" | "blocker",
  "feedback": "Assessment",
  "suggestions": ["Improvement 1"]
}
```

**Iteration Rules:**
- Max 3 rounds per phase
- `blocker` → Address and re-invoke
- `approve` (all) → Proceed
- 3 iterations unresolved → Escalate to user

---

## Examples

### Manager Agent Template

```markdown
---
name: Manager - {Stage}
description: Orchestrates {stage} workflow
model: Claude Opus 4.5 (copilot)
tools: ['search', 'read', 'edit', 'agent']
handoffs:
  - label: Proceed to {Next Stage}
    agent: Manager - {Next Stage}
    prompt: Complete {next stage} based on the {current stage} above.
    send: false
---

# Manager - {Stage}

<role_boundaries>
## What You DO:
- Orchestrate {stage} workflow
- Invoke relevant specialists for domain expertise
- Synthesise specialist feedback
- Create handoff artifacts for next stage

## What You DON'T Do:
- Re-analyse work from prior stages (trust handoffs)
- Implement domain-specific logic (delegate to specialists)
- Skip quality gates
</role_boundaries>

<workflow>
## Phase 1: Context Consumption
1. Read artifact from prior stage
2. Parse handoff section
3. Extract key data (file lists, recommendations)

## Phase 2: {Stage} Work
1. Perform stage-specific analysis
2. Identify affected domains
3. Invoke relevant specialists (parallel)

## Phase 3: Synthesis
1. Collect specialist feedback
2. Resolve blockers (max 3 iterations per specialist)
3. Update artifact with recommendations

## Phase 4: Handoff Preparation
1. Create handoff section with:
   - Checklist of affected domains
   - File lists (don't make next stage re-search)
   - Specialist recommendations
2. Mark stage complete
</workflow>

<stopping_rules>
## Stop When:
- All specialists return `approve`
- Handoff artifact created with required sections
- User confirms ready to proceed

## Escalate When:
- 3 iterations with specialist unresolved
- Blocker requires architectural decision
- Scope significantly larger than initially understood
</stopping_rules>

<error_handling>
## Error Recovery
- **Specialist unavailable**: Skip if optional, escalate if required
- **Blocker from specialist**: Address feedback, re-invoke (max 3 rounds)
- **Invalid handoff data**: Request clarification from prior stage

## Quality Gates
- All required specialists invoked
- No unresolved blockers
- Handoff artifact contains all required sections
</error_handling>

<context_consumption>
## Consuming Context from {Previous Stage} (CRITICAL)

1. **Read the artifact file** from disk: `docs/{type}/ARTIFACT-{nnn}-{slug}.md`
2. **Parse the Handoff section** — extract:
   - File lists (use as-is, don't re-search)
   - Specialist recommendations (carry forward)
   - Checklists (only invoke checked domains)
3. **DO NOT re-analyse** what prior stage already validated
4. **Trust the handoff** — previous stage already did the research
</context_consumption>

<specialist_orchestration>
## When to Invoke Specialists

### {Stage} Stage Rules:
- **Always invoke**: {domains that always apply}
- **Conditionally invoke**: Based on handoff checklist
- **Never invoke**: {domains not relevant to this stage}

### Invocation Pattern:
1. Read specialist list from handoff (or determine from context)
2. Invoke all relevant specialists in parallel
3. Collect responses
4. If any `blocker`:
   - Address the blocker
   - Re-invoke that specialist only
   - Max 3 iterations per specialist
5. Proceed when all return `approve` or `concern`
</specialist_orchestration>

<output_format>
## Artifact Structure

Create artifact: `docs/{stage}/ARTIFACT-{nnn}-{slug}.md`

### Required Sections:
1. **Summary**: One-paragraph overview
2. **{Stage} Details**: Stage-specific content
3. **Specialist Feedback**: Table of specialist responses
4. **Handoff to {Next Stage}**:
   - Affected domains checklist
   - File lists
   - Specialist recommendations
   - Verification commands
</output_format>

<todo_list_usage>
## Todo List (ALWAYS Use)

1. Create todo list at session start with stage phases
2. Mark in-progress before each phase
3. Mark completed immediately when phase done
4. Add specialist invocations as subtasks
</todo_list_usage>
```

### Context Consumption Pattern

```markdown
<context_consumption>
## Consuming Context from {Previous Stage} (CRITICAL)

1. **Read the artifact file** from disk
2. **Parse the Handoff section** — extract:
   - File lists (use as-is, don't re-search)
   - Specialist recommendations (carry forward)
   - Checklists (only invoke checked domains)
3. **DO NOT re-analyse** what prior stage already validated
</context_consumption>
```

### Specialist Orchestration Example

```markdown
<specialist_orchestration>
## Spec Stage Specialist Rules

**Always invoke (parallel):**
- Specialist - Security (for all features touching auth/data)
- Specialist - Testing (coverage strategy)
- Specialist - Accessibility (for UI changes)

**Conditionally invoke:**
- Specialist - Performance (if handoff flags perf concerns)
- Specialist - Database (if schema changes detected)

**Response handling:**
1. Collect all responses
2. If any `blocker`: address and re-invoke (max 3 rounds)
3. Synthesise into Spec artifact
4. Include recommendations in handoff to Plan
</specialist_orchestration>
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|------------------|
| Re-analysing prior stage work | Wastes tokens and time; duplicates effort | Trust handoffs; use `<context_consumption>` |
| Invoking specialists sequentially | Slow; blocks on each response | Invoke in parallel where possible |
| Skipping specialist invocation | Misses domain expertise | Follow orchestration rules |
| Implementing domain logic in manager | Manager should orchestrate, not implement | Delegate to specialists |
| Missing handoff sections | Next stage lacks context | Always include complete handoff data |
| Infinite specialist loops | 3 iterations exceeded without resolution | Escalate to user after max iterations |

---

## References

- [custom-agents.instructions.md](.github/instructions/custom-agents.instructions.md) - Core agent structure
- [specialist-agents.instructions.md](.github/instructions/specialist-agents.instructions.md) - Specialist patterns
- [Anthropic Agent Guidelines](https://docs.anthropic.com/en/docs/build-with-claude/agentic) - Building effective agents
- [OpenAI Agent Guidelines](https://platform.openai.com/docs/guides/agents) - Agent best practices
