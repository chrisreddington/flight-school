/**
 * GitHub API Client
 *
 * Per-request Octokit factory. Each authenticated request constructs its
 * own Octokit instance bound to the session's GitHub App user-to-server
 * token (resolved by `@/lib/auth/context`). There is intentionally NO
 * singleton — sharing Octokit instances across users would leak tokens
 * and rate-limit budgets between sessions.
 *
 * Legacy env / gh-CLI token resolution remains available via
 * `getGitHubToken()` for boot-time and instrumentation paths that
 * legitimately operate without a user (see P6).
 */

import { execFile } from 'child_process';
import { nowMs } from '@/lib/utils/date-utils';
import { Octokit } from 'octokit';
import { promisify } from 'util';

import { requireUserContext } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import {
  recordGitHubOperation,
  setSpanError,
  withSpan,
} from '@/lib/observability/telemetry';

/** Cached token from gh CLI (process-wide, not user-scoped). */
let cachedGhToken: string | null = null;
/** Last time we attempted gh CLI token lookup */
let cachedGhTokenCheckedAt: number | null = null;
/** In-flight gh CLI token request */
let ghTokenPromise: Promise<string | null> | null = null;

/** Cache duration for negative gh CLI lookups (ms) */
const GH_TOKEN_CACHE_TTL_MS = 30 * 1000;
const VALID_GITHUB_TOKEN_PREFIXES = ['ghp_', 'gho_', 'ghs_', 'ghu_', 'github_pat_'];

const log = logger.withTag('GitHub Auth');
const execFileAsync = promisify(execFile);

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

function isValidGitHubToken(token: string): boolean {
  return VALID_GITHUB_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/**
 * Get GitHub token from gh CLI.
 * The gh CLI shares authentication with Copilot, so this provides
 * a lightweight way to get a token without heavy SDK calls.
 *
 * @returns GitHub token or null if gh CLI is not available/authenticated
 */
async function getTokenFromGhCli(): Promise<string | null> {
  if (process.env.NODE_ENV === 'production' || process.env.ACA_DEPLOYMENT === 'true') {
    log.debug('gh CLI fallback disabled in production / ACA');
    return null;
  }

  if (cachedGhToken) {
    log.debug('Using cached gh CLI token');
    return cachedGhToken;
  }

  const now = nowMs();
  if (cachedGhTokenCheckedAt && now - cachedGhTokenCheckedAt < GH_TOKEN_CACHE_TTL_MS) {
    log.debug('gh CLI token check recently failed, skipping retry');
    return null;
  }

  if (!ghTokenPromise) {
    ghTokenPromise = (async () => {
      const checkedAt = nowMs();
      try {
        return await withSpan(
          'github.auth.gh_cli_token',
          { 'auth.method': 'github-cli' },
          async (span) => {
            try {
              log.debug('Attempting to retrieve token from gh CLI');
              const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
                encoding: 'utf-8',
                timeout: 5000,
                maxBuffer: 1024 * 1024,
              });
              const token = stdout.trim();

              log.debug('Retrieved token from gh CLI');

              // Accept all GitHub token types: ghp_ (PAT), gho_ (OAuth), ghs_ (server), ghu_ (user), github_pat_
              if (token && isValidGitHubToken(token)) {
                log.debug('Token validated');
                cachedGhToken = token;
                cachedGhTokenCheckedAt = checkedAt;
                return token;
              }

              span.setAttribute('auth.token.valid', false);
              log.warn('Token does not match expected format');
              cachedGhTokenCheckedAt = checkedAt;
              return null;
            } catch (error) {
              log.error('Failed to retrieve token from gh CLI', error);
              cachedGhTokenCheckedAt = checkedAt;
              log.warn('gh CLI token retrieval failed');
              throw error;
            }
          }
        );
      } catch {
        return null;
      } finally {
        ghTokenPromise = null;
      }
    })();
  }

  return ghTokenPromise;
}

/**
 * Get the best available GitHub token from the environment or gh CLI.
 *
 * @deprecated For authenticated request handling, use {@link getOctokitForRequest}
 *   which resolves the user's session token via `@/lib/auth/context`. This
 *   function remains only for boot-time / instrumentation paths that operate
 *   without a user (and for P6's gh-cli-disable work).
 *
 * @returns GitHub token or null if none available
 */
export async function getGitHubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) {
    log.debug('Using GITHUB_TOKEN from environment');
    return process.env.GITHUB_TOKEN;
  }
  
  log.debug('GITHUB_TOKEN not set, trying gh CLI');
  const token = await getTokenFromGhCli();
  
  if (token) {
    log.info('Successfully retrieved token from gh CLI');
  } else {
    log.warn('No token available from any source');
  }
  
  return token;
}

/**
 * Build a fully instrumented Octokit instance bound to the given token.
 *
 * @remarks
 * Each call constructs a fresh Octokit — there is no caching. Callers are
 * responsible for scoping the returned instance to a single request so user
 * tokens never leak across sessions.
 *
 * @param token - GitHub access token (PAT, gh CLI, or `ghu_` user-to-server token)
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

/**
 * Check if GitHub API is configured (GITHUB_TOKEN or gh CLI auth available).
 *
 * @deprecated Authenticated routes should rely on middleware + session auth
 *   rather than probing for ambient credentials. Retained for boot-time and
 *   debug paths.
 */
export async function isGitHubConfigured(): Promise<boolean> {
  return Boolean(await getGitHubToken());
}

/**
 * Get the authentication method currently in use.
 * @returns 'github-token' if using GITHUB_TOKEN env var, 'github-cli' if using gh CLI
 *
 * Note: `'github-cli'` is a development-only auth method. In production (or when
 * `ACA_DEPLOYMENT=true`), the gh CLI fallback is disabled in {@link getTokenFromGhCli},
 * so this function will never return `'github-cli'` in those environments.
 */
export function getAuthMethod(): 'github-token' | 'github-cli' | 'none' {
  if (process.env.GITHUB_TOKEN) {
    return 'github-token';
  }
  if (cachedGhToken) {
    return 'github-cli';
  }
  return 'none';
}

/**
 * Invalidate the cached gh CLI token lookup.
 * Forces a fresh `gh auth token` invocation on the next call. Use after
 * authentication failures to retry with refreshed credentials.
 */
export function invalidateTokenCache(): void {
  log.warn('Invalidating token cache');
  cachedGhToken = null;
  cachedGhTokenCheckedAt = null;
  ghTokenPromise = null;
}
