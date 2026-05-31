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
import { deleteUserData } from '@/lib/storage/document-store/account-deletion';
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
  partial?: boolean;
  failed?: string[];
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
    // the worker DELETE is authoritative. Run it in parallel with the
    // jobs cleanup-implied tombstone but await it BEFORE wiping the
    // user directory so late activity writes don't recreate the dir.
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
    // when the directory doesn't exist.
    await deleteDir(`users/${userId}`);

    // Wipe the user's DocumentStore partitions. The file adapter persists
    // under `_docstore/{container}/{userId}/`, NOT under `users/{userId}/`,
    // so `deleteDir` above misses it entirely — without this call the
    // account-deletion endpoint would leave skills/habits/focus/etc. data
    // behind. A partial failure here is tolerated (reported via `failed`)
    // rather than 500ing, so the rest of the wipe still completes.
    let storeDataDeleted = true;
    try {
      await deleteUserData(await getDocumentStore(), userId);
    } catch (err) {
      log.error(`[user ${userId}] DocumentStore partition deletion failed`, { err });
      storeDataDeleted = false;
      failed.push('store-data');
    }

    // Restore the tombstone marker after deleteDir wipes it (deleteDir
    // recursively removes everything under `users/{userId}/` including
    // `.deleted`). The marker must remain in place until the user signs
    // in again so any late executor write still aborts.
    await markUserDeleted(userId);

    const summary: DeleteSummary = {
      jobsCancelled,
      jobsDeleted,
      activityEventsCleared,
      storageDirDeleted: true,
      storeDataDeleted,
      ...(failed.length > 0 ? { partial: true, failed } : {}),
    };

    log.info(`[user ${userId}] data deletion complete`, summary);

    return NextResponse.json({ success: true, summary });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
