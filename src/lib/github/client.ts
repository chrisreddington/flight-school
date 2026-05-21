/**
 * GitHub API Client
 *
 * Singleton Octokit instance for direct GitHub API access.
 * Authentication priority:
 * 1. GITHUB_TOKEN environment variable (fastest)
 * 2. `gh auth token` from GitHub CLI (shares Copilot auth)
 */

import { execFile } from 'child_process';
import { nowMs } from '@/lib/utils/date-utils';
import { Octokit } from 'octokit';
import { promisify } from 'util';

import { logger } from '@/lib/logger';
import {
  recordGitHubOperation,
  setSpanError,
  withSpan,
} from '@/lib/observability/telemetry';

/** Singleton Octokit instance */
let octokitInstance: Octokit | null = null;

/** Cached token from gh CLI */
let cachedGhToken: string | null = null;
/** Last time we attempted gh CLI token lookup */
let cachedGhTokenCheckedAt: number | null = null;
/** In-flight gh CLI token request */
let ghTokenPromise: Promise<string | null> | null = null;
/** In-flight Octokit creation */
let octokitPromise: Promise<Octokit> | null = null;

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
 * Get the best available GitHub token.
 * Prefers GITHUB_TOKEN env var, falls back to gh CLI.
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
 * Get the singleton Octokit client.
 * Uses GITHUB_TOKEN from env or gh CLI auth.
 *
 * @returns Configured Octokit instance
 * @throws Error if no GitHub token is available
 */
export async function getOctokit(): Promise<Octokit> {
  if (octokitInstance) {
    return octokitInstance;
  }

  if (!octokitPromise) {
    octokitPromise = (async () => {
      const token = await getGitHubToken();
      if (!token) {
        throw new Error(
          'GitHub authentication required. Set GITHUB_TOKEN or run `gh auth login`.'
        );
      }
      const instance = new Octokit({ auth: token });
      instrumentOctokitRequests(instance);
      octokitInstance = instance;
      return instance;
    })();
  }

  try {
    return await octokitPromise;
  } catch (error) {
    octokitPromise = null;
    throw error;
  }
}

/**
 * Check if GitHub API is configured (GITHUB_TOKEN or gh CLI auth available).
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
 * Invalidate the cached GitHub token.
 * Forces a fresh token retrieval on the next call to getGitHubToken().
 * Use this when authentication fails to ensure retry with fresh credentials.
 */
export function invalidateTokenCache(): void {
  log.warn('Invalidating token cache');
  cachedGhToken = null;
  cachedGhTokenCheckedAt = null;
  ghTokenPromise = null;
  octokitInstance = null;
  octokitPromise = null;
}
