const CLIENT_TRIGGER_HEADER_SOURCE = 'x-flight-school-trigger-source';
const CLIENT_TRIGGER_HEADER_ACTION = 'x-flight-school-trigger-action';
const CLIENT_TRIGGER_HEADER_PAGE_PATH = 'x-flight-school-trigger-page-path';
const CLIENT_TRIGGER_HEADER_NAVIGATION_ELAPSED_MS =
  'x-flight-school-trigger-navigation-elapsed-ms';
const CLIENT_TRIGGER_HEADER_TARGET_TYPE = 'x-flight-school-trigger-target-type';
const CLIENT_TRIGGER_HEADER_TARGET_ID = 'x-flight-school-trigger-target-id';
const CLIENT_TRIGGER_HEADER_CORRELATION_ID = 'x-flight-school-trigger-correlation-id';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TARGET_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type TriggerHeaderCarrier = Headers | Record<string, string | undefined>;

export interface ClientTriggerMetadata {
  source: string;
  action: string;
  pagePath?: string;
  navigationElapsedMs?: number;
  targetType?: string;
  targetId?: string;
  correlationId: string;
}

function getHeaderValue(headers: TriggerHeaderCarrier, headerName: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(headerName) ?? undefined;
  }

  const wanted = headerName.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== wanted) continue;
    if (typeof value !== 'string') return undefined;
    return value;
  }

  return undefined;
}

function isValidMetadata(metadata: ClientTriggerMetadata): boolean {
  if (!SLUG_RE.test(metadata.source)) return false;
  if (!SLUG_RE.test(metadata.action)) return false;
  if (!UUID_V4_RE.test(metadata.correlationId)) return false;
  if (metadata.pagePath && !metadata.pagePath.startsWith('/')) return false;
  if (
    typeof metadata.navigationElapsedMs !== 'undefined' &&
    (!Number.isFinite(metadata.navigationElapsedMs) || metadata.navigationElapsedMs < 0)
  ) {
    return false;
  }
  if (metadata.targetType && !SLUG_RE.test(metadata.targetType)) return false;
  if (metadata.targetId && !TARGET_ID_RE.test(metadata.targetId)) return false;
  return true;
}

export function encodeClientTriggerHeaders(metadata: ClientTriggerMetadata): Record<string, string> {
  if (!isValidMetadata(metadata)) {
    throw new Error('Invalid client trigger metadata');
  }

  const headers: Record<string, string> = {
    [CLIENT_TRIGGER_HEADER_SOURCE]: metadata.source,
    [CLIENT_TRIGGER_HEADER_ACTION]: metadata.action,
    [CLIENT_TRIGGER_HEADER_CORRELATION_ID]: metadata.correlationId,
  };

  if (metadata.pagePath) {
    headers[CLIENT_TRIGGER_HEADER_PAGE_PATH] = metadata.pagePath;
  }
  if (typeof metadata.navigationElapsedMs === 'number') {
    headers[CLIENT_TRIGGER_HEADER_NAVIGATION_ELAPSED_MS] = Math.round(
      metadata.navigationElapsedMs,
    ).toString();
  }
  if (metadata.targetType) {
    headers[CLIENT_TRIGGER_HEADER_TARGET_TYPE] = metadata.targetType;
  }
  if (metadata.targetId) {
    headers[CLIENT_TRIGGER_HEADER_TARGET_ID] = metadata.targetId;
  }

  return headers;
}

export function parseClientTriggerFromHeaders(
  headers: TriggerHeaderCarrier,
): ClientTriggerMetadata | undefined {
  const source = getHeaderValue(headers, CLIENT_TRIGGER_HEADER_SOURCE);
  const action = getHeaderValue(headers, CLIENT_TRIGGER_HEADER_ACTION);
  const pagePath = getHeaderValue(headers, CLIENT_TRIGGER_HEADER_PAGE_PATH);
  const navigationElapsedMsRaw = getHeaderValue(headers, CLIENT_TRIGGER_HEADER_NAVIGATION_ELAPSED_MS);
  const targetType = getHeaderValue(headers, CLIENT_TRIGGER_HEADER_TARGET_TYPE);
  const targetId = getHeaderValue(headers, CLIENT_TRIGGER_HEADER_TARGET_ID);
  const correlationId = getHeaderValue(headers, CLIENT_TRIGGER_HEADER_CORRELATION_ID);

  if (!source && !action && !pagePath && !targetType && !targetId && !correlationId) {
    return undefined;
  }

  if (!source || !action || !correlationId) {
    return undefined;
  }

  const navigationElapsedMs =
    typeof navigationElapsedMsRaw === 'string' ? Number(navigationElapsedMsRaw) : undefined;

  const metadata: ClientTriggerMetadata = {
    source,
    action,
    correlationId,
    ...(pagePath ? { pagePath } : {}),
    ...(typeof navigationElapsedMs === 'number' && Number.isFinite(navigationElapsedMs)
      ? { navigationElapsedMs }
      : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
  };

  return isValidMetadata(metadata) ? metadata : undefined;
}

export function toClientTriggerSpanAttributes(
  metadata: ClientTriggerMetadata,
): Record<string, string | number> {
  return {
    'app.trigger.source': metadata.source,
    'app.trigger.action': metadata.action,
    ...(metadata.pagePath ? { 'app.trigger.page_path': metadata.pagePath } : {}),
    ...(typeof metadata.navigationElapsedMs === 'number'
      ? { 'app.trigger.navigation_elapsed_ms': metadata.navigationElapsedMs }
      : {}),
    ...(metadata.targetType ? { 'app.trigger.target_type': metadata.targetType } : {}),
    ...(metadata.targetId ? { 'app.trigger.target_id': metadata.targetId } : {}),
    'app.trigger.correlation_id': metadata.correlationId,
  };
}
