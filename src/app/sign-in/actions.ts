'use server';

import { signIn } from '@/lib/auth/config';

// public-action: pre-auth GitHub OAuth handoff; the user session is being created here.
export async function signInWithGitHub(callbackUrl?: string): Promise<void> {
  await signIn('github', { redirectTo: callbackUrl ?? '/' });
}
