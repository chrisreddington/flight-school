/**
 * Pure profile-types module — the wire/IPC contract for chat profile ids
 * and caller-supplied capability selections. NO `@github/copilot-sdk`
 * imports (direct or transitive); safe to import from Web/API, hooks,
 * and components.
 *
 * The worker-internal {@link ./profiles} module owns the registry that
 * binds these ids to models, base prompts, capability defaults, and the
 * resolution logic. Web/API validates against the constants here; the
 * worker is the only side that ever calls `resolveProfile`.
 */

import { isCapabilityId, type CapabilityId } from './capability-ids';

/** Stable identifier for a base chat profile (capability-neutral surface). */
export type BaseProfileId =
  | 'chat'
  | 'learning'
  | 'coach'
  | 'evaluation'
  | 'authoring';

/** All base profile ids in declaration order. */
export const BASE_PROFILE_IDS: readonly BaseProfileId[] = [
  'chat',
  'learning',
  'coach',
  'evaluation',
  'authoring',
] as const;

/** Set form of {@link BASE_PROFILE_IDS} for O(1) wire validation. */
export const BASE_PROFILE_ID_SET: ReadonlySet<BaseProfileId> = new Set(BASE_PROFILE_IDS);

/** Type guard for wire validation. */
export function isBaseProfileId(value: unknown): value is BaseProfileId {
  return typeof value === 'string' && BASE_PROFILE_ID_SET.has(value as BaseProfileId);
}

/**
 * Profiles permitted on `chat-response` jobs (streamed worker chat). The
 * worker streaming factory is the single consumer; HTTP + IPC validators
 * import this so all three layers reject doomed payloads with the same
 * shape.
 */
export const CHAT_RESPONSE_PROFILES = ['chat', 'learning'] as const;
export type ChatResponseProfileId = (typeof CHAT_RESPONSE_PROFILES)[number];

/** Type guard for `chat-response` profile narrowing. */
export function isChatResponseProfile(value: unknown): value is ChatResponseProfileId {
  return typeof value === 'string'
    && (CHAT_RESPONSE_PROFILES as readonly string[]).includes(value);
}

/**
 * Caller-supplied capability selection on the wire / IPC. The worker
 * resolves this against the profile's allowed list and defaults; the
 * caller never gets authority to bypass profile policy.
 *
 *  - `'auto'` — server evaluates `autoCapabilities` heuristics
 *  - `readonly CapabilityId[]` — explicit list, intersected with the
 *    profile's `allowedCapabilities`
 *  - omitted (undefined) — defaults only
 */
export type CapabilitiesArg = 'auto' | readonly CapabilityId[];

/**
 * Type guard for the `'auto' | CapabilityId[]` wire shape. Rejects any
 * value that is neither the literal `'auto'` nor an array of valid
 * capability ids.
 */
export function isCapabilitiesArg(value: unknown): value is CapabilitiesArg {
  if (value === 'auto') return true;
  return Array.isArray(value) && value.every(isCapabilityId);
}

/**
 * Per-profile capability allowlist. Pure data so Web/API can reject
 * `{profile: 'evaluation', capabilities: ['github']}` at the route
 * boundary with a 400 instead of forwarding a doomed request to the
 * worker. The worker's `resolveProfile` performs the same check (defence
 * in depth) and throws `InvalidCapabilityError`.
 *
 * MUST stay in sync with `PROFILES[id].allowedCapabilities` in
 * `./profiles.ts` — the worker registry imports this map so the two
 * cannot drift.
 */
export const PROFILE_ALLOWED_CAPABILITIES: Readonly<
  Record<BaseProfileId, readonly CapabilityId[]>
> = {
  chat: ['github'],
  learning: ['github'],
  coach: ['github'],
  evaluation: [],
  authoring: [],
};

/**
 * Returns true when every explicit id in `capabilities` is in the
 * profile's allowlist. `'auto'` and `undefined` always pass — the worker
 * is responsible for honouring `autoCapabilities` and defaults.
 */
export function areCapabilitiesAllowedForProfile(
  profileId: BaseProfileId,
  capabilities: CapabilitiesArg | undefined,
): boolean {
  if (capabilities === undefined || capabilities === 'auto') return true;
  const allowed = new Set<string>(PROFILE_ALLOWED_CAPABILITIES[profileId]);
  return capabilities.every((id) => allowed.has(id));
}
