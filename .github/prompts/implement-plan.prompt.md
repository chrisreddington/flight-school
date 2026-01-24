---
description: Implement plan with atomic state updates for seamless resumability
agent: Manager - Implement
argument-hint: Path to plan file (e.g., docs/plans/PLAN-007-feature.md)
---

# Implement Plan

**Plan**: `${input:planPath:Path to plan (e.g., docs/plans/PLAN-007-feature.md)}`

## Context

Implement a plan document step-by-step with atomic state updates. Tracks progress after every action, enabling seamless handoff if interrupted.

**Don't have a plan yet?** Use `/create-plan` first.

## Task

Implement plan with checkpointed progress:

### 1. State Recovery
- Parse Resumption Section for current state
- Skip completed steps, start from "Next Action"
- Verify any existing blockers are still relevant

### 2. Step Execution (per step)
- **CHECKPOINT**: Update Resumption Section before starting
- Implement the step using file manifest (F1, F2, etc.)
- Run verification command from plan
- Self-fix (max 2 attempts) before escalating to specialists
- **CHECKPOINT**: Update Resumption Section after completing

### 3. Phase Validation
- Run `npm run validate:iteration` after each phase
- Do NOT proceed if validation fails
- Escalate with full context if blocked after specialist help

### 4. Completion
- Final audit against spec acceptance criteria
- Update Resumption Section to COMPLETE status
- Document any deviations with justification

## On Interruption

Plan document contains full state—resume from exact failure point with `/implement-plan`.

## Expected Output

- Plan Resumption Section updated throughout
- All steps verified before marking complete
- Deviation log (if any) with justification
