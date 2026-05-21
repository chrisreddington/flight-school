# Multi-tenant Architecture

Flight School is multi-tenant: every incoming HTTP request is authenticated as
a specific GitHub user, and that user's GitHub App user-to-server (`ghu_`)
token flows all the way down to GitHub API calls **and** to the Copilot SDK
session that handles AI work for that request. There is no process-wide token,
no Octokit singleton, and no shared identity between users.

## High-level data flow

```mermaid
flowchart LR
    Browser([Browser])

    subgraph NextProc["Next.js server process"]
        AuthJS["Auth.js v5<br/>GitHub App OAuth"]
        Route["API route<br/>+ withUserGuards"]
        Ctx["getUserContext()<br/>requireUserContext()"]
        Oct["getOctokitForRequest()<br/>(fresh per request)"]
        Sess["createLoggedChatSession(<br/>{ userId, gitHubToken })"]
        Client["CopilotClient<br/>(singleton, useLoggedInUser:false)"]
        MCP["getMcpServerConfig({ token })<br/>(rebuilt per call)"]
    end

    GH[(GitHub REST API)]
    MCPSrv[(api.githubcopilot.com/mcp)]
    Copilot[(Copilot CLI subprocess)]

    Browser -->|cookie| AuthJS
    AuthJS --> Route
    Route --> Ctx
    Ctx --> Oct --> GH
    Route --> Sess
    Sess --> Client --> Copilot
    Sess --> MCP --> MCPSrv
```

## Why one `CopilotClient` can serve every user

The Copilot SDK supports per-session GitHub identity via
[`SessionOptions.gitHubToken`](https://github.com/github/copilot-sdk). Because
of that, we construct **one** `CopilotClient` per Node process (see
`src/lib/copilot/sessions.ts`):

- The client is created with `useLoggedInUser: false`, so it never inherits
  the host's ambient `gh auth` identity.
- Every `copilot.createSession({ ... })` call passes the caller's
  `gitHubToken`, scoping that session — and every tool call inside it — to
  that user.
- MCP server config is **rebuilt per call** with the same per-session token
  (`getMcpServerConfig({ token })` in `src/lib/copilot/mcp.ts`), so MCP HTTP
  requests carry the requesting user's `Authorization` header.

Result: a single long-lived Copilot CLI subprocess multiplexes work for many
users without ever mixing their tokens.

## Cross-cutting guarantees

- **No singleton tokens.** Octokit instances are constructed per request via
  `getOctokitForToken(token)` / `getOctokitForRequest()`. There is no
  ambient token resolution — every token originates from
  `requireUserContext()`.
- **No CLI / env back doors.** The client module does not import
  `child_process` and does not read `process.env.GITHUB_TOKEN`. Local dev
  signs in via the OAuth flow just like production.
- **User-keyed chat session cache.** The Copilot conversation cache key is
  `${userId}:${poolKey}:${conversationId}` (see `chatSessionCache` in
  `src/lib/copilot/sessions.ts`). Two users sharing a conversation ID never
  collide.
- **MCP config rebuilt per call.** `getMcpServerConfig` throws if no token is
  supplied and never caches a config across users.
- **Audit log on every guarded operation.** `withUserGuards` in
  `src/lib/security/guard.ts` emits an audit event (with `hashUserId` of the
  caller) for each rate-limited, capped session creation.
- **Per-user abuse controls.** Sliding-window rate limit
  (`src/lib/security/rate-limit.ts`) and concurrent-session cap
  (`src/lib/security/session-cap.ts`) are keyed on `userId`, not IP.

## Key entry points

| Concern | Module | Symbol |
|---|---|---|
| Auth.js session | `src/lib/auth/config.ts` | `auth`, `handlers`, `signIn`, `signOut` |
| User context in handlers | `src/lib/auth/context.ts` | `getUserContext`, `requireUserContext`, `UnauthorizedError` |
| Per-request Octokit | `src/lib/github/client.ts` | `getOctokitForRequest`, `getOctokitForToken` |
| Copilot session factory | `src/lib/copilot/sessions.ts` | `createSessionWithMetrics`, `getConversationSession` |
| Logged session helpers | `src/lib/copilot/server.ts` | `createLoggedChatSession`, `createLoggedCoachSession`, `SessionIdentity` |
| MCP per-call config | `src/lib/copilot/mcp.ts` | `getMcpServerConfig` |
| Route guard composition | `src/lib/security/guard.ts` | `withUserGuards` |
| Audit + abuse controls | `src/lib/security/` | `auditLog`, `checkRateLimit`, `acquireSlot` |

## Storage isolation

The server-side storage APIs — `/api/threads/storage`, `/api/focus/storage`,
and `/api/workspace/storage` (plus `/api/workspace/storage/list`) — are
**partitioned per authenticated user** on disk. The shared
`createStorageRoute` factory in `src/lib/api/storage-route-factory.ts` and the
workspace route both resolve the caller's identity via `requireUserContext()`
and rewrite the storage path to live under a per-user subdirectory:

```
{FLIGHT_SCHOOL_DATA_DIR}/users/{userId}/threads.json
{FLIGHT_SCHOOL_DATA_DIR}/users/{userId}/focus-storage.json
{FLIGHT_SCHOOL_DATA_DIR}/users/{userId}/workspaces/{challengeId}/...
```

`{userId}` is the numeric GitHub user ID taken from the Auth.js session —
never from a query string or request body. Before it is used as a path
segment it is validated against `/^[a-zA-Z0-9_-]+$/`; anything else
(including `..`, `/`, `.`) is rejected with HTTP 400. The per-user directory
is created on demand with mode `0o700` on platforms that honour POSIX modes.

### Guarantees

- **GET returns the caller's data only.** User A's `GET /api/threads/storage`
  sees the default empty schema even if User B has written threads, because
  A's path doesn't exist on disk.
- **DELETE only clears the caller's file.** User A deleting their workspace
  cannot affect User B's `users/{B}/workspaces/...`.
- **Unauthenticated requests return 401** before any filesystem call.
- **Path-traversal is rejected with 400** rather than silently sandboxed.

### Migration policy

The pre-multitenant code wrote storage files directly at the root of
`FLIGHT_SCHOOL_DATA_DIR` (e.g. `threads.json` at the top level). Those files
are **ignored** by the multi-tenant code — there is no automatic migration.
This is safe because the multi-tenant version is not yet deployed to
production. Developers running local dev environments can delete the old
files manually:

```sh
# macOS/Linux default location
rm -rf ~/.local/share/flight-school/threads.json \
       ~/.local/share/flight-school/focus-storage.json \
       ~/.local/share/flight-school/workspaces/
```

See [`src/lib/api/MIGRATION.md`](../src/lib/api/MIGRATION.md) for the same
note alongside the code.

## Anti-patterns to reject in review

- Reading `process.env.GITHUB_TOKEN` anywhere in production code. There is
  no ambient identity — even in local dev, sign in via the OAuth flow.
- Shelling out to `gh auth token` or any other CLI to resolve a GitHub
  token. The client module no longer imports `child_process`.
- Caching an `Octokit` instance at module scope.
- Calling `new CopilotClient(...)` outside `src/lib/copilot/sessions.ts`.
- Creating a session without passing `gitHubToken`, or passing one user's
  token into another user's session cache key.
- Resolving a token outside `requireUserContext()` / `getUserContext()`.
- Writing or reading server-side storage files at the storage root rather
  than under `users/{userId}/...`. All storage routes derive the userId from
  `requireUserContext()`; the caller is never trusted to supply it.

## Related docs

- [`docs/deployment-aca.md`](deployment-aca.md) — Container image + ACA
  production checklist.
- [`infra/README.md`](../infra/README.md) — Bicep modules, Key Vault secrets,
  GitHub App setup.
- [`docs/migrations/2025-multitenant-auth.md`](migrations/2025-multitenant-auth.md)
  — Before/after for developers upgrading from the single-tenant model.

## Token storage

GitHub user-to-server tokens (`ghu_` access, `ghr_` refresh) are persisted via
the {@link TokenStore} abstraction in `src/lib/auth/token-store.ts`. The
implementation is chosen at process boot by `token-store-factory.ts`:

| Env | Store | Notes |
|---|---|---|
| `AZURE_COSMOS_ENDPOINT` set | `CosmosTokenStore` | AES-256-GCM token payload, DEK wrapped by Azure Key Vault (`A256KW`) via `DefaultAzureCredential` (managed identity in prod). Documents partitioned by `userId`. AES-GCM AAD binds the ciphertext to `{alg, expiresAt, kekId, userId}` so a ciphertext+IV+authTag+wrappedDek envelope cannot be replayed into another user's document, against a rotated KEK, or with an extended TTL — any mismatch throws at `decipher.final()`. |
| Otherwise | `InMemoryTokenStore` | Process-local `Map`. **Local-dev only** — a server restart drops sessions and forces re-auth. That is the secure-by-default behaviour: no plaintext tokens ever touch disk. |

In `NODE_ENV=production` the factory **throws on boot** if
`AZURE_COSMOS_ENDPOINT` is missing, so the in-memory store cannot be deployed
to production by accident.

Required env for the Cosmos path:

- `AZURE_COSMOS_ENDPOINT`, `AZURE_COSMOS_DATABASE`, `AZURE_COSMOS_CONTAINER`
- `AZURE_KEY_VAULT_URL`, `AZURE_KEY_VAULT_KEY_NAME`
- `AZURE_KEY_VAULT_KEY_VERSION` (optional; defaults to the latest key version)

No static secrets — both `CosmosClient` and `CryptographyClient` authenticate
with `DefaultAzureCredential` (managed identity in ACA, `az login` locally).

> **Breaking change (AAD binding):** the AES-GCM envelope now uses Additional
> Authenticated Data over `{alg, expiresAt, kekId, userId}`. Any token
> document written before this change will fail to decrypt and surface as
> a forced re-authentication on the user's next request. This is acceptable
> because there is no production data yet; if that ever changes, a versioned
> envelope migration is required instead.

## Background jobs

The `/api/jobs` surface runs AI work asynchronously (topic / challenge / goal
regeneration, chat responses, challenge evaluation). Jobs can outlive the
HTTP request that submitted them — GitHub user-to-server access tokens are
valid for only ~8 hours, so the request-time `ghu_` token is unsafe to
embed on a queued job.

**Payload contract.** Persisted job records carry **only** the `userId`
plus the job-specific input. They MUST NOT contain `accessToken`,
`gitHubToken`, or any other GitHub credential. This invariant is enforced
by `src/app/api/jobs/route.ts` (and asserted by `route.test.ts`).

**Token-refresh-at-execution.** Each executor in
`src/app/api/jobs/job-executors.ts` calls
`resolveFreshGitHubToken(userId)` (`src/lib/auth/token-resolver.ts`) as its
first step after `markRunning`. The resolver:

1. Looks up the stored token from the configured `TokenStore`.
2. If the cached access token is within `REFRESH_LEEWAY_MS` of expiry,
   exchanges the refresh token for a new `ghu_` access token via
   `refreshGitHubAccessToken` (shared with the Auth.js JWT callback) and
   re-persists the rotated pair.
3. Returns the fresh access token.

**Failure modes.**

| Condition | Resolver behaviour | Executor behaviour |
|---|---|---|
| No record for `userId` (never authed, signed out, swept) | Returns `null` | `auditLog('job.credentials_missing')`, marks job `failed` with `"GitHub credentials missing — user must re-authenticate."` |
| Cached token near expiry, refresh exchange fails (revoked / 401) | Throws | `auditLog('job.credentials_refresh_failed')`, marks job `failed` with `"GitHub credentials expired — user must re-authenticate."` |
| Cached token near expiry, no refresh token stored | Throws | Same as above |

Neither failure path retries: the refresh token is no longer usable and
the user must re-authenticate via the web flow before any further jobs
can succeed for them.
