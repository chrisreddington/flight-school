/**
 * Profile API Route
 * GET /api/profile
 *
 * Uses Octokit (per-request, bound to the caller's session token) for direct
 * GitHub API access. All logic lives in `@/lib/github/profile-handler`.
 */

import { handleProfileRequest, type ProfileResponse } from '@/lib/github/profile-handler';

export type { ProfileResponse };

export async function GET() {
  return handleProfileRequest();
}
