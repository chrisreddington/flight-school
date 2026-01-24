---
description: Discover requirements through JTBD methodology and create specification (WHAT to build)
agent: Manager - Spec
argument-hint: Feature or requirement to specify
---

# Create Specification

**Feature**: `${input:featureName:Describe the feature or requirement}`

## Context

Discover requirements through Jobs-to-be-Done methodology and create a formal specification. **SPEC = WHAT** to build with testable acceptance criteria.

**For implementation planning**: Use `/create-plan` after spec is approved.

## Task

Conduct discovery and produce specification:

### 1. Discovery (JTBD Interview)
- Explore the real need behind the request
- Identify trigger, push/pull forces, anxieties
- Understand success criteria from user perspective

### 2. Requirements Analysis
- Review related code and existing patterns
- Identify affected files and domains
- Research relevant best practices

### 3. Specification
- Define user stories with MoSCoW priorities
- Write testable acceptance criteria
- Explicitly scope what's NOT included (Won't Have)

### 4. Specialist Review
- Invoke relevant specialists (Test, E2E, Accessibility, etc.)
- Address blockers (max 3 iterations per specialist)
- Incorporate recommendations into handoff section

## Expected Output

Spec file at `docs/specs/SPEC-{NNN}-{kebab-case-name}.md` with:
- Testable acceptance criteria for all stories
- MoSCoW priorities assigned
- Handoff section with affected domains and file lists for `/create-plan`
