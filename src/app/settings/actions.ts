'use server';

import { signOut } from '@/lib/auth/config';

/**
 * Sign the caller out via Auth.js. Used by the Settings page after a
 * successful "Delete all my data" confirmation so the user isn't left
 * on an authenticated page with an empty backend.
 */
// public-action: Auth.js sign-out only clears the session cookie; no per-user data accessed.
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/sign-in' });
}
