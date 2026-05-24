/**
 * Chat profile registry — the single source of truth for which model,
 * base prompt, and capability composition power each chat surface.
 *
 * Profiles are intentionally small. The heavy lifting — MCP factories,
 * tool allowlists, capability-specific prompt instructions — lives on
 * the capability spec in {@link ./capabilities}. A profile declares:
 *
 *  - `basePrompt`: capability-neutral voice / tone instructions
 *  - `defaultCapabilities`: applied when the caller omits `capabilities`
 *  - `allowedCapabilities`: caller-supplied explicit ids are intersected
 *    with this allowlist (an id outside the list is a 400 / IPC error)
 *  - `autoCapabilities`: ids whose `shouldElevate(prompt)` heuristic
 *    runs when the caller passes `capabilities: 'auto'`. Empty array =
 *    no auto-elevation permitted.
 *  - `capabilityDefaults`: per-profile tool / addendum overrides for
 *    capabilities the profile uses (e.g. coach restricts github tools
 *    and ships a coach-scoped addendum)
 *
 * `resolveProfile()` composes the final `systemMessage` from the base
 * prompt + each selection's effective addendum, so any N×M combination
 * of capabilities and chat surfaces costs zero extra code.
 *
 * Worker-internal: imports the SDK transitively via `./capabilities`.
 */

import {
  CHAT_BASE_PROMPT,
  COACH_BASE_PROMPT,
  COACH_GITHUB_PROMPT_ADDENDUM,
  LEARNING_LENS_PROMPT,
} from './prompts';
import {
  CAPABILITIES,
  type CapabilitySelection,
} from './capabilities';
import { type CapabilityId } from './capability-ids';
import {
  BASE_PROFILE_IDS,
  PROFILE_ALLOWED_CAPABILITIES,
  type BaseProfileId,
  type CapabilitiesArg,
} from './profile-types';

export {
  BASE_PROFILE_IDS,
  BASE_PROFILE_ID_SET,
  PROFILE_ALLOWED_CAPABILITIES,
  areCapabilitiesAllowedForProfile,
  isBaseProfileId,
  type BaseProfileId,
  type CapabilitiesArg,
} from './profile-types';

/**
 * Static profile definition. Immutable at runtime.
 */
export interface ChatProfile {
  id: BaseProfileId;
  /** Model identifier passed to the Copilot SDK. */
  model: string;
  /**
   * Capability-neutral base prompt. Voice and tone live here; capability
   * usage instructions belong in the capability's `promptAddendum` (or
   * a per-profile override in `capabilityDefaults`).
   *
   * May be empty when the caller layers the entire prompt at session
   * creation time (e.g. evaluation, authoring).
   */
  basePrompt: string;
  /** Selections applied when the caller omits `capabilities`. */
  defaultCapabilities: readonly CapabilitySelection[];
  /** Caller-supplied capability ids are intersected with this allowlist. */
  allowedCapabilities: readonly CapabilityId[];
  /**
   * Ids whose `shouldElevate(prompt)` heuristic runs when the caller
   * passes `capabilities: 'auto'`. Empty array = no auto-elevation
   * (equivalent to the old `allowElevation: false`).
   */
  autoCapabilities: readonly CapabilityId[];
  /**
   * Per-profile tool / addendum overrides for capabilities the profile
   * uses. Lets coach restrict github tools to `['get_me',
   * 'list_user_repositories']` AND swap in a coach-scoped addendum
   * without the registry knowing about coach.
   */
  capabilityDefaults?: Partial<
    Record<
      CapabilityId,
      {
        tools?: readonly string[];
        /** Replaces `CAPABILITIES[id].promptAddendum` when present. */
        promptAddendum?: string;
      }
    >
  >;
}

/**
 * Profile resolved against a runtime context. The `capabilities` array
 * is sorted by id and deduped so the fingerprint is stable regardless
 * of input order. The `systemMessage` is the composed final string.
 */
export interface ResolvedProfile {
  profileId: BaseProfileId;
  model: string;
  /** Composed system message: profile.basePrompt + active addenda. */
  systemMessage: string;
  /** Final capabilities, sorted by id, deduped, with effective addenda. */
  capabilities: readonly CapabilitySelection[];
  /** Stable fingerprint of the resolved capability set, for cache keys. */
  capabilityFingerprint: string;
  /**
   * True when `shouldElevate` added at least one capability that was not
   * already in `defaultCapabilities` and was not carried in via
   * `conversationCapabilities`.
   */
  wasAutoElevated: boolean;
  /** Mirrors the caller's request shape for telemetry / debug. */
  requestedCapabilities: CapabilitiesArg | 'default';
}

/**
 * Context passed to `resolveProfile`.
 */
export interface ResolveProfileContext {
  /** User prompt — drives `shouldElevate` for `capabilities: 'auto'`. */
  prompt?: string;
  /**
   * Caller-supplied selection. `'auto'` evaluates the profile's
   * `autoCapabilities` against `prompt`; an explicit array is validated
   * against `allowedCapabilities`; `undefined` uses
   * `defaultCapabilities`.
   */
  capabilities?: CapabilitiesArg;
  /**
   * Capability ids already attached to this conversation. Always
   * folded into the resolved set so capabilities never SHRINK across
   * turns of the same conversation (monotonic-add invariant — fixes
   * the CRITICAL multi-turn cache key drift).
   */
  conversationCapabilities?: readonly CapabilityId[];
}

/** Thrown when an explicit capability id is not in the profile's allowlist. */
export class InvalidCapabilityError extends Error {
  constructor(public readonly profileId: BaseProfileId, public readonly capabilityId: string) {
    super(
      `Capability '${capabilityId}' is not allowed by profile '${profileId}'.`,
    );
    this.name = 'InvalidCapabilityError';
  }
}

/**
 * Chat model. Lives here (not imported from `./sessions`) so this module
 * stays at the bottom of the SDK-adjacent dependency graph — `sessions.ts`
 * consumes profiles, not the other way around.
 */
const CHAT_MODEL: string = process.env.COPILOT_CHAT_MODEL ?? 'claude-haiku-4.5';
const STANDARD_MODEL = 'gpt-5-mini';

const COACH_GITHUB_TOOLS = ['get_me', 'list_user_repositories'] as const;

/**
 * The full profile registry. Treat every entry as immutable — adding a
 * new chat surface means adding a new id to `BaseProfileId` and a new
 * entry here, never mutating an existing one.
 */
export const PROFILES = {
  chat: {
    id: 'chat',
    model: CHAT_MODEL,
    basePrompt: CHAT_BASE_PROMPT,
    defaultCapabilities: [],
    allowedCapabilities: PROFILE_ALLOWED_CAPABILITIES.chat,
    autoCapabilities: ['github'],
  },
  learning: {
    id: 'learning',
    model: CHAT_MODEL,
    basePrompt: LEARNING_LENS_PROMPT,
    defaultCapabilities: [],
    allowedCapabilities: PROFILE_ALLOWED_CAPABILITIES.learning,
    autoCapabilities: ['github'],
  },
  coach: {
    id: 'coach',
    model: STANDARD_MODEL,
    basePrompt: COACH_BASE_PROMPT,
    // Coach is lightweight by default. Callers pass `capabilities:
    // ['github']` (focus generation) to opt into MCP grounding; the
    // overridden tool list and coach-scoped addendum below keep the
    // model honest about which two tools it actually has.
    defaultCapabilities: [],
    allowedCapabilities: PROFILE_ALLOWED_CAPABILITIES.coach,
    autoCapabilities: [],
    capabilityDefaults: {
      github: {
        tools: COACH_GITHUB_TOOLS,
        promptAddendum: COACH_GITHUB_PROMPT_ADDENDUM,
      },
    },
  },
  // Evaluation and authoring carry no base prompt; the caller layers the
  // surface-specific instructions at session-creation time.
  evaluation: {
    id: 'evaluation',
    model: CHAT_MODEL,
    basePrompt: '',
    defaultCapabilities: [],
    allowedCapabilities: PROFILE_ALLOWED_CAPABILITIES.evaluation,
    autoCapabilities: [],
  },
  authoring: {
    id: 'authoring',
    model: CHAT_MODEL,
    basePrompt: '',
    defaultCapabilities: [],
    allowedCapabilities: PROFILE_ALLOWED_CAPABILITIES.authoring,
    autoCapabilities: [],
  },
} as const satisfies Record<BaseProfileId, ChatProfile>;

// Sanity: every BaseProfileId must have a registry entry.
type _ProfilesCoverIds = (typeof BASE_PROFILE_IDS)[number] extends keyof typeof PROFILES
  ? true
  : false;
const _ASSERT_PROFILES_COVER_IDS: _ProfilesCoverIds = true;
void _ASSERT_PROFILES_COVER_IDS;

/**
 * Resolve a profile against a runtime context. Resolution rules
 * (executed in order):
 *
 *   1. Start from `profile.defaultCapabilities`.
 *   2. If `ctx.capabilities === 'auto'`, evaluate each id in
 *      `profile.autoCapabilities` against `shouldElevate(ctx.prompt)`
 *      and add any that fire. Marks `wasAutoElevated` if anything was
 *      added.
 *   3. Else if `ctx.capabilities` is an array, validate every id against
 *      `profile.allowedCapabilities` (throws `InvalidCapabilityError`
 *      on any mismatch) and add each.
 *   4. Else (`undefined`): defaults only.
 *   5. Union with `ctx.conversationCapabilities` so capabilities never
 *      shrink across turns of a conversation.
 *   6. Apply `profile.capabilityDefaults` — merge per-id tool overrides
 *      and (when present) the addendum override onto each selection.
 *   7. Sort by id and dedupe.
 *   8. Compose `systemMessage` from `basePrompt` + each selection's
 *      effective addendum.
 *   9. Compute fingerprint over `{id, tools, addendumOverrideHash?}`.
 */
export function resolveProfile(
  profileId: BaseProfileId,
  ctx?: ResolveProfileContext,
): ResolvedProfile {
  const profile = PROFILES[profileId];
  const selected = new Map<CapabilityId, CapabilitySelection>();
  // Cast: `as const satisfies …` narrows each profile's defaultCapabilities
  // to its literal tuple type; when every profile is `[]` the inferred
  // element type collapses to `never`. The cast restores the declared
  // shape from `ChatProfile`.
  for (const selection of profile.defaultCapabilities as readonly CapabilitySelection[]) {
    selected.set(selection.id, { ...selection });
  }
  const inDefaults = new Set<CapabilityId>(selected.keys());

  const requested = ctx?.capabilities;
  const prompt = ctx?.prompt ?? '';

  let wasAutoElevated = false;
  if (requested === 'auto') {
    for (const id of profile.autoCapabilities) {
      if (selected.has(id)) continue;
      const spec = CAPABILITIES[id];
      if (spec.shouldElevate?.(prompt)) {
        selected.set(id, { id });
        wasAutoElevated = true;
      }
    }
  } else if (Array.isArray(requested)) {
    const allowed = new Set<CapabilityId>(profile.allowedCapabilities);
    for (const id of requested) {
      if (!allowed.has(id)) {
        throw new InvalidCapabilityError(profileId, id);
      }
      if (!selected.has(id)) {
        selected.set(id, { id });
      }
    }
  }

  // Carry forward any capabilities the conversation already has so the
  // cache fingerprint stays monotonic across turns even if a later
  // prompt doesn't re-trigger elevation. Filter through the profile's
  // current allowlist so a conversation that switches profiles mid-flight
  // (or a profile that tightens its allowlist) cannot smuggle in a now-
  // forbidden capability.
  const carriedIn = ctx?.conversationCapabilities;
  const carriedAllowedSet = new Set<CapabilityId>();
  if (carriedIn && carriedIn.length > 0) {
    const allowedForProfile = new Set<CapabilityId>(profile.allowedCapabilities);
    for (const id of carriedIn) {
      if (!allowedForProfile.has(id)) continue;
      carriedAllowedSet.add(id);
      if (!selected.has(id)) {
        selected.set(id, { id });
      }
    }
  }

  // Apply per-profile capability defaults (tool / addendum overrides).
  const overrides = getCapabilityDefaults(profile);
  if (overrides) {
    for (const [id, selection] of selected) {
      const override = overrides[id];
      if (!override) continue;
      const next: CapabilitySelection = { ...selection };
      if (override.tools && (next.tools === undefined || next.tools.length === 0)) {
        next.tools = override.tools;
      }
      if (override.promptAddendum !== undefined) {
        next.promptAddendumOverride = override.promptAddendum;
      }
      selected.set(id, next);
    }
  }

  // Decide what `wasAutoElevated` should be once carried-in caps are
  // considered. Only count it as auto-elevation if the addition wasn't
  // already part of defaults OR carried in.
  if (wasAutoElevated) {
    const trulyAdded = [...selected.keys()].some(
      (id) => !inDefaults.has(id) && !carriedAllowedSet.has(id),
    );
    if (!trulyAdded) {
      wasAutoElevated = false;
    }
  }

  // Byte-deterministic sort: avoids locale-dependent ordering so cache
  // keys are stable across Node runtimes / ICU configurations.
  const capabilities = [...selected.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  const requestedForTelemetry: CapabilitiesArg | 'default' =
    requested === undefined ? 'default' : requested;

  const systemMessage = composeSystemMessage(profile.basePrompt, capabilities);
  return {
    profileId,
    model: profile.model,
    systemMessage,
    capabilities,
    // Fingerprint folds in the composed system message hash so a change to
    // a profile's basePrompt (e.g. dev-time HMR or a future config-driven
    // prompt) invalidates the session pool entry. Without this, cached
    // sessions could serve a stale system prompt for the same capability set.
    capabilityFingerprint: `${capabilityFingerprintOf(capabilities)};sys=${shortHash(systemMessage)}`,
    wasAutoElevated,
    requestedCapabilities: requestedForTelemetry,
  };
}

/**
 * Compose a system message from a base prompt and each selection's
 * effective addendum (override if present, else
 * `CAPABILITIES[id].promptAddendum`). Order is deterministic
 * (capability id sort) so identical capability sets produce
 * byte-identical prompts.
 */
export function composeSystemMessage(
  basePrompt: string,
  capabilities: readonly CapabilitySelection[],
): string {
  const addenda = capabilities
    .map((selection) =>
      selection.promptAddendumOverride !== undefined
        ? selection.promptAddendumOverride
        : CAPABILITIES[selection.id].promptAddendum,
    )
    .filter((addendum) => addendum.length > 0);
  if (addenda.length === 0) {
    return basePrompt;
  }
  if (basePrompt.length === 0) {
    return addenda.join('\n\n');
  }
  return `${basePrompt}\n\n${addenda.join('\n\n')}`;
}

/**
 * Stable, order-independent fingerprint of a capability selection set.
 * Two profiles that resolve to the same set share the same fingerprint
 * and therefore share a session cache entry.
 *
 * Tool overrides AND addendum overrides are folded in: two profiles
 * sharing the github capability but with different tool allowlists or
 * different effective addenda are NOT interchangeable for cache reuse
 * (different effective tool surface or system prompt).
 */
export function capabilityFingerprintOf(
  selections: readonly CapabilitySelection[],
): string {
  if (selections.length === 0) {
    return 'caps=none';
  }
  const parts = [...selections]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((selection) => {
      const tail: string[] = [];
      if (selection.tools && selection.tools.length > 0) {
        tail.push(`tools=${[...selection.tools].sort().join(',')}`);
      }
      if (selection.promptAddendumOverride !== undefined) {
        tail.push(`addH=${shortHash(selection.promptAddendumOverride)}`);
      }
      return tail.length === 0 ? selection.id : `${selection.id}@${tail.join('|')}`;
    });
  return `caps=${parts.join('+')}`;
}

/**
 * Widen the `as const satisfies` registry entry back to the declared
 * `ChatProfile` shape so optional fields like `capabilityDefaults` are
 * visible at the call site without sprinkling `as ChatProfile` everywhere.
 */
function getCapabilityDefaults(
  profile: (typeof PROFILES)[BaseProfileId],
): ChatProfile['capabilityDefaults'] {
  return (profile as ChatProfile).capabilityDefaults;
}

/**
 * Cheap deterministic 32-bit hash, hex-encoded. We do not need
 * cryptographic strength; the fingerprint is a cache key, and the
 * upstream `userId` partition already isolates tenants.
 */
function shortHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}


