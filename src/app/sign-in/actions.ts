'use server';

import { signIn } from '@/lib/auth/config';

export async function signInWithGitHub(callbackUrl?: string): Promise<void> {
  await signIn('github', { redirectTo: callbackUrl ?? '/' });
}
