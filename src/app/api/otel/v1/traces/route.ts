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
import { forwardTracePayload, readTraceRequestBody } from './shared';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireUserContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response(null, { status: 401 });
    }
    throw err;
  }

  const body = await readTraceRequestBody(request);
  if (body === null) {
    return new Response(null, { status: 413 });
  }

  return forwardTracePayload(body);
}
