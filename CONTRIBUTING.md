# Contributing to Flight School

Thank you for your interest in contributing to Flight School! This guide will help you get started with local development or using GitHub Codespaces.

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
   
   If you have the GitHub CLI installed and authenticated (`gh auth login`), the app can use your CLI token automatically. This shares authentication with GitHub Copilot, requiring no additional setup.
   
    **Alternative: Use Personal Access Token**

   Create a `.env.local` file in the project root:
   ```bash
   # Required: GitHub token for API access
   # Create at https://github.com/settings/tokens
   # Required scopes: repo, read:user
   GITHUB_TOKEN=your_github_pat_here
   ```

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
| `npm test` | Run all tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate coverage report |
| `npm run debt:check` | Run all tech debt checks |

### Tech Debt Analysis Tools

| Command | Purpose |
|---------|---------|
| `npm run debt:unused` | Find unused files, exports, dependencies (knip) |
| `npm run debt:exports` | Find unused TypeScript exports (ts-prune) |
| `npm run debt:deps` | Find unused npm dependencies (depcheck) |
| `npm run debt:circular` | Find circular dependencies (madge) |

### Project Structure

```
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
- **Authentication**: Always use `getGitHubToken()` from `@/lib/github/client`
- **Component organization**: Each component in its own folder with co-located styles

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-challenge-type`
- `fix/evaluation-streaming-error`
- `docs/update-api-documentation`

### Commit Messages

Write clear, descriptive commit messages:
```
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
