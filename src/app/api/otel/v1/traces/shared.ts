import { logger } from '@/lib/logger';

const log = logger.withTag('OTLP Proxy');

export const MAX_PAYLOAD_BYTES = 256 * 1024;

function resolveUpstream(): string | null {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!raw) return null;
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

function resolveUpstreamHeaders(): Record<string, string> {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) out[key.toLowerCase()] = value;
  }
  return out;
}

export async function readTraceRequestBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_PAYLOAD_BYTES) return null;

  const body = await request.text();
  if (body.length > MAX_PAYLOAD_BYTES) return null;
  return body;
}

export async function forwardTracePayload(body: string): Promise<Response> {
  const upstream = resolveUpstream();
  if (!upstream) {
    return new Response(null, { status: 204 });
  }

  try {
    const res = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...resolveUpstreamHeaders(),
      },
      body,
    });
    if (!res.ok) {
      log.warn('Upstream OTLP collector rejected payload', { status: res.status });
      return new Response(null, { status: 502 });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    log.warn('Failed to forward OTLP payload to upstream', { err });
    return new Response(null, { status: 502 });
  }
}
