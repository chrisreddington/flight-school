/**
 * Workspace List API Route
 * GET /api/workspace/storage/list
 *
 * Lists all challenge IDs that have stored workspaces **for the authenticated
 * user only**. There is no shared cross-user view.
 */

import { NextResponse } from 'next/server';
import { listDirs } from '@/lib/storage/utils';
import { WORKSPACES_DIR } from '@/lib/workspace/storage';
import { requireUserContext } from '@/lib/auth/context';
import { handleUnauthorizedError } from '@/lib/api';
import { logger } from '@/lib/logger';

const log = logger.withTag('Workspace List API');

const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;

export async function GET() {
  let userId: string;
  try {
    ({ userId } = await requireUserContext());
  } catch (error) {
    return handleUnauthorizedError(error);
  }

  if (!SAFE_PATH_SEGMENT.test(userId)) {
    log.warn('Rejected unsafe userId', { userId });
    return NextResponse.json({ error: 'Invalid user identifier' }, { status: 400 });
  }

  try {
    const challengeIds = await listDirs(`users/${userId}/${WORKSPACES_DIR}`);
    return NextResponse.json({ challengeIds });
  } catch (error) {
    log.error('GET /api/workspace/storage/list failed', { error });
    return NextResponse.json({ error: 'Failed to list workspaces' }, { status: 500 });
  }
}
