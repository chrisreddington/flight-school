/**
 * Evaluation Progress API
 * GET /api/evaluations/[id] - Get evaluation progress for a challenge
 * DELETE /api/evaluations/[id] - Clear evaluation progress
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getEvaluationProgress, 
  clearEvaluationProgress 
} from '../../jobs/evaluation-storage';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest, 
  context: RouteContext
): Promise<NextResponse> {
  const { id: challengeId } = await context.params;
  
  const progress = await getEvaluationProgress(challengeId);
  
  if (!progress) {
    return NextResponse.json(null);
  }
  
  return NextResponse.json(progress);
}

export async function DELETE(
  request: NextRequest, 
  context: RouteContext
): Promise<NextResponse> {
  const { id: challengeId } = await context.params;
  
  await clearEvaluationProgress(challengeId);
  
  return NextResponse.json({ success: true });
}
