/**
 * GitHub API Client
 *
 * Per-request Octokit factory. Each authenticated request constructs its
 * own Octokit instance bound to the session's GitHub App user-to-server
 * (`ghu_`) token, resolved from the Auth.js session via
 * `@/lib/auth/context`.
 *
 * There is intentionally **no** ambient token resolution in this module —
 * no `GITHUB_TOKEN` env fallback, no `gh auth token` CLI lookup, no
 * process-wide cache. Every caller must supply a token that came from the
 * authenticated user context. Routes that have no user context cannot
 * reach GitHub and must return 401.
 */

import { nowMs } from '@/lib/utils/date-utils';
import { Octokit } from 'octokit';

import { requireUserContext } from '@/lib/auth/context';
import {
  recordGitHubOperation,
  setSpanError,
  withSpan,
} from '@/lib/observability/telemetry';

type GitHubRequestOptions = {
  method?: string;
  url?: string;
};

type GitHubResponseLike = {
  status?: number;
  headers?: Record<string, string | number | string[] | undefined>;
};

function getHeaderValue(
  headers: GitHubResponseLike['headers'],
  name: string
): string | undefined {
  const raw = headers?.[name];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw[0];
  return String(raw);
}

function instrumentOctokitRequests(instance: Octokit): void {
  instance.hook.wrap('request', async (request, options) => {
    const requestOptions = options as GitHubRequestOptions;
    const route = requestOptions.url ?? 'unknown';
    const method = requestOptions.method ?? 'GET';
    const startTime = nowMs();

    return withSpan(
      'github.request',
      {
        'github.route': route,
        'http.method': method,
      },
      async (span) => {
        try {
          const response = await request(options);
          const responseLike = response as GitHubResponseLike;
          const statusCode = responseLike.status;
          if (statusCode !== undefined) {
            span.setAttribute('http.status_code', statusCode);
          }

          const remaining = getHeaderValue(responseLike.headers, 'x-ratelimit-remaining');
          const reset = getHeaderValue(responseLike.headers, 'x-ratelimit-reset');
          if (remaining !== undefined) {
            span.setAttribute('github.rate_limit.remaining', remaining);
          }
          if (reset !== undefined) {
            span.setAttribute('github.rate_limit.reset', reset);
          }

          recordGitHubOperation(route, nowMs() - startTime, 'ok', statusCode);
          return response;
        } catch (error) {
          setSpanError(span, error);
          const statusCode =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status?: unknown }).status === 'number'
              ? (error as { status: number }).status
              : undefined;
          recordGitHubOperation(route, nowMs() - startTime, 'error', statusCode);
          throw error;
        }
      }
    );
  });
}

/**
 * Build a fully instrumented Octokit instance bound to the given token.
 *
 * @remarks
 * Each call constructs a fresh Octokit — there is no caching. Callers are
 * responsible for scoping the returned instance to a single request so user
 * tokens never leak across sessions.
 *
 * @param token - GitHub `ghu_` user-to-server access token from the
 *   authenticated session
 * @returns Configured Octokit instance with OpenTelemetry request instrumentation
 */
export function getOctokitForToken(token: string): Octokit {
  const instance = new Octokit({ auth: token });
  instrumentOctokitRequests(instance);
  return instance;
}

/**
 * Construct an Octokit instance for the current authenticated request.
 *
 * @remarks
 * Resolves the per-user `ghu_` token from the Auth.js session via
 * `requireUserContext()` and returns a freshly instrumented Octokit. Throws
 * {@link UnauthorizedError} when no session is present — API routes should
 * either catch that error or rely on the route middleware to surface 401s.
 *
 * @returns Configured Octokit bound to the requesting user's access token
 * @throws {@link UnauthorizedError} when the request has no authenticated session
 */
export async function getOctokitForRequest(): Promise<Octokit> {
  const { accessToken } = await requireUserContext();
  return getOctokitForToken(accessToken);
}
