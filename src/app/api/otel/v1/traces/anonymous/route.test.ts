import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mocks.fetch as unknown as typeof fetch;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  const { __resetRateLimitState } = await import('@/lib/security/rate-limit');
  __resetRateLimitState();
});

async function loadRoute() {
  vi.resetModules();
  return import('./route');
}

function makeRequest(body: unknown, ip = '203.0.113.10'): Request {
  return new Request('http://localhost/api/otel/v1/traces/anonymous', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/otel/v1/traces/anonymous', () => {
  it('returns 204 and skips forwarding when no upstream is configured', async () => {
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({ resourceSpans: [] }));

    expect(res.status).toBe(204);
    expect(mocks.fetch.mock.calls).toEqual([]);
  });

  it('forwards OTLP payload to upstream when configured', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    const { POST } = await loadRoute();

    const payload = { resourceSpans: [{ scopeSpans: [] }] };
    const res = await POST(makeRequest(payload));

    expect(res.status).toBe(204);
    expect(mocks.fetch.mock.calls).toHaveLength(1);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe('http://collector:4318/v1/traces');
    expect((init as RequestInit).body).toBe(JSON.stringify(payload));
  });

  it('rate limits anonymous callers by IP at 10 requests/minute', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    const { POST } = await loadRoute();

    for (let i = 0; i < 10; i += 1) {
      const okRes = await POST(makeRequest({ n: i }));
      expect(okRes.status).toBe(204);
    }

    const blockedRes = await POST(makeRequest({ n: 10 }));
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('retry-after')).toBeTruthy();
  });
});
