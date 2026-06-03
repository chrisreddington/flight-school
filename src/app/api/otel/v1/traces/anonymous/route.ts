/**
 * Anonymous browser → server OTLP trace proxy.
 *
 * Used before Auth.js session cookies exist so page-load telemetry can still
 * reach the collector. This endpoint is strictly rate-limited by client IP.
 */

import { checkRateLimit } from '@/lib/security/rate-limit';
import { forwardTracePayload, readTraceRequestBody } from '../shared';

const ANON_TRACE_LIMIT = 10;
const ANON_TRACE_WINDOW_MS = 60_000;

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  const connectingIp = request.headers.get('cf-connecting-ip');
  if (connectingIp) return connectingIp;
  return 'unknown';
}

export async function POST(request: Request): Promise<Response> {
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`anon-otel:${clientIp}`, ANON_TRACE_LIMIT, ANON_TRACE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return new Response(null, {
      status: 429,
      headers: { 'retry-after': String(Math.ceil((rateLimit.retryAfterMs ?? ANON_TRACE_WINDOW_MS) / 1000)) },
    });
  }

  const body = await readTraceRequestBody(request);
  if (body === null) {
    return new Response(null, { status: 413 });
  }

  return forwardTracePayload(body);
}
