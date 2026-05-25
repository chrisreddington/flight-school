import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, UnauthorizedErrorMock } = vi.hoisted(() => {
  class UnauthorizedErrorMock extends Error {
    readonly status = 401;
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  return {
    mocks: {
      requireUserContext: vi.fn(),
      fetch: vi.fn(),
    },
    UnauthorizedErrorMock,
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: mocks.requireUserContext,
  UnauthorizedError: UnauthorizedErrorMock,
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mocks.fetch as unknown as typeof fetch;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  mocks.requireUserContext.mockResolvedValue({
    userId: '42',
    login: 'octocat',
    accessToken: 'ghu_test',
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function loadRoute() {
  vi.resetModules();
  return import('./route');
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/otel/v1/traces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/otel/v1/traces', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireUserContext.mockRejectedValue(new UnauthorizedErrorMock());
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({ resourceSpans: [] }));

    expect(res.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 204 and skips forwarding when no upstream is configured', async () => {
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({ resourceSpans: [] }));

    expect(res.status).toBe(204);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('forwards OTLP payload to the upstream collector', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    const { POST } = await loadRoute();

    const payload = { resourceSpans: [{ scopeSpans: [] }] };
    const res = await POST(makeRequest(payload));

    expect(res.status).toBe(204);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe('http://collector:4318/v1/traces');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect((init as RequestInit).body).toBe(JSON.stringify(payload));
  });

  it('handles upstream endpoints already ending in /v1/traces', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318/v1/traces';
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({ resourceSpans: [] }));

    expect(res.status).toBe(204);
    const [url] = mocks.fetch.mock.calls[0];
    expect(url).toBe('http://collector:4318/v1/traces');
  });

  it('returns 413 when payload exceeds the size cap', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    const { POST } = await loadRoute();

    const huge = 'x'.repeat(300_000);
    const req = new Request('http://localhost/api/otel/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(huge.length) },
      body: huge,
    });
    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('forwards configured OTLP headers (e.g. auth) to the upstream', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-otlp-api-key=secret-key,authorization=Bearer abc';
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({ resourceSpans: [] }));

    expect(res.status).toBe(204);
    const [, init] = mocks.fetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-otlp-api-key']).toBe('secret-key');
    expect(headers['authorization']).toBe('Bearer abc');
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
  });

  it('returns 502 when upstream forwarding fails', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    mocks.fetch.mockRejectedValue(new Error('connection refused'));
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({ resourceSpans: [] }));

    expect(res.status).toBe(502);
  });
});
