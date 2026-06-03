import { SAFE_USER_ID } from '@/lib/storage/user-scope';
import { safeChildPath } from '@/lib/storage/safe-path';

export function getCopilotRuntimeHome(homeRoot: string, userId: string): string {
  if (!SAFE_USER_ID.test(userId)) {
    throw new Error('Refusing unsafe userId for runtime path');
  }
  return safeChildPath(homeRoot, userId);
}
