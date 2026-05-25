/**
 * Token-bound Octokit factory.
 *
 * This module is intentionally **Next.js-free**: it never imports
 * `next/headers`, `next-auth`, or anything reachable from the
 * Auth.js session. The worker process imports from here. The web
 * tier's request-bound `getOctokitForRequest()` lives in
 * `client.ts`, which is the file that may use `next/headers`.
 */

import { Octokit } from 'octokit';

import { nowMs } from '@/lib/utils/date-utils';
import { recordGitHubOperation, setSpanError, withSpan } from '@/lib/observability/telemetry';

type GitHubRequestOptions = {
  method?: string;
  url?: string;
};

type GitHubResponseLike = {
  status?: number;
  headers?: Record<string, string | number | string[] | undefined>;
};

function getHeaderValue(headers: GitHubResponseLike['headers'], name: string): string | undefined {
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

    return withSpan('github.request', { 'github.route': route, 'http.method': method }, async (span) => {
      try {
        const response = await request(options);
        const responseLike = response as GitHubResponseLike;
        const statusCode = responseLike.status;
        if (statusCode !== undefined) {
          span.setAttribute('http.status_code', statusCode);
        }
        const remaining = getHeaderValue(responseLike.headers, 'x-ratelimit-remaining');
        const reset = getHeaderValue(responseLike.headers, 'x-ratelimit-reset');
        if (remaining !== undefined) span.setAttribute('github.rate_limit.remaining', remaining);
        if (reset !== undefined) span.setAttribute('github.rate_limit.reset', reset);
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
    });
  });
}

/**
 * Build a fully instrumented Octokit instance bound to the given token.
 *
 * @param token - GitHub `ghu_` user-to-server access token
 */
export function getOctokitForToken(token: string): Octokit {
  const instance = new Octokit({ auth: token });
  instrumentOctokitRequests(instance);
  return instance;
}
