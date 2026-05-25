# Contributing to Flight School

Thank you for your interest in contributing to Flight School! This guide will help you get started with local development or using GitHub Codespaces.

> [!WARNING]
> **Exploratory project — not a reference.** Flight School is a
> single-developer side project for trying out GitHub, the Copilot SDK,
> Aspire, and adjacent tooling. The codebase is **mid-flight** and
> intentionally noisy — expect half-finished refactors, antipatterns, and
> decisions that will likely change. Do not treat anything here as a
> recommended pattern, and do not copy it into production systems without
> independent review. Issues and PRs are welcome, but there is no SLA,
> roadmap, or stability guarantee.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior through the channels described in the Code of Conduct.

## Getting Started

You can contribute to Flight School using either local development or GitHub Codespaces. Choose the approach that works best for you.

### Option 1: GitHub Codespaces (Recommended for Quick Start)

The fastest way to get started is using GitHub Codespaces, which provides a fully configured development environment in your browser.

1. **Open in Codespaces**
   - Navigate to the repository on GitHub
   - Click the green **Code** button
   - Select the **Codespaces** tab
   - Click **Create codespace on main**

2. **Wait for Setup**
   - The dev container will automatically install dependencies (`npm install`)
   - Playwright browsers will be installed for E2E testing
   - VS Code extensions (ESLint, Prettier, Playwright, GitHub Copilot) are pre-configured

3. **Start Developing**
   ```bash
   npm run dev
   ```
   The Next.js dev server starts on port 3000 and opens automatically in the Simple Browser.

### Option 2: Local Development

#### Prerequisites

- **Node.js 22+** - [Download](https://nodejs.org/)
- **npm** - Included with Node.js
- **Git** - [Download](https://git-scm.com/)
- **GitHub CLI** (optional but recommended) - [Download](https://cli.github.com/)

#### Setup Steps

1. **Fork and Clone**
   ```bash
   # Fork the repository on GitHub, then clone your fork
   git clone https://github.com/chrisreddington/flight-school.git
   cd flight-school
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment**

   Flight School authenticates every user via a GitHub App OAuth flow
   (Auth.js v5). You need an `.env.local` for local development.

   1. Register a GitHub App at <https://github.com/settings/apps/new>:
      - **Homepage URL:** `http://localhost:3000`
      - **Callback URL:** `http://localhost:3000/api/auth/callback/github`
      - Enable **"Request user authorization (OAuth) during installation"**.
      - Generate a client secret.
   2. Copy `.env.example` to `.env.local` and fill in the required vars:

      ```bash
      AUTH_SECRET=                  # openssl rand -base64 32
      AUTH_GITHUB_ID=               # GitHub App client id
      AUTH_GITHUB_SECRET=           # GitHub App client secret
      AUTH_TRUST_HOST=true
      ```

   > **No ambient auth fallbacks.** `GITHUB_TOKEN` env vars and `gh auth login`
   > are not used anywhere in the app — local dev signs in via the same
   > GitHub App OAuth flow as production. If you are not signed in, every
   > API route returns 401.

4. **Start the Development Server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Development Workflow

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server at localhost:3000 |
| `npm run build` | Create production build |
| `npm run lint` | Run ESLint |
| `npm run lint:md` | Run markdownlint-cli2 across the repo |
| `npm run format` | Run Prettier `--write` over the repo |
| `npm run format:check` | Verify formatting without writing |
| `npm run verify:fast` | Lint + markdownlint + Prettier check (pre-commit hook scope) |
| `npm run verify` | Full local CI: lint, format, tsc, tests, guardrails, build (pre-push hook scope) |
| `npm test` | Run all tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate coverage report |
| `npm run debt:check` | Run all tech debt checks |

### Local quality gates

Three layers, fastest first. The goal is to give AI/human contributors fast
feedback locally and reserve GitHub Actions as the final authority.

1. **Pre-commit (~few seconds)** — `.husky/pre-commit` runs `lint-staged`,
   which auto-fixes ESLint, Prettier, and markdownlint issues on staged
   files only. Failures block the commit.
2. **Pre-push (~1–2 min)** — `.husky/pre-push` runs the full battery:
   `npm run lint`, `tsc --noEmit`, `npm test`, `npm run check:guardrails`,
   and `npm run build`. Failures block the push so CI never sees a known-red
   commit.
3. **CI (final gate)** — `.github/workflows/ci.yml` runs `build-and-test`
   plus a parallel `lint-gaps` job that adds `actionlint` (workflow YAML +
   embedded shellcheck) and `markdownlint-cli2`. Both jobs are required.

Escape hatch: `git commit --no-verify` / `git push --no-verify` skip the
local hooks when you need to capture a WIP state. Don't push unverified
work to `main`.

**Why no super-linter?** This repo is single-language (TS/Next.js) with
strong existing static analysis (ESLint, tsc, Prettier, knip, depcheck,
ts-prune, madge, plus 8 custom guardrail scripts). The github/super-linter
action would mostly re-run our existing ESLint inside a 2–3 GB Docker
image. The two gaps that matter — workflow YAML and markdown — are
covered cheaper and faster by focused single-purpose actions.

### Tech Debt Analysis Tools

| Command | Purpose |
|---------|---------|
| `npm run debt:unused` | Find unused files, exports, dependencies (knip) |
| `npm run debt:exports` | Find unused TypeScript exports (ts-prune) |
| `npm run debt:deps` | Find unused npm dependencies (depcheck) |
| `npm run debt:circular` | Find circular dependencies (madge) |

### Project Structure

```text
src/
├── app/           # Next.js App Router (pages and API routes)
├── components/    # React components (each in own folder)
├── hooks/         # Custom React hooks
├── lib/           # Core business logic
│   ├── github/    # GitHub API (Octokit)
│   ├── copilot/   # Copilot SDK integration
│   └── ...
└── test/          # Test setup and utilities
```

### Key Patterns

- **API routes** in `src/app/api/` handle all GitHub and AI provider calls server-side
- **Authentication**: resolve the user in handlers via `requireUserContext()` from `@/lib/auth/context`, then use `getOctokitForRequest()` from `@/lib/github/client`. For AI-backed routes prefer `withUserGuards` from `@/lib/security/guard`. See [`docs/architecture-multitenant.md`](docs/architecture-multitenant.md).
- **Component organization**: Each component in its own folder with co-located styles

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-challenge-type`
- `fix/evaluation-streaming-error`
- `docs/update-api-documentation`

### Commit Messages

Write clear, descriptive commit messages:

```text
feat: add multi-file workspace support to challenge sandbox

- Support multiple files in evaluation API
- Add file manager component
- Update export dialog for workspace export
```

### Testing

- Write tests for new features using Vitest
- Tests are co-located as `*.test.ts` files
- Run `npm test` before submitting a PR

```bash
# Run specific test file
npm test -- src/lib/github/client.test.ts

# Run tests matching a pattern
npm test -- --grep "evaluates"
```

### Linting

```bash
npm run lint
```

ESLint runs automatically on save in VS Code (and Codespaces).

## Submitting a Pull Request

1. **Create a branch** from `main`
2. **Make your changes** with clear commits
3. **Run tests** and fix any failures
4. **Push** to your fork
5. **Open a Pull Request** against `main`

### PR Description

Include:
- **What** the change does
- **Why** it's needed
- **How** it was implemented
- Screenshots for UI changes
- Link to related issues

### Review Process

- PRs require at least one approval
- CI checks must pass (tests, linting)
- Copilot code review may provide automated feedback

## Getting Help

- **Questions**: Open a GitHub Issue
- **Bugs**: Open a GitHub Issue with reproduction steps
- **Feature Ideas**: Open a GitHub Issue describing the use case

Thank you for contributing to Flight School! Your contributions help developers learn and grow with AI-powered guidance.
