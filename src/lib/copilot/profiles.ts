/**
 * Chat profile registry — the single source of truth for which model,
 * base prompt, and capability composition power each chat surface.
 *
 * Profiles are deliberately small. The heavy lifting — MCP factories,
 * tool allowlists, capability-specific prompt instructions — lives on
 * the capability spec in {@link ./capabilities}. A profile only declares:
 *
 *  - `basePrompt`: capability-neutral voice / tone instructions
 *  - `baseCapabilities`: which capabilities ship on every session
 *  - `allowElevation`: whether capabilities may auto-attach when their
 *    `shouldElevate(prompt)` heuristic fires
 *
 * `resolveProfile()` composes the final `systemMessage` by concatenating
 * the base prompt with each active capability's addendum, so any N×M
 * combination of capabilities and chat surfaces costs zero extra code.
 *
 * Adding a new chat surface = one entry here. Adding a new MCP server =
 * one entry in `./capabilities`. Neither requires touching call sites.
 *
 * Worker-internal: imports the SDK transitively via `./capabilities`.
 */

import {
  CHAT_BASE_PROMPT,
  COACH_LIGHTWEIGHT_PROMPT,
  COACH_SYSTEM_PROMPT,
  LEARNING_LENS_PROMPT,
} from './prompts';
import {
  ALL_CAPABILITY_IDS,
  CAPABILITIES,
  type CapabilityId,
  type CapabilitySelection,
} from './capabilities';

/**
 * Stable identifier for a chat profile. Each profile = one chat surface
 * (or surface variant where the static capability set differs).
 */
export type ChatProfileId =
  | 'chat'
  | 'chat-github'
  | 'learning'
  | 'learning-github'
  | 'evaluation'
  | 'coach'
  | 'coach-lightweight'
  | 'authoring';

/**
 * Static profile definition. Immutable at runtime.
 */
export interface ChatProfile {
  id: ChatProfileId;
  /** Model identifier passed to the Copilot SDK. */
  model: string;
  /**
   * Capability-neutral base prompt. Voice and tone live here; capability
   * usage instructions belong in the capability's `promptAddendum`.
   *
   * May be empty when the caller layers the entire prompt at session
   * creation time (e.g. evaluation, authoring).
   */
  basePrompt: string;
  /** Capabilities applied to every session created with this profile. */
  baseCapabilities: readonly CapabilitySelection[];
  /**
   * When true, capabilities with a `shouldElevate` heuristic may
   * auto-attach to the session at resolve time. Elevation is always
   * monotonic-add — never swaps or removes capabilities.
   */
  allowElevation: boolean;
}

/**
 * Profile resolved against a runtime context. The `capabilities` array
 * is sorted by id and deduped so the fingerprint is stable regardless
 * of input order. The `systemMessage` is the composed final string.
 */
export interface ResolvedProfile {
  profileId: ChatProfileId;
  model: string;
  /** Composed system message: profile.basePrompt + active capability addenda. */
  systemMessage: string;
  /** Final capabilities, sorted by id, deduped. */
  capabilities: readonly CapabilitySelection[];
  /** Stable fingerprint of the resolved capability set, for cache keys. */
  capabilityFingerprint: string;
  /** True when elevation added at least one capability beyond the base set. */
  elevated: boolean;
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
 * new chat surface means adding a new id to the union and a new entry
 * here, never mutating an existing one.
 */
export const PROFILES = {
  chat: {
    id: 'chat',
    model: CHAT_MODEL,
    basePrompt: CHAT_BASE_PROMPT,
    baseCapabilities: [],
    allowElevation: true,
  },
  'chat-github': {
    id: 'chat-github',
    model: CHAT_MODEL,
    basePrompt: CHAT_BASE_PROMPT,
    baseCapabilities: [{ id: 'github' }],
    allowElevation: false,
  },
  learning: {
    id: 'learning',
    model: CHAT_MODEL,
    basePrompt: LEARNING_LENS_PROMPT,
    baseCapabilities: [],
    allowElevation: true,
  },
  'learning-github': {
    id: 'learning-github',
    model: CHAT_MODEL,
    basePrompt: LEARNING_LENS_PROMPT,
    baseCapabilities: [{ id: 'github' }],
    allowElevation: false,
  },
  // Evaluation and authoring carry no base prompt; the caller layers the
  // surface-specific instructions at session-creation time.
  evaluation: {
    id: 'evaluation',
    model: CHAT_MODEL,
    basePrompt: '',
    baseCapabilities: [],
    allowElevation: false,
  },
  coach: {
    id: 'coach',
    model: STANDARD_MODEL,
    basePrompt: COACH_SYSTEM_PROMPT,
    baseCapabilities: [{ id: 'github', tools: COACH_GITHUB_TOOLS }],
    allowElevation: false,
  },
  'coach-lightweight': {
    id: 'coach-lightweight',
    model: CHAT_MODEL,
    basePrompt: COACH_LIGHTWEIGHT_PROMPT,
    baseCapabilities: [],
    allowElevation: false,
  },
  authoring: {
    id: 'authoring',
    model: CHAT_MODEL,
    basePrompt: '',
    baseCapabilities: [],
    allowElevation: false,
  },
} as const satisfies Record<ChatProfileId, ChatProfile>;

/**
 * Resolve a profile against a runtime context. The returned shape is what
 * sessions/cache keys/telemetry should consume — never the raw profile id.
 *
 * Resolution rules:
 *   1. Start with `profile.baseCapabilities`.
 *   2. If `allowElevation` is true and `ctx.prompt` is supplied, each
 *      capability whose `shouldElevate(prompt)` returns true is added
 *      (if not already present). Elevation is monotonic — never removes.
 *   3. Final set is sorted by id and deduped.
 *   4. `systemMessage` = `basePrompt` + each active capability's
 *      `promptAddendum`, joined by blank lines.
 */
export function resolveProfile(
  profileId: ChatProfileId,
  ctx?: { prompt?: string },
): ResolvedProfile {
  const profile = PROFILES[profileId];
  const selected = new Map<CapabilityId, CapabilitySelection>();
  for (const selection of profile.baseCapabilities) {
    selected.set(selection.id, selection);
  }

  let elevatedAdded = 0;
  if (profile.allowElevation && typeof ctx?.prompt === 'string') {
    for (const id of ALL_CAPABILITY_IDS) {
      if (selected.has(id)) continue;
      const spec = CAPABILITIES[id];
      if (spec.shouldElevate?.(ctx.prompt)) {
        selected.set(id, { id });
        elevatedAdded += 1;
      }
    }
  }

  const capabilities = [...selected.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  return {
    profileId,
    model: profile.model,
    systemMessage: composeSystemMessage(profile.basePrompt, capabilities),
    capabilities,
    capabilityFingerprint: capabilityFingerprintOf(capabilities),
    elevated: elevatedAdded > 0,
  };
}

/**
 * Compose a system message from a base prompt and each active
 * capability's addendum. Order is deterministic (capability id sort)
 * so identical capability sets produce byte-identical prompts.
 */
export function composeSystemMessage(
  basePrompt: string,
  capabilities: readonly CapabilitySelection[],
): string {
  const addenda = capabilities
    .map((selection) => CAPABILITIES[selection.id].promptAddendum)
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
 * Tool overrides are folded in: two profiles sharing the github capability
 * but with different tool allowlists are NOT interchangeable for cache
 * reuse (different effective tool surface).
 */
export function capabilityFingerprintOf(
  selections: readonly CapabilitySelection[],
): string {
  if (selections.length === 0) {
    return 'caps=none';
  }
  const parts = [...selections]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((selection) => {
      if (!selection.tools || selection.tools.length === 0) {
        return selection.id;
      }
      const tools = [...selection.tools].sort().join(',');
      return `${selection.id}@${tools}`;
    });
  return `caps=${parts.join('+')}`;
}
