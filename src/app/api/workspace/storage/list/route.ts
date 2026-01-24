/**
 * Workspace List API Route
 * GET /api/workspace/storage/list
 *
 * Lists all challenge IDs that have stored workspaces.
 */

import { NextResponse } from 'next/server';
import { listDirs } from '@/lib/storage/utils';
import { WORKSPACES_DIR } from '@/lib/workspace/storage';
import { logger } from '@/lib/logger';

const log = logger.withTag('Workspace List API');

export async function GET() {
  try {
    const challengeIds = await listDirs(WORKSPACES_DIR);
    return NextResponse.json({ challengeIds });
  } catch (error) {
    log.error('GET /api/workspace/storage/list failed', { error });
    return NextResponse.json({ error: 'Failed to list workspaces' }, { status: 500 });
  }
}
