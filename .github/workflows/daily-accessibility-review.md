---
description: |
  Daily accessibility fixer for Flight School.
  Reviews the running app against WCAG 2.2 guidelines using Playwright, inspects source code,
  and directly fixes clear code-level issues (missing aria-label, unassociated form labels,
  missing alt text, landmark regions) by submitting a draft PR. Files an issue for
  anything requiring a design or UX decision.

on:
  schedule: daily
  workflow_dispatch:
  stop-after: +1mo

permissions: read-all

network: defaults

safe-outputs:
  create-pull-request:
    draft: true
    title-prefix: "[a11y] "
    labels: [accessibility, automation]
  create-issue:
    max: 3
    labels: [accessibility, needs-decision]

tools:
  playwright:
  web-fetch:
  edit:
  bash: true
  github:
    toolsets: [all]

timeout-minutes: 20

steps:
  - name: Checkout repository
    uses: actions/checkout@v4
    with:
      fetch-depth: 0
      persist-credentials: false
  - name: Build and run app in background
    run: |
      npm ci
      npm run build
      npm start &
      npx wait-on http://localhost:3000 --timeout 60000

source: githubnext/agentics/workflows/daily-accessibility-review.md@828ac109efb43990f59475cbfce90ede5546586c
---

# Daily Accessibility Fixer

<!-- Note - this file can be customized to your needs. Replace this section directly, or add further instructions here. After editing run 'gh aw compile' -->

Your name is ${{ github.workflow }}. Your job is to find and fix **one accessibility issue per run** in the Flight School app. Keep PRs small and focused.

This is a Next.js 14 App Router application using Primer React. Key accessibility rules for this codebase:
- `IconButton` components **must** have `aria-label` (Primer React requirement)
- Form inputs **must** be wrapped in `FormControl` with a `FormControl.Label`
- `Tooltip` uses `text` prop, not `aria-label`
- Interactive elements must be reachable and operable by keyboard

## Steps

1. Use Playwright to browse `localhost:3000`. Navigate the key pages (dashboard, chat, profile, challenges). Take snapshots. Look for:
   - Missing focus indicators
   - Interactive elements unreachable by keyboard (Tab key)
   - Missing or incorrect ARIA attributes
   - Missing page landmarks (`<main>`, `<nav>`, `<header>`)

2. Scan source code under `src/components/` and `src/app/` for code-level issues. Focus on:
   - `IconButton` without `aria-label`
   - `<img>` without `alt`
   - `<input>` not inside `FormControl`
   - Missing `aria-live` on dynamic content regions
   - Heading hierarchy gaps (jumping from h1 to h3)

3. **Decide how to handle each issue:**
   - **Code fix (PR)**: If the fix is a clear, safe code change (add `aria-label`, wrap in `FormControl`, add `alt` text), fix it directly using the edit tool and create a draft PR. Fix ONE issue per run.
   - **Design decision (Issue)**: If the fix requires UX or design judgment (e.g., color contrast, interaction patterns, copy), create a GitHub issue instead describing the problem and the WCAG criterion violated.

4. Before creating the PR, verify the fix: `npx tsc --noEmit && npm run lint`

5. PR description must include:
   - **Issue**: Which WCAG 2.2 criterion is violated and where
   - **Fix**: What was changed
   - **Verification**: TypeScript and lint checks pass
