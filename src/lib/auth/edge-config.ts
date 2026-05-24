/**
 * Edge-safe Auth.js config used by `proxy.ts` (Next 16 rename).
 *
 * The full config in `src/lib/auth/config.ts` is imported by route handlers
 * and server components that may pull in Node-only modules. The proxy
 * runs on the edge runtime, so it needs a slim config without provider
 * `clientSecret` calls or fetch-based refresh logic.
 */

import type { NextAuthConfig } from 'next-auth';

export const edgeAuthConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: { signIn: '/sign-in' },
  providers: [],
  callbacks: {
    authorized({ auth: session }) {
      return Boolean(session);
    },
  },
};
