---
description: Investigate and fix flaky tests (E2E or unit tests that pass/fail inconsistently)
agent: Specialist - Test
argument-hint: Test name, file path, or "all" to scan for flaky patterns
---

# Fix Flaky Test

**Target**: `${input:target:Test to investigate - name, file path, or "all" for systematic scan}`

## Task

Apply the flaky test diagnosis and fix patterns from [testing.instructions.md](../instructions/testing.instructions.md#fixing-flaky-tests).

1. **Locate** the test(s) and run multiple times to reproduce
2. **Diagnose** root cause using the symptoms table in testing.instructions.md
3. **Fix** using the appropriate pattern from the Fixing Flaky Tests section
4. **Verify** stability using the verification commands in testing.instructions.md
5. **Document** subtle fixes with regression comment
