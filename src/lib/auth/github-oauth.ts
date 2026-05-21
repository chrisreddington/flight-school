/**
 * Shared helpers for GitHub OAuth (user-to-server) token operations.
 *
 * Both the Auth.js JWT callback (`src/lib/auth/config.ts`) and the background
 * job token resolver (`src/lib/auth/token-resolver.ts`) refresh access tokens
 * via this module so the wire-format and error semantics stay in lockstep.
 */

/** Successful (or error) response shape from GitHub's token endpoint. */
export interface RefreshedToken {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in?: number;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange a refresh token for a fresh `ghu_` access token.
 *
 * @param refreshToken - The `ghr_` refresh token previously issued by the
 *   GitHub App OAuth flow.
 * @returns The refreshed token response: a new access token, a rotated
 *   refresh token, and lifetimes.
 * @throws When `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` are unset, when the
 *   HTTP request fails, or when GitHub returns a JSON `error` body (revoked
 *   / expired refresh token). Callers must treat any throw as
 *   "user must re-authenticate".
 */
export async function refreshGitHubAccessToken(refreshToken: string): Promise<RefreshedToken> {
  const clientId = process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.AUTH_GITHUB_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('AUTH_GITHUB_ID / AUTH_GITHUB_SECRET must be set to refresh GitHub tokens.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`GitHub token refresh failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as RefreshedToken;
  if (data.error) {
    throw new Error(`GitHub token refresh failed: ${data.error} ${data.error_description ?? ''}`.trim());
  }
  return data;
}
