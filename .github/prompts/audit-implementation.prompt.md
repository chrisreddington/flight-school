---
description: Audit codebase against specification and plan (VERIFY implementation)
agent: Manager - Audit
argument-hint: Spec or plan path (e.g., docs/specs/SPEC-001-feature.md)
---

# Audit Implementation

## Context

Use this prompt to verify that the codebase correctly implements a specification and follows the implementation plan. **SPEC = WHAT** was expected. **PLAN = HOW** it should be built. **AUDIT = VERIFY** it was done correctly.

## Task

Audit implementation for: `${input:specOrPlanPath:Enter spec or plan path (e.g., docs/specs/SPEC-001-feature.md)}`

1. **Load Documents**: Read both the spec and corresponding plan
2. **Establish Criteria**: Extract acceptance criteria from spec, verification commands from plan
3. **Code Inspection**: Review affected files listed in plan against implementation requirements
4. **Acceptance Verification**: Check each acceptance criterion is satisfied
5. **Specialist Consultation**: Invoke relevant specialists for deep verification:
   - **Specialist - Test**: Verify test coverage matches requirements
   - **Specialist - Code Quality**: Check for code smells introduced
   - **Specialist - Code Documentation**: Verify TSDoc completeness
6. **Gap Analysis**: Document any gaps between spec/plan and implementation
7. **Create Audit Report**: Write findings to plan's audit section or new audit document

## Verification Checklist

- [ ] All acceptance criteria from spec are met
- [ ] All implementation steps from plan are complete
- [ ] Verification commands pass
- [ ] No regressions introduced
- [ ] Code quality standards maintained
- [ ] Documentation updated as needed

## Expected Output

- Audit findings documented in plan or separate audit report
- Clear PASS/FAIL status for each acceptance criterion
- Gap analysis with recommendations for any deficiencies
- Verification command results
