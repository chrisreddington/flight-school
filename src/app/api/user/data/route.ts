/**
 * Per-user data deletion endpoint.
 *
 * `DELETE /api/user/data` — irreversibly deletes all server-side data
 * belonging to the authenticated caller:
 *
 *   - their entire `users/{userId}/` storage subtree (legacy flat-file
 *     threads, evaluations, suggestions, focus, anything else partitioned
 *     per user)
 *   - their DocumentStore partitions (skills, habits, focus, profile,
 *     challenges, threads, evaluations, activity, … — persisted under
 *     `_docstore/{container}/{userId}/`, outside the `users/` subtree),
 *     via {@link deleteUserData}
 *   - every {@link BackgroundJob} they own (cancelling any in-flight
 *     ones first)
 *   - every {@link AIActivityEvent} they own in the in-memory activity
 *     buffer
 *
 * This is the user-facing GDPR / data-retention escape hatch. It does
 * NOT delete:
 *   - the Auth.js session token store (sign-out handles that)
 *   - SDK on-disk session-state under `~/.copilot/session-state/{id}/`,
 *     because those are keyed by session id (not user id) and are
 *     covered by the session-state retention sweeper
 *
 * Cross-user deletion is impossible by construction: every operation is
 * filtered by the server-resolved `userId` from {@link requireUserContext}.
 */

import { requireUserContext, UnauthorizedError, readCredentialsFromJwt } from '@/lib/auth/context';
import { captureTracePropagationHeaders } from '@/lib/observability/context-propagation';
import { deleteDir } from '@/lib/storage/utils';
import { deleteUserData, UserDataDeletionError } from '@/lib/storage/document-store/account-deletion';
import { getDocumentStore } from '@/lib/storage/document-store/factory';
import { markUserDeleted, clearUserTombstone } from '@/lib/storage/tombstone';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

import { deleteWorkerActivityForUser } from '../../ai-activity/worker-client';
import { deleteWorkerJobsForUser } from '../../jobs/worker-client';

const log = logger.withTag('UserDataAPI');

/**
 * How recently the user must have signed in for a `DELETE /api/user/data`
 * call to be honoured. Re-using a long-lived browser session for a
 * destructive, irreversible action would let an attacker who phished a
 * single cookie destroy a year of user data. 5 minutes matches the GitHub
 * sudo-mode window for sensitive actions on github.com.
 */
const RECENT_AUTH_WINDOW_SECONDS = 5 * 60;

interface DeleteSummary {
  jobsCancelled: number;
  jobsDeleted: number;
  activityEventsCleared: boolean;
  storageDirDeleted: boolean;
  storeDataDeleted: boolean;
  /**
   * True only when user data may still be on the server (a partition-phase
   * store failure, an activity-buffer clear failure, or a legacy storage-dir
   * wipe failure). This — mirrored by the top-level `success: false` — is the
   * signal the client uses to keep the user signed in for a retry. A
   * registry-only cleanup failure is NOT partial: every byte of user data is
   * gone, so it surfaces via {@link DeleteSummary.registryCleanupPending}
   * instead.
   */
  partial?: true;
  /**
   * Best-effort wipe steps that failed. May contain blocking entries
   * (`store-data:<containers>`, `activity`, `storage-dir`) that imply data
   * remains, or the non-blocking `store-registry` warning that only means the
   * owner record lingers. Use `partial` / `success` to tell the two apart.
   */
  failed?: string[];
  /**
   * Every user-data partition was wiped but the discoverable owner registry
   * entry could not be removed. The wipe is complete (safe to sign out); a
   * later reconciliation sweep prunes the orphaned entry. Only ever emitted
   * alongside `success: true` — if user data also remains (`partial: true`)
   * this flag is suppressed, because its contract is "the wipe is complete".
   */
  registryCleanupPending?: true;
}

interface DeleteRequestBody {
  /**
   * The caller's GitHub login. Must match the server-resolved
   * `session.user.login` exactly. Modal-only confirmation is UX, not
   * security; server enforcement is mandatory (rubber-duck #10).
   */
  confirmLogin?: string;
}

/** Throw if the request's Origin header isn't same-origin with Host. */
function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) {
    throw new Response(JSON.stringify({ error: 'Missing Origin header' }), { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Response(JSON.stringify({ error: 'Invalid Origin header' }), { status: 400 });
  }
  if (url.host !== host) {
    throw new Response(JSON.stringify({ error: 'Cross-origin requests are not allowed' }), {
      status: 403,
    });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    try {
      assertSameOrigin(request);
    } catch (resp) {
      if (resp instanceof Response) return resp;
      throw resp;
    }

    const { userId, login } = await requireUserContext();

    // Recent-auth gate: the destructive nature of this endpoint warrants
    // a sudo-style time window. Anything older than RECENT_AUTH_WINDOW
    // forces the user to sign in again before we'll proceed. The dialog
    // handles `code: 'recent_auth_required'` by sending the user through
    // a fresh sign-in flow.
    const creds = await readCredentialsFromJwt();
    const lastSignInAt = creds?.lastSignInAt;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof lastSignInAt !== 'number' || nowSec - lastSignInAt > RECENT_AUTH_WINDOW_SECONDS) {
      log.info(`[user ${userId}] Delete-all rejected: stale auth`, {
        ageSec: typeof lastSignInAt === 'number' ? nowSec - lastSignInAt : null,
      });
      return NextResponse.json(
        {
          error: 'Please sign in again to confirm this destructive action.',
          code: 'recent_auth_required',
          windowSeconds: RECENT_AUTH_WINDOW_SECONDS,
        },
        { status: 401 },
      );
    }

    // Body confirmation: caller must echo their own GitHub login back to
    // us. Anything else (missing header, wrong login, no body) is
    // rejected without touching state.
    let body: DeleteRequestBody = {};
    try {
      body = (await request.json()) as DeleteRequestBody;
    } catch {
      return NextResponse.json(
        { error: 'Request body must include { confirmLogin: "<your GitHub login>" }.' },
        { status: 400 },
      );
    }
    if (typeof body.confirmLogin !== 'string' || body.confirmLogin !== login) {
      return NextResponse.json({ error: 'confirmLogin does not match the authenticated user.' }, { status: 400 });
    }

    log.info(`[user ${userId}] Deleting all server-side data on user request`);

    // Set the deletion tombstone FIRST so any in-flight executor that
    // tries to flush a final delta after cancellation aborts cleanly
    // instead of recreating the user's directory.
    await markUserDeleted(userId);

    // Cancel any in-flight jobs for this user AND delete their records
    // in one worker call. The worker enforces the cancel-then-delete
    // ordering so executors see terminal intent before records vanish.
    //
    // If this call fails we MUST roll back the tombstone — leaving the
    // user marked `.deleted` with their data intact wedges them into a
    // state where future writes silently no-op (rubber-duck Codex 2B.2).
    const traceCtxRaw = captureTracePropagationHeaders();
    const traceCtx = Object.keys(traceCtxRaw).length > 0 ? traceCtxRaw : undefined;
    let jobsDeleted: number;
    let jobsCancelled: number;
    try {
      const result = await deleteWorkerJobsForUser(userId, traceCtx);
      jobsDeleted = result.deleted;
      jobsCancelled = result.cancelled;
    } catch (err) {
      log.error(`[user ${userId}] Worker job deletion failed; rolling back tombstone`, { err });
      try {
        await clearUserTombstone(userId);
      } catch (rollbackErr) {
        log.error(`[user ${userId}] Tombstone rollback failed`, { err: rollbackErr });
      }
      return NextResponse.json({ error: 'Job service temporarily unavailable. Please retry.' }, { status: 503 });
    }

    // Clear this user's slice of the activity buffer via the worker.
    // The web-side `activityLogger.clear` is a no-op in the new model;
    // the worker DELETE is authoritative. This runs sequentially after the
    // jobs cleanup and is awaited BEFORE wiping the user directory so late
    // activity writes can't recreate the dir.
    let activityEventsCleared = true;
    const failed: string[] = [];
    try {
      await deleteWorkerActivityForUser(userId, traceCtx);
    } catch (err) {
      log.error(`[user ${userId}] Worker activity deletion failed`, { err });
      activityEventsCleared = false;
      failed.push('activity');
    }

    // Wipe the entire per-user storage directory (threads, evaluations,
    // suggestions, focus, etc.). `deleteDir` is recursive and a no-op
    // when the directory doesn't exist. A failure here is tolerated (reported
    // via `failed`) rather than 500ing: the legacy flat-file data may remain,
    // so this is a blocking partial like the partition/activity steps, but the
    // client still needs the 200 summary to know it must NOT sign out.
    let storageDirDeleted = true;
    try {
      await deleteDir(`users/${userId}`);
    } catch (err) {
      log.error(`[user ${userId}] Legacy storage directory deletion failed`, { err });
      storageDirDeleted = false;
      failed.push('storage-dir');
    }

    // Wipe the user's DocumentStore partitions. The file adapter persists
    // under `_docstore/{container}/{userId}/`, NOT under `users/{userId}/`,
    // so `deleteDir` above misses it entirely — without this call the
    // account-deletion endpoint would leave skills/habits/focus/etc. data
    // behind. A failure here is tolerated (reported via `failed`) rather than
    // 500ing, so the rest of the wipe still completes. The failure phase
    // matters: a partition-phase failure means user data is still present
    // (so the client must NOT sign out), whereas a registry-phase failure
    // means the data is gone and only the owner record lingers.
    let storeDataDeleted = true;
    let registryCleanupPending = false;
    try {
      await deleteUserData(await getDocumentStore(), userId);
    } catch (err) {
      log.error(`[user ${userId}] DocumentStore partition deletion failed`, { err });
      if (err instanceof UserDataDeletionError && err.phase === 'registry') {
        // Every partition cleared; only the registry entry removal failed.
        // The user's data IS gone, so this is a completed wipe with a
        // discoverable owner record that a sweep can reconcile later. This
        // must NOT mark the delete partial — the client may safely sign out.
        registryCleanupPending = true;
        failed.push('store-registry');
      } else {
        // Partition-phase (or unknown) failure: some user data may remain.
        storeDataDeleted = false;
        const failedContainers = err instanceof UserDataDeletionError ? err.failedContainers.join(',') : 'unknown';
        failed.push(`store-data:${failedContainers}`);
      }
    }

    // Re-assert the tombstone. The first `markUserDeleted` (above) wrote
    // `tombstones/{userId}`, which lives OUTSIDE the `users/{userId}/` subtree,
    // so the `deleteDir('users/{userId}')` call above never touched it. This
    // second mark is a defensive idempotent re-write, not recovery of a wiped
    // marker — it guarantees the tombstone is present even if a future refactor
    // moves tombstone storage back under the per-user directory. A failure here
    // must not 500 the wipe and must not override the computed summary: the
    // tombstone is best-effort and orthogonal to whether every byte of user
    // data was wiped (which may be partial), so log-and-swallow and still
    // return the summary the client needs.
    try {
      await markUserDeleted(userId);
    } catch (err) {
      log.error(`[user ${userId}] defensive tombstone re-write failed`, { err });
    }

    // `partial` (and the mirrored `success: false`) means user data may still
    // be on the server, so the client keeps the user signed in for a retry.
    // A registry-only cleanup failure is deliberately excluded: the data is
    // gone, only the owner record lingers, so it surfaces as
    // `registryCleanupPending` and the delete still counts as successful.
    const userDataMayRemain = !storeDataDeleted || !activityEventsCleared || !storageDirDeleted;

    const summary: DeleteSummary = {
      jobsCancelled,
      jobsDeleted,
      activityEventsCleared,
      storageDirDeleted,
      storeDataDeleted,
      ...(failed.length > 0 ? { failed } : {}),
      ...(userDataMayRemain ? { partial: true } : {}),
      // `registryCleanupPending` asserts "the wipe is complete", so it can only
      // surface when no user data remains. If activity data also failed to
      // clear, the registry failure stays in `failed` for observability but the
      // flag is suppressed to keep it mutually exclusive with `partial`.
      ...(registryCleanupPending && !userDataMayRemain ? { registryCleanupPending: true } : {}),
    };

    log.info(`[user ${userId}] data deletion complete`, summary);

    return NextResponse.json({ success: !userDataMayRemain, summary });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
