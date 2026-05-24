/**
 * Pure capability-id module — string literal union for every capability
 * the worker may attach. Lives separately from `./capabilities` so Web/API
 * code (which validates capability ids on the wire) can import the type
 * and the validator without transitively pulling the `@github/copilot-sdk`
 * import that `./capabilities` requires.
 *
 * Adding a new capability = add the id here AND add the spec in
 * `./capabilities`. The two stay in lockstep at compile time because
 * `CAPABILITIES` is `satisfies Record<CapabilityId, …>`.
 */

/** Stable identifier for a capability. */
export type CapabilityId = 'github';

/** All capability ids, in declaration order. */
export const ALL_CAPABILITY_IDS: readonly CapabilityId[] = ['github'] as const;

const CAPABILITY_ID_SET: ReadonlySet<string> = new Set(ALL_CAPABILITY_IDS);

/** Type guard for wire validation. */
export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && CAPABILITY_ID_SET.has(value);
}
