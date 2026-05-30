/**
 * Per-user, by-id challenge-spec collection accessor over the envelope
 * {@link import('../storage/document-store/types').DocumentStore}.
 *
 * Unlike the domain singletons (skills, habits, …) a user owns MANY challenge
 * specs, one per generated challenge id, so this is a COLLECTION repo rather
 * than a {@link import('../storage/document-store/singleton-repo').SingletonRepo}:
 * every method takes both an already-trusted `userId` and the challenge `id`,
 * and reads are deliberately SIDE-EFFECT-FREE. A singleton self-heals a missing
 * document by writing its default; a by-id collection must NOT — a missing spec
 * is a genuine `null` (expired/never-authored content), never a freshly-minted
 * default. The id is the document id within the `'challenges'` container, so a
 * spec is never "listed" or "removed" through this surface; only `read`/`write`
 * exist.
 *
 * Read-through-migrating semantics mirror the singleton compat core
 * ({@link import('../storage/document-store/user-storage-core')}) MINUS the
 * self-heal write-back:
 * - Envelope present + valid → return the body.
 * - Envelope present + corrupt → `null` (+warn), no write-back.
 * - Envelope absent + legacy `challenges/{id}.json` present + valid → return the
 *   body AS-IS (the standalone migrator is the only legacy→envelope promoter).
 * - Envelope absent + legacy missing/empty/corrupt → `null` (+warn on corrupt).
 *
 * This module is SERVER-SIDE: {@link buildCompatDeps} imports the `server-only`
 * envelope backend. The ambient-identity facade in
 * {@link import('./spec-storage')} resolves the user and delegates here.
 *
 * @module challenge/repo
 */

import type { DailyChallenge } from '@/lib/focus/base-types';
import { logger } from '@/lib/logger';
import { buildCompatDeps } from '@/lib/storage/document-store/compat-deps';
import { SAFE_PATH_SEGMENT } from '@/lib/storage/user-scope';

const log = logger.withTag('Challenge Spec Repo');

/**
 * The on-disk shape of a challenge spec. Aliased to `DailyChallenge` so callers
 * that already have a generated focus challenge can persist it without a
 * transform.
 */
export type ChallengeSpec = DailyChallenge;

/** The envelope container challenge specs live in. */
const CHALLENGES_CONTAINER = 'challenges' as const;

/**
 * Thrown when a supplied challenge `id` fails {@link SAFE_PATH_SEGMENT}
 * validation.
 *
 * @remarks
 * Callers that emit JSON (the `/api/workspace/storage` route, the
 * `regenerateChallengeAction` Server Action, …) map this to a `400 Bad
 * Request`. Server Components pre-validate the id inline and call `notFound()`
 * instead — the throw is the defence-in-depth net rather than the primary
 * 400-class path.
 */
export class InvalidChallengeIdError extends Error {
  constructor(id: string) {
    super(`Invalid challenge id: ${JSON.stringify(id)}`);
    this.name = 'InvalidChallengeIdError';
  }
}

/**
 * Defensive shape check applied to every read. Mirrors the load-bearing fields
 * the sandbox + workspace builder consume; full validation is the writer's
 * responsibility (writers call this repo with a fresh `DailyChallenge` produced
 * by `generateFocus`).
 */
export function isChallengeSpec(value: unknown): value is ChallengeSpec {
  if (typeof value !== 'object' || value === null) return false;
  const spec = value as Record<string, unknown>;
  return (
    typeof spec.id === 'string' &&
    typeof spec.title === 'string' &&
    typeof spec.description === 'string' &&
    typeof spec.difficulty === 'string' &&
    typeof spec.language === 'string'
  );
}

/** Reject an `id` that could escape the per-user `challenges/` partition. */
function assertSafeChallengeId(id: string): void {
  if (!SAFE_PATH_SEGMENT.test(id)) {
    throw new InvalidChallengeIdError(id);
  }
}

/**
 * Parse a raw legacy file body, returning the parsed value or `undefined` when
 * the body is empty or not valid JSON. A corrupt legacy file degrades to the
 * same `null` a missing one yields.
 */
function tryParse(raw: string): unknown {
  if (raw.trim().length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Typed, explicit-`userId` accessor for a user's by-id challenge specs. The
 * `userId` is already trusted (resolved from a server auth context by the
 * caller); the repo never re-authenticates.
 */
export interface ChallengeSpecRepo {
  /**
   * Read the spec stored under `id`, or `null` when absent/corrupt. Reads NEVER
   * write (no self-heal default) — a missing spec is expired content, not a new
   * document.
   *
   * @throws {InvalidChallengeIdError} when `id` fails {@link SAFE_PATH_SEGMENT}.
   */
  read(userId: string, id: string): Promise<ChallengeSpec | null>;
  /**
   * Persist `spec` under `id` in the envelope store. Preserves the legacy
   * `writeUserChallengeSpec` contract verbatim: no write-side shape guard, the
   * body is stored as supplied.
   *
   * @throws {InvalidChallengeIdError} when `id` fails {@link SAFE_PATH_SEGMENT}.
   */
  write(userId: string, id: string, spec: ChallengeSpec): Promise<void>;
}

/**
 * The singleton {@link ChallengeSpecRepo} instance. Reuses {@link buildCompatDeps}
 * for the envelope store + legacy read seam exactly as the singleton repos do.
 */
export const challengeSpecRepo: ChallengeSpecRepo = {
  async read(userId: string, id: string): Promise<ChallengeSpec | null> {
    assertSafeChallengeId(id);
    const deps = await buildCompatDeps(userId);

    const envelope = await deps.store.getEnvelope<ChallengeSpec>(CHALLENGES_CONTAINER, id);
    if (envelope !== null) {
      if (isChallengeSpec(envelope.body)) {
        return envelope.body;
      }
      log.warn('Challenge spec envelope failed shape check; treating as missing', { id });
      return null;
    }

    const raw = await deps.legacy.readRaw(`challenges/${id}.json`);
    if (raw === null) return null;
    const parsed = tryParse(raw);
    if (parsed !== undefined && isChallengeSpec(parsed)) {
      // Healthy legacy file: hand it back without promoting it to an envelope.
      // The standalone migrator is the sole legacy→envelope writer.
      return parsed;
    }
    log.warn('Challenge spec legacy file missing or invalid; treating as missing', { id });
    return null;
  },

  async write(userId: string, id: string, spec: ChallengeSpec): Promise<void> {
    assertSafeChallengeId(id);
    const deps = await buildCompatDeps(userId);
    await deps.store.put(CHALLENGES_CONTAINER, id, spec);
  },
};
