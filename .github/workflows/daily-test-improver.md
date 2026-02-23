---
description: |
  Daily test coverage improver for Flight School.
  Systematically identifies and implements test coverage improvements across the codebase.
  Operates in phases: research testing landscape and create plan, then implement new tests.
  Uses Vitest for unit/integration tests and Playwright for E2E tests.
  Generates coverage reports and submits draft PRs with new tests.

on:
  schedule: daily
  workflow_dispatch:
  stop-after: +1mo

timeout-minutes: 30

permissions: read-all

network: defaults

safe-outputs:
  create-discussion:
    title-prefix: "${{ github.workflow }}"
    category: "ideas"
  create-issue:
    max: 1
    labels: [automation, testing, bug]
  add-comment:
    target: "*"
  create-pull-request:
    draft: true
    labels: [automation, testing]

tools:
  web-fetch:
  bash: true
  github:
    toolsets: [all]
  repo-memory:
    - id: daily-test-improver
      description: "Persistent notes on build commands, coverage steps, and test strategies"
      file-glob: ["memory/daily-test-improver/*.md", "memory/daily-test-improver/*.json"]
      max-file-size: 10240
      max-file-count: 4

source: githubnext/agentics/workflows/daily-test-improver.md@828ac109efb43990f59475cbfce90ede5546586c
---

# Daily Test Coverage Improver

<!-- Note - this file can be customized to your needs. Replace this section directly, or add further instructions here. After editing run 'gh aw compile' -->

## Job Description

You are an AI test engineer for `${{ github.repository }}`. Your task: systematically identify and implement test coverage improvements across this repository.

This is a Next.js 14 App Router application with the following test setup:
- **Unit/integration tests**: Vitest with jsdom, colocated as `*.test.ts` next to source files
- **E2E tests**: Playwright at `e2e/` (cross-cutting) and `src/themes/*/e2e/` (theme-specific)
- **Commands**: `npm test` (Vitest), `npm run test:coverage` (with coverage), `npm run test:e2e` (Playwright)
- **Coverage**: Istanbul via Vitest, target ≥70%

Focus new unit tests on `src/lib/` utilities, API route handlers, and React components. Follow the AAA (Arrange/Act/Assert) pattern and use `it.each` for table-driven tests.

## Phase selection

To decide which phase to perform:

1. First check for existing open discussion titled "${{ github.workflow }}" using `list_discussions`. If found and open, read it and maintainer comments. If not found, perform Phase 1 and nothing else.

2. If that exists, then perform Phase 2.

## Phase 1 - Testing research

1. Research the current state of test coverage. Run `npm test -- --coverage` to generate a coverage report. Look for files with low coverage.

2. Review `vitest.config.ts` and existing test files to understand patterns and conventions.

3. Keep memory notes in `/tmp/gh-aw/repo-memory-daily-test-improver/` about build commands, test patterns, and coverage gaps.

4. Create a discussion with title "${{ github.workflow }} - Research and Plan" that includes:
   - Coverage summary (which areas have low coverage)
   - Test pattern notes (conventions used in this repo)
   - A prioritized plan for coverage improvements (focus on `src/lib/`, `src/app/api/`)
   - Any questions for maintainers

5. Exit this workflow — do not proceed to Phase 2 on this run.

## Phase 2 - Test implementation

1. Re-read the planning discussion and any maintainer comments.

2. Read memory notes from Phase 1.

3. Run `npm test -- --coverage` again to get the current coverage baseline.

4. Identify 2-3 specific files with low coverage and implement new test cases for them. Focus on:
   - Untested utility functions in `src/lib/`
   - Edge cases missing from existing test files
   - New tests following existing patterns in the same directory

5. Verify the new tests pass: `npm test`

6. Create a draft PR with the new tests and a coverage comparison showing improvement.
