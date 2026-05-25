/**
 * Evaluation Progress API
 * GET /api/evaluations/[id] - Get evaluation progress for a challenge
 * DELETE /api/evaluations/[id] - Clear evaluation progress
 *
 * Authenticated and **per-user**: only returns evaluations owned by the
 * caller. Storage is partitioned via {@link userScopedFilename}.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleUnauthorizedError } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { getEvaluationProgress, clearEvaluationProgress } from '@/lib/jobs/storage/evaluation-storage';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { userId } = await requireUserContext();
    const { id: challengeId } = await context.params;

    const progress = await getEvaluationProgress(userId, challengeId);

    if (!progress) {
      return NextResponse.json(null);
    }

    return NextResponse.json(progress);
  } catch (err) {
    return handleUnauthorizedError(err);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { userId } = await requireUserContext();
    const { id: challengeId } = await context.params;

    await clearEvaluationProgress(userId, challengeId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleUnauthorizedError(err);
  }
}
