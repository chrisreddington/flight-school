---
description: Create implementation plan from specification (HOW to build)
agent: Manager - Plan
argument-hint: Path to spec file (e.g., docs/specs/SPEC-001-feature.md)
---

# Create Implementation Plan

**Specification**: `${input:specPath:Path to spec (e.g., docs/specs/SPEC-001-feature.md)}`

## Context

Create an actionable implementation plan from an approved specification. **SPEC = WHAT**. **PLAN = HOW**.

**Don't have a spec yet?** Use `/create-spec` first.

## Task

Consume spec handoff and produce executable plan:

### 1. Specification Intake
- Parse goals, acceptance criteria, handoff section
- Extract affected domains, file lists, specialist recommendations
- Trust spec's analysis—don't re-research

### 2. Plan Development
- Create numbered steps (1.1, 1.2, 2.1, etc.) with file references
- Include verification command for every step
- Link steps to spec stories (S1, S2, etc.)
- Estimate complexity (S/M/L) per step

### 3. Specialist Consultation
- Only invoke specialists in spec's "Affected Domains" checklist
- Address blockers (max 3 iterations per specialist)
- Incorporate guidance into step notes

### 4. Handoff Preparation
- Complete Resumption Section for `/implement-plan`
- Document rollback strategy per phase

## Expected Output

Plan file at `docs/plans/PLAN-{NNN}-{kebab-case-name}.md` with:
- Numbered steps with verification commands
- File manifest (F1, F2, etc.) for traceability
- Resumption Section ready for execution
