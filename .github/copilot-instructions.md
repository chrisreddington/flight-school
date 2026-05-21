# Flight School - Copilot Instructions

## Architecture Overview

Next.js 14 App Router application with Primer React UI. All API calls to GitHub and AI providers happen server-side in `/api` routes to protect credentials.

**Data Flow**: Dashboard → `/api/profile` (Octokit direct) → `/api/focus` (Copilot SDK creative generation) → UI

## Multi-tenant design

Flight School is **multi-tenant**: every request is authenticated as a specific
GitHub user via Auth.js v5 + a GitHub App OAuth flow, and that user's
`ghu_` user-to-server token is what downstream GitHub API calls and Copilot
SDK sessions use. There is **no process-wide token** and **no Octokit
singleton**. See [`docs/architecture-multitenant.md`](../docs/architecture-multitenant.md)
for the full design.

## GitHub API Access

This project uses the `octokit` package for direct GitHub API access and the
`@github/copilot-sdk` for AI-powered features. Both are bound per-request to
the authenticated user's token.

### Authentication (SINGLE SOURCE OF TRUTH)

In server code that handles an authenticated request — API routes, server
components, server actions — **resolve the user via
`@/lib/auth/context`** and let the GitHub/Copilot factories pick up the token
from there.

```typescript
import { requireUserContext, getUserContext } from '@/lib/auth/context';
import { getOctokitForRequest, getOctokitForToken } from '@/lib/github/client';

// In an API route handler:
const { userId, login, accessToken } = await requireUserContext(); // throws UnauthorizedError (401) if no session
const octokit = await getOctokitForRequest();                      // fresh, instrumented, bound to this user

// If you already have a token (e.g. inside a guard or background job):
const octokit2 = getOctokitForToken(accessToken);
```

Rules:

- **Per-request Octokit only.** Never cache or share an Octokit across users
  or across requests. `getOctokitForRequest()` constructs a fresh, instrumented
  instance every call.
- **Never read `process.env.GITHUB_TOKEN`.** There is no ambient identity in
  any environment, including local dev. The OAuth flow is the only auth path.
- **No `gh auth token` fallback.** The client module does not shell out;
  every token comes from the Auth.js session.
- **Hot AI routes should use `withUserGuards`** (`src/lib/security/guard.ts`),
  which composes `requireUserContext` + rate limit + concurrent-session cap +
  audit log around the handler.

### `gh` CLI fallback is gone

There is no `gh auth token` lookup anywhere in the application. Local dev
must sign in through the same OAuth flow as production. The
`ACA_DEPLOYMENT` env var no longer affects token resolution.

### Copilot SDK: per-session GitHub identity

The `CopilotClient` is constructed once with `useLoggedInUser: false` (see
`src/lib/copilot/sessions.ts`). Every session passes the user's token via
`SessionOptions.gitHubToken`, and the MCP server config is rebuilt per call
with that same token (see `src/lib/copilot/mcp.ts`).

```typescript
import {
  createLoggedChatSession,
  createLoggedCoachSession,
  type SessionIdentity,
} from '@/lib/copilot/server';

const identity: SessionIdentity = { userId, gitHubToken: accessToken };
const session = await createLoggedChatSession(identity, 'chat', prompt);
```

Chat session cache keys include `userId` so two users sharing a
`conversationId` can never collide.

### When to Use Which

| Need | Use | Why |
|------|-----|-----|
| Fetch user data | `octokit.rest.users.getAuthenticated()` | Fast, deterministic |
| List repositories | `octokit.rest.repos.listForAuthenticatedUser()` | Fast, deterministic |
| Get activity events | `octokit.rest.activity.listEventsForAuthenticatedUser()` | Fast, deterministic |
| Creative AI generation | Copilot SDK session via `createLoggedCoachSession` | AI adds real value |
| Multi-turn chat | Copilot SDK session via `createLoggedChatSession` (+ MCP) | Conversation context |

### Code Location

| Path | Purpose |
|------|---------|
| `src/lib/auth/` | Auth.js v5 config, user-context resolution, token store |
| `src/lib/github/` | Per-request Octokit factories + GitHub data access |
| `src/lib/copilot/` | Copilot SDK sessions (per-session `gitHubToken`), MCP config |
| `src/lib/security/` | `withUserGuards`, rate limit, session cap, audit log |

### Never Use SDK For

- Data fetching that APIs handle directly (use Octokit)
- Deterministic calculations (do them locally)
- Operations where LLM adds latency without value

## Critical Patterns

### Copilot SDK Usage (`src/lib/copilot/`)

The SDK is used authentically for:
- **Creative generation** (daily focus): AI genuinely adds personalization value
- **Multi-turn chat**: Core SDK use case with conversation context
- **MCP tool access**: Real-time GitHub exploration during chat

```typescript
// Create a session for chat or coaching. The caller must supply the
// per-request user identity so the session inherits their GitHub token.
import {
  createLoggedChatSession,
  createLoggedCoachSession,
} from '@/lib/copilot/server';
import { requireUserContext } from '@/lib/auth/context';

const { userId, accessToken } = await requireUserContext();
const session = await createLoggedChatSession(
  { userId, gitHubToken: accessToken },
  'chat',
  prompt,
);
const response = await session.sendAndWait({ prompt });
```

### Graceful Degradation
**Always test without AI keys** - app must work with static content:

- `src/lib/fallback/static-suggestions.ts` provides curated content per language/level
- Check pattern: `isAIConfigured()` before AI calls, use `getFallback*()` functions
- API responses include `meta.aiEnabled` and `meta.fallbackReason`

### JSON Response Parsing
LLMs may wrap JSON in markdown - use multi-strategy extraction in `parseJSONResponse()`:

1. Extract from ` ```json ` code blocks
2. Find JSON by brace matching (`{` to `}`)
3. Direct parse as final fallback

## Code Organization

| Path | Purpose |
|------|---------|
| `src/lib/*/types.ts` | Feature-scoped domain types (e.g. `src/lib/focus/types.ts`) |
| `src/lib/ai/providers/` | New AI backend implementations |
| `src/lib/expertise/` | GitHub data → skill level analysis |
| `src/components/*/` | Each component in own folder |
| `src/app/api/*/route.ts` | Server-side API endpoints |

## Testing

Vitest with mocked fetch (see `src/test/setup.ts`). Tests colocated as `*.test.ts`:

```bash
npm test              # All tests (non-interactive: vitest run)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

Pattern: Mock `process.env` for provider tests, mock `fetch` for API calls.

## Learning-Focused Chat Pattern

When creating learning-focused chat sessions, the AI should:

### Learning Lens Directives
1. **Explain reasoning** - Don't just give answers; show the thought process
2. **Suggest next steps** - Offer opportunities to explore deeper
3. **Connect to context** - Reference user's actual repos and activity when relevant
4. **Encourage experimentation** - Suggest hands-on exercises when appropriate

### System Prompt Pattern
```typescript
// Learning chat sessions should use prompts like:
const LEARNING_SYSTEM_PROMPT = `You are a developer learning companion.

When answering questions:
1. Explain your reasoning step-by-step
2. Connect concepts to the user's actual repositories when relevant
3. Suggest follow-up questions or experiments
4. If applicable, point to specific files or code patterns

Focus on building understanding, not just providing solutions.`;
```

### When to Apply Learning Lens
- User asks "why" or "how does this work"
- User is exploring new concepts
- User requests explanation or guidance

### When NOT to Apply Learning Lens
- User explicitly wants quick answer
- Time-sensitive questions
- Simple factual lookups

## Challenge Evaluation Pattern

The Challenge Sandbox uses AI to evaluate user solutions. See `src/lib/copilot/evaluation.ts`.

### Evaluation System Prompt
```typescript
// Evaluation prompts should assess correctness AND learning
const EVALUATION_SYSTEM_PROMPT = `You are evaluating a coding challenge solution.

Analyze the code for:
1. **Correctness**: Does it solve the problem?
2. **Code quality**: Is it readable, maintainable?
3. **Edge cases**: Are boundary conditions handled?
4. **Best practices**: Are language idioms used appropriately?

Provide constructive feedback that helps the learner improve.
Do NOT just say "wrong" - explain what's missing and why.`;
```

### Evaluation Response Format
```typescript
interface EvaluationResult {
  isCorrect: boolean;      // Did they solve the problem?
  score?: number;          // 0-100 quality score (optional)
  feedback: string;        // Main feedback message
  strengths: string[];     // What they did well
  improvements: string[];  // Specific areas to improve
  nextSteps?: string[];    // Suggested follow-up learning
}
```

### Streaming Evaluation
Evaluation uses streaming responses for immediate feedback:
- First token should arrive within 2 seconds (TTFT target)
- Stream partial results using Server-Sent Events
- Show loading indicator during evaluation

## Hint Generation Pattern

The hint system provides contextual help without giving away solutions. See `src/lib/copilot/hints.ts`.

### Hint System Prompt
```typescript
// Hints should guide, not solve
const HINT_SYSTEM_PROMPT = `You are helping a developer who is stuck on a coding challenge.

Rules:
1. NEVER give the full solution
2. Guide them toward discovery
3. Ask questions that prompt insight
4. Reference concepts they might have forgotten
5. Build on previous hints in the conversation

The goal is learning, not just getting the right answer.`;
```

### Hint Response Format
```typescript
interface HintResponse {
  hint: string;          // The contextual hint
  concepts: string[];    // Related concepts to review
  encouragement: string; // Motivational message
}
```

### Multi-Turn Hints
Hints maintain session context:
- Each hint builds on previous ones
- Conversation is scoped to the current challenge
- System tracks hint history to avoid repetition

## Challenge Authoring Pattern

The Challenge Authoring feature uses AI to help users create custom challenges. See `src/lib/copilot/authoring-session.ts`.

### Authoring System Prompt
```typescript
// Authoring sessions guide users through challenge creation:
const AUTHORING_SYSTEM_PROMPT = `You are helping a developer create a custom coding challenge.

Your role:
1. Understand what skill they want to practice
2. Ask clarifying questions (difficulty, language, constraints)
3. Generate a well-structured challenge when you have enough context

Guidelines:
- Start by asking what they want to learn or practice
- Keep questions focused - one topic at a time
- Suggest improvements to make challenges more educational
- When ready, generate a complete challenge specification`;
```

### Authoring Flow
1. **Clarification phase**: Gather requirements through conversation
2. **Generation phase**: Create structured challenge when sufficient context
3. **Validation phase**: Ensure challenge is coherent and achievable

### Challenge Generation Format
When generating a challenge, return a structured JSON object:
```typescript
interface GeneratedChallenge {
  title: string;          // Concise, descriptive title
  description: string;    // Full requirements with examples
  language: string;       // Target programming language
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: string;  // e.g., "30 minutes"
  whyThisChallenge: string[]; // Learning benefits
}
```

### Templates
Quick-start templates provide context for common challenge types:
- Algorithm challenges
- Testing practice
- Refactoring exercises
- Data manipulation
- API integration
- Performance optimization

## Environment Variables

See [`.env.example`](../.env.example) for the canonical list. Highlights:

```bash
# Auth.js v5 + GitHub App (REQUIRED in every environment)
AUTH_SECRET=                  # openssl rand -base64 32
AUTH_GITHUB_ID=               # GitHub App client id
AUTH_GITHUB_SECRET=           # GitHub App client secret
AUTH_TRUST_HOST=true          # required behind a proxy (ACA, Codespaces, etc.)

# Per-user abuse controls (defaults match in-code values)
AUDIT_SALT=                   # openssl rand -hex 32
# RATE_LIMIT_CHAT_PER_MIN=30
# RATE_LIMIT_CHAT_CAP=3
```

## Commands

```bash
# Development
npm run dev           # Start dev server at localhost:3000
npm run build         # Production build
npm run lint          # Lint code

# Testing
npm test              # All tests (non-interactive: vitest run)
npm run test:watch    # Watch mode for TDD
npm run test:coverage # Coverage report

# Tech Debt Analysis
npm run debt:check    # Run all tech debt checks
npm run debt:unused   # Find unused files, exports, deps (knip)
npm run debt:exports  # Find unused TypeScript exports (ts-prune)
npm run debt:deps     # Find unused dependencies (depcheck)
npm run debt:circular # Find circular dependencies (madge)
```

## Tech Debt Tools

Use `/analyze-tech-debt` prompt for comprehensive analysis. Available commands:

| Tool | Command | Purpose | When to Run |
|------|---------|---------|-------------|
| **knip** | `npm run debt:unused` | Unused files, exports, dependencies | Before major refactor, monthly |
| **ts-prune** | `npm run debt:exports` | Unused TypeScript exports | PR review, before release |
| **depcheck** | `npm run debt:deps` | Unused npm dependencies | Monthly, after dep updates |
| **madge** | `npm run debt:circular` | Circular dependencies | Architecture changes |
| **All** | `npm run debt:check` | Run all checks at once | Quarterly cleanup |

**Integration**: Use `review-code` prompt with `mode=debt` for guided analysis.

