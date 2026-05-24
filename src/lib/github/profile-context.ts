/**
 * Route-level helper that builds the per-request developer profile context
 * passed to AI prompts.
 *
 * Every AI route that personalises its prompt with GitHub data follows the
 * same three-step pattern: get a per-request Octokit, build a compact
 * profile, serialise it to a string. This helper consolidates that pattern
 * (including the `try/catch + log.warn` graceful-degradation block) so
 * routes stay focused on their actual responsibility.
 *
 * Routes that need both the structured `CompactDeveloperProfile` (for
 * non-prompt calculations like calibration suggestions) and the serialised
 * string both come out of one call.
 */

import 'server-only';

import type { logger as appLogger } from '@/lib/logger';
import { getOctokitForRequest } from '@/lib/github/client';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import type { CompactDeveloperProfile } from '@/lib/github/types';

type TaggedLogger = ReturnType<typeof appLogger.withTag>;

export interface ProfileContext {
  /** Serialised context safe to embed in a prompt. Empty string on failure. */
  context: string;
  /** Structured profile when the build succeeded; null on failure. */
  profile: CompactDeveloperProfile | null;
}

export interface BuildProfileContextOptions {
  /** Soft upper bound on the serialised context length (tokens vary by model). */
  maxChars: number;
  /** Tagged logger from the calling route — used for the warn path. */
  logger: TaggedLogger;
  /** Used in the warn message so failures are attributable to a route. */
  context: string;
}

/**
 * Build the per-request profile context, or fall back to an empty string
 * and `null` profile if any step fails. Never throws — AI routes degrade
 * gracefully when GitHub data is temporarily unavailable.
 */
export async function buildProfileContext(opts: BuildProfileContextOptions): Promise<ProfileContext> {
  try {
    const octokit = await getOctokitForRequest();
    const profile = await buildCompactContext(octokit, opts.maxChars);
    return { context: serializeContext(profile), profile };
  } catch (error) {
    opts.logger.warn(`Failed to build profile context for ${opts.context}`, error);
    return { context: '', profile: null };
  }
}
