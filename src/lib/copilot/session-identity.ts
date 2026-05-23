/**
 * Per-request identity passed to every Copilot session factory. Both fields
 * are propagated to the Copilot SDK so the session acts on behalf of the
 * caller's GitHub user (see `SessionOptions.gitHubToken`). Never cache or
 * reuse a `SessionIdentity` across requests.
 */
export interface SessionIdentity {
  /** Stable GitHub numeric ID (as string) of the calling user. */
  userId: string;
  /** Fresh user-to-server (`ghu_...`) access token for that user. */
  gitHubToken: string;
}

/** Convert an authenticated request context into the SDK identity object. */
export function createSessionIdentity(ctx: { userId: string; accessToken: string }): SessionIdentity {
  return { userId: ctx.userId, gitHubToken: ctx.accessToken };
}
