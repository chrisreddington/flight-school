---
description: Implement a feature using TDD - write failing tests first, then implementation
agent: Manager - Implement
argument-hint: Feature or bug fix to implement
---

# TDD Feature Implementation

**Feature**: `${input:featureDescription:Describe the feature to implement}`
**Area**: `${input:affectedArea:Where should this be implemented? (e.g., src/app/orchestrator.ts)}`

## Context

Implement features using Test-Driven Development. Ensures testability by design.

## Task

Apply test patterns from [testing.instructions.md](../instructions/testing.instructions.md).

### Phase 1: Write Failing Tests
Delegate to **Specialist - Test** for unit tests and **Specialist - E2E** for integration tests.
Both test types should fail before proceeding.

### Phase 2: Implement Feature
Write minimal code to make tests pass, then refactor while keeping tests green.

### Phase 3: Verify No Regressions
Run `npm run validate:iteration` to confirm all tests pass.

## Expected Output
1. Test files with feature verification
2. Implementation that makes tests pass
3. Verification all tests pass
