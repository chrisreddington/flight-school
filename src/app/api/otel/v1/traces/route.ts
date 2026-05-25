/**
 * Browser → server OTLP/JSON proxy for trace data.
 *
 * Why a proxy instead of letting the browser export directly?
 * - Aspire's OTLP receiver isn't CORS-enabled for browsers.
 * - In ACA the upstream collector is internal-only.
 * - Centralised auth, body-size and error handling.
 *
 * The route is intentionally permissive about the payload shape — we treat
 * the request body as an opaque OTLP/JSON envelope and forward it byte-for-byte
 * so trace and parent IDs are preserved.
 */

import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { logger } from '@/lib/logger';

const log = logger.withTag('OTLP Proxy');

const MAX_PAYLOAD_BYTES = 256 * 1024;

function resolveUpstream(): string | null {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!raw) return null;
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

/**
 * Parses the OTEL_EXPORTER_OTLP_HEADERS env var (W3C format:
 * `key1=value1,key2=value2`) into a plain header record. Used so the
 * upstream collector receives the same auth credentials that the host
 * Aspire/Otel exporter would use.
 */
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

export async function POST(request: Request): Promise<Response> {
  try {
    await requireUserContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response(null, { status: 401 });
    }
    throw err;
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_PAYLOAD_BYTES) {
    return new Response(null, { status: 413 });
  }

  const body = await request.text();
  if (body.length > MAX_PAYLOAD_BYTES) {
    return new Response(null, { status: 413 });
  }

  const upstream = resolveUpstream();
  if (!upstream) {
    // Telemetry must never break the app — silently accept when no collector
    // is configured (e.g. local dev without Aspire).
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
