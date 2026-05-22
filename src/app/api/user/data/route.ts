/**
 * Per-user data deletion endpoint.
 *
 * `DELETE /api/user/data` — irreversibly deletes all server-side data
 * belonging to the authenticated caller:
 *
 *   - their entire `users/{userId}/` storage subtree (threads,
 *     evaluations, suggestions, focus, anything else partitioned per
 *     user)
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
 *     covered by Phase C's compaction sweeper
 *
 * Cross-user deletion is impossible by construction: every operation is
 * filtered by the server-resolved `userId` from {@link requireUserContext}.
 */

import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { activityLogger } from '@/lib/copilot/activity/logger';
import { jobStorage } from '@/lib/jobs';
import { deleteDir } from '@/lib/storage/utils';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { cancelRunningJob } from '../../jobs/route';

const log = logger.withTag('UserDataAPI');

interface DeleteSummary {
  jobsCancelled: number;
  jobsDeleted: number;
  activityEventsCleared: boolean;
  storageDirDeleted: boolean;
}

export async function DELETE() {
  try {
    const { userId } = await requireUserContext();

    log.info(`[user ${userId}] Deleting all server-side data on user request`);

    // Cancel any in-flight jobs for this user before removing their records.
    const allJobs = await jobStorage.getAll();
    const ownedRunning = allJobs.filter(
      (j) => j.userId === userId && (j.status === 'running' || j.status === 'pending'),
    );

    let jobsCancelled = 0;
    for (const job of ownedRunning) {
      const cancelled = await cancelRunningJob(job.id);
      if (cancelled) jobsCancelled += 1;
    }

    const { deleted: jobsDeleted } = await jobStorage.deleteForUser(userId);

    // Clear this user's slice of the activity buffer.
    activityLogger.clear(userId);

    // Wipe the entire per-user storage directory (threads, evaluations,
    // suggestions, focus, etc.). `deleteDir` is recursive and a no-op
    // when the directory doesn't exist.
    await deleteDir(`users/${userId}`);

    const summary: DeleteSummary = {
      jobsCancelled,
      jobsDeleted,
      activityEventsCleared: true,
      storageDirDeleted: true,
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
