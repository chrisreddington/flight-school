/**
 * GitHub API Client (web-tier request entrypoint).
 *
 * Re-exports the Next-free token factory from `octokit-factory.ts` and
 * adds `getOctokitForRequest()` which reads the Auth.js session via
 * `next/headers`. The worker MUST import from `./octokit-factory`
 * directly — it has no request-bound auth — and `scripts/check-worker-next-free.mjs`
 * enforces that boundary.
 */

import { Octokit } from 'octokit';

import { requireUserContext } from '@/lib/auth/context';

import { getOctokitForToken } from './octokit-factory';

export { getOctokitForToken };

/**
 * Construct an Octokit instance for the current authenticated request.
 *
 * @throws {@link UnauthorizedError} when the request has no authenticated session
 */
export async function getOctokitForRequest(): Promise<Octokit> {
  const { accessToken } = await requireUserContext();
  return getOctokitForToken(accessToken);
}
