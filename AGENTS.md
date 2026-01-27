# AGENTS.md - Flight School

> **Single source of truth for AI coding agents.** Cross-platform standard supporting Copilot, Claude, Cursor, Codex, and Gemini.
> Symlinked to `CLAUDE.md` and `.github/copilot-instructions.md` for compatibility.

## Project Overview

Next.js 14 App Router application with Primer React UI for learning GitHub Copilot SDK. All API calls to GitHub and AI providers happen server-side in `/api` routes to protect credentials.

**Tech Stack:**
- Next.js 14 (App Router)
- TypeScript 5.x (strict mode)
- Primer React (CSS-first, no `sx` prop)
- Vitest (unit tests)
- Playwright (E2E tests)
- Octokit (GitHub API)
- @github/copilot-sdk (AI features)

## Commands

```bash
# Development
npm run dev           # Start dev server at localhost:3000
npm run build         # Production build
npm run lint          # Lint code

# Testing
npm test              # All unit tests (vitest run)
npm run test:watch    # Watch mode for TDD
npm run test:coverage # Coverage report
npm run test:e2e      # E2E tests (chromium, excludes @perf)
npm run test:e2e:full # Full E2E suite (all browsers)

# Validation (run before commits)
npx tsc --noEmit && npm run lint && npm test

# Tech Debt Analysis
npm run debt:check    # Run all tech debt checks
npm run debt:unused   # Find unused files/exports/deps (knip)
npm run debt:circular # Find circular dependencies (madge)
```

## Directory Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # Server-side API endpoints
│   └── (pages)/            # Page components
├── components/             # React components (each in own folder)
├── lib/
│   ├── github/             # Direct GitHub API (Octokit)
│   │   ├── client.ts       # Auth - SINGLE SOURCE OF TRUTH
│   │   ├── user.ts         # User data fetching
│   │   └── repos.ts        # Repository operations
│   ├── copilot/            # Copilot SDK integration
│   │   ├── server.ts       # Session management
│   │   ├── evaluation.ts   # Challenge evaluation
│   │   └── hints.ts        # Hint generation
│   └── fallback/           # Static content when AI unavailable
docs/
├── specs/                  # Feature specifications
└── plans/                  # Implementation plans
.github/
├── skills/                 # Agent Skills (progressive disclosure)
├── agents/                 # Custom agent personas
├── prompts/                # Reusable prompt files
└── workflows/              # GitHub Actions
```

## Code Style

### TypeScript Files (*.ts, *.tsx)

- **Strict mode required** - No `any` types; use `unknown` with guards
- **File naming**: kebab-case (`user-profile.ts`)
- **Type naming**: PascalCase (`UserProfile`)
- **Function naming**: camelCase (`getUserProfile`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Prefer interfaces** over type aliases for objects
- **Named exports** over default exports

For comprehensive TypeScript patterns, see the **typescript-patterns** skill in `.github/skills/`.

### Test Files (*.test.ts, *.spec.ts)

- Use **Vitest** for unit tests, **Playwright** for E2E
- **Name pattern**: "should [expected behavior] when [condition]"
- **AAA pattern**: Arrange, Act, Assert
- **Co-locate tests**: `foo.ts` alongside `foo.test.ts`
- **Table-driven tests**: Use `it.each()` for multiple scenarios

For comprehensive testing practices, see the **testing-practices** skill in `.github/skills/`.

### React Components

- Use **Primer React** components (CSS-first, no `sx` prop)
- **Stack**: Use string literals (`gap="normal"` not `gap={2}`)
- **Tooltip**: Use `text` prop (not `aria-label`)
- **Banner**: Modern replacement for deprecated Flash

For comprehensive Primer patterns, see the **primer-react** skill in `.github/skills/`.

## Documentation Standards

- **TSDoc** for public functions: `@param`, `@returns`, `@throws`
- **Proportionality**: TSDoc length ≤ function body length
- **Inline comments**: Explain WHY, not WHAT
- **Prefixes**: `// PERF:`, `// NOTE:`, `// CRITICAL:`, `// TODO:`, `// FIXME:`

## Iconography

| Concept | Icon | Import |
|---------|------|--------|
| **Skills** | `MortarBoardIcon` | `@primer/octicons-react` |
| **Habits** | `FlameIcon` | `@primer/octicons-react` |
| **Challenges** | `CodeIcon` | `@primer/octicons-react` |
| **Goals** | `CheckIcon` | `@primer/octicons-react` |
| **Learning Topics** | `BookIcon` | `@primer/octicons-react` |
| **Chat Threads** | `CopilotIcon` | `@primer/octicons-react` |
| **Workspaces** | `RepoIcon` | `@primer/octicons-react` |

## Authentication Pattern

**Always use `getGitHubToken()` from `@/lib/github/client`** for GitHub authentication:

```typescript
import { getGitHubToken, isGitHubConfigured } from '@/lib/github/client';

if (await isGitHubConfigured()) {
  const token = await getGitHubToken();
}
```

**NEVER** access `process.env.GITHUB_TOKEN` directly outside of `client.ts`.

## API Usage Patterns

| Need | Use | Why |
|------|-----|-----|
| Fetch user data | `octokit.rest.users.getAuthenticated()` | Fast, deterministic |
| List repositories | `octokit.rest.repos.listForAuthenticatedUser()` | Fast, deterministic |
| Creative AI generation | Copilot SDK session | AI adds real value |
| Multi-turn chat | Copilot SDK session with MCP | Conversation context |

**Never use Copilot SDK for**: Data fetching (use Octokit), deterministic calculations (do locally).

## Graceful Degradation

App must work without AI keys:
- Check `isAIConfigured()` before AI calls
- Use `getFallback*()` functions from `src/lib/fallback/`
- API responses include `meta.aiEnabled` and `meta.fallbackReason`

## Environment Variables

```bash
# GitHub Authentication (choose one)
GITHUB_TOKEN=xxx              # PAT for explicit auth
# OR run `gh auth login`      # CLI auth shares Copilot token

# GitHub Models (recommended)
GITHUB_MODELS_ENABLED=true
GITHUB_MODELS_MODEL=gpt-4o-mini
```

## Git Workflow

- **Branches**: `feat/`, `fix/`, `docs/`, `refactor/`
- **Commit messages**: Conventional commits
- **PRs**: Require passing CI before merge

## Boundaries

### ✅ Always Do
- Run `npx tsc --noEmit` after edits
- Add/update tests with code changes
- Follow existing patterns in surrounding code
- Use Octokit for GitHub data, SDK for AI features

### ⚠️ Ask First
- Adding new dependencies
- Changing API contracts
- Modifying authentication patterns
- Creating new API routes

### 🚫 Never Do
- Commit secrets or API keys
- Modify `node_modules/` or generated files
- Skip TypeScript strict checks
- Access `process.env.GITHUB_TOKEN` outside `client.ts`
- Use `any` type without explicit justification

---

## Skills Reference

For detailed guidance beyond this overview, see the Agent Skills in `.github/skills/`:

| Skill | When to Use |
|-------|-------------|
| **typescript-patterns** | Editing TypeScript files, code review |
| **testing-practices** | Writing tests, debugging flaky tests |
| **primer-react** | Building UI components, Primer patterns |
| **agent-authoring** | Creating custom agents or specialists |
| **prompt-authoring** | Creating reusable prompt files |

Skills are loaded on-demand using progressive disclosure, keeping context efficient.
