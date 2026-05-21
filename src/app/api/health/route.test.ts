import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
