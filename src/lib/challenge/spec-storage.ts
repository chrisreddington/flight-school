/**
 * Ambient-identity facade over the {@link challengeSpecRepo} collection.
 *
 * The original challenge flow embedded the full spec into the URL
 * (`/challenge?title=…&description=…`), which (a) made the URL fragile,
 * (b) lost state across reloads, and (c) opened a "tampered link overwrites
 * another user's challenge" surface. M2.5 moved the spec server-side under the
 * per-user `challenges` partition; S1 moved that partition into the envelope
 * {@link import('../storage/document-store/types').DocumentStore}.
 *
 * This module keeps the historical `readUserChallengeSpec(id)` /
 * `writeUserChallengeSpec(id, spec)` surface — it resolves the GitHub identity
 * internally via {@link requireUserContext} (callers never pass `userId`) and
 * delegates the actual storage to {@link challengeSpecRepo}, which takes the
 * explicit, already-trusted `userId`. The repo owns id-validation, the schema
 * guard, and the read-through-migrating semantics.
 *
 * @module challenge/spec-storage
 */

import 'server-only';

import { requireUserContext } from '@/lib/auth/context';

import { challengeSpecRepo, InvalidChallengeIdError, type ChallengeSpec } from './repo';

export { InvalidChallengeIdError };
export type { ChallengeSpec };

/**
 * Reads a previously-written challenge spec for the authenticated user.
 *
 * Contract (owned by {@link challengeSpecRepo}):
 * - **Invalid id** → throws {@link InvalidChallengeIdError}. JSON-contract
 *   callers map to `400`.
 * - **Missing spec** → returns `null`.
 * - **Schema-invalid payload** → returns `null` (logged at warn). Treated as
 *   missing rather than throwing so a corrupted record does not break the
 *   user's dashboard.
 */
export async function readUserChallengeSpec(id: string): Promise<ChallengeSpec | null> {
  const { userId } = await requireUserContext();
  return challengeSpecRepo.read(userId, id);
}

/**
 * Writes a challenge spec for the authenticated user. Throws
 * {@link InvalidChallengeIdError} on an invalid `id`.
 */
export async function writeUserChallengeSpec(id: string, spec: ChallengeSpec): Promise<void> {
  const { userId } = await requireUserContext();
  await challengeSpecRepo.write(userId, id, spec);
}
