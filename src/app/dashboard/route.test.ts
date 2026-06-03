import { describe, expect, it, vi, beforeEach } from 'vitest';

const permanentRedirect = vi.fn((url: string) => {
  // Mirror Next.js behaviour: throw a tagged digest so callers see the redirect.
  const err = new Error(`NEXT_REDIRECT;replace;${url};308;`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};308;`;
  throw err;
});

vi.mock('next/navigation', () => ({ permanentRedirect }));

describe('/dashboard route', () => {
  beforeEach(() => {
    permanentRedirect.mockClear();
  });

  it('issues a 308 permanent redirect to /', async () => {
    const { GET } = await import('./route');

    expect(() => GET()).toThrow(/NEXT_REDIRECT/);
    expect(permanentRedirect).toHaveBeenCalledExactlyOnceWith('/');
  });
});
