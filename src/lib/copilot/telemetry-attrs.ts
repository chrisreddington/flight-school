/**
 * Shared telemetry attribute formatters for chat/streaming sessions.
 *
 * Lives in its own module so both the session factory and the streaming
 * factory render `copilot.profile.requested_capabilities` identically —
 * keeping span queries stable regardless of which path served the turn.
 */

import type { CapabilitiesArg } from './profile-types';

/**
 * Render `requestedCapabilities` for the
 * `copilot.profile.requested_capabilities` span attribute. `'auto'` and
 * `'default'` pass through; arrays sort and comma-join so identical
 * sets always produce identical telemetry regardless of input order.
 */
export function formatRequestedCapabilities(
  value: CapabilitiesArg | 'default' | undefined,
): string {
  if (value === undefined || value === 'default') return 'default';
  if (value === 'auto') return 'auto';
  return [...value].sort().join(',') || 'none';
}
