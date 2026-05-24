/**
 * Capability registry — composable building blocks for chat profiles.
 *
 * Each capability bundles everything the worker needs to attach a
 * tool-bearing domain to a Copilot session:
 *  - MCP server factory (per-request token binding) for `kind: 'mcp'`
 *  - default tool allowlist
 *  - system-prompt addendum that joins the resolved prompt when active
 *  - optional `shouldElevate(prompt)` heuristic used by profiles whose
 *    `autoCapabilities` includes this id
 *
 * `CapabilitySpec` is a discriminated union keyed on `kind`. Today only
 * MCP capabilities exist; the `native` variant is a placeholder for a
 * future in-process tool implementation. Keeping the registry shape
 * ready avoids a churn-y rename when we add the first native capability.
 *
 * Worker-internal: imports the SDK and stays behind the
 * `check-copilot-sdk-boundary` guardrail.
 */

import type { MCPServerConfig } from '@github/copilot-sdk';

import { ALL_CAPABILITY_IDS, type CapabilityId } from './capability-ids';
import { getMcpServerConfig } from './mcp';
import { needsGitHubCapability } from './profile-heuristics';

export { ALL_CAPABILITY_IDS, isCapabilityId, type CapabilityId } from './capability-ids';

/**
 * Parameters passed to an MCP capability's server factory.
 */
export interface BuildMcpServerParams {
  /** GitHub user-to-server token from the active `UserContext`. */
  token: string;
  /** Optional tool allowlist override; falls back to capability defaults. */
  tools?: readonly string[];
  /**
   * Reserved for future capabilities that need more than `{token, tools}`
   * (e.g. `knowledge`: per-user vector-store routing). Today no spec
   * reads from `ctx`; the field exists so the call shape stays stable
   * when one does.
   */
  ctx?: Record<string, unknown>;
}

/**
 * Per-request context that capabilities may use to build a prompt prefix.
 * Keep fields optional and broadly named — every capability ignores keys
 * it doesn't recognise.
 */
export interface CapabilityPromptContext {
  /** User-supplied repository handles (e.g. `owner/repo`) scoping the turn. */
  repositories?: readonly string[];
}

/** Shared metadata for every capability regardless of kind. */
export interface BaseCapabilitySpec {
  id: CapabilityId;
  /**
   * Capability-specific addendum appended to the profile base prompt when
   * this capability is active. MUST be a pure, call-independent constant
   * string — non-deterministic addenda silently break the session cache
   * fingerprint invariant (equal fingerprint must mean equal prompt).
   */
  promptAddendum: string;
  /** Pure heuristic used by profiles whose `autoCapabilities` includes this id. */
  shouldElevate?: (prompt: string) => boolean;
  /**
   * Optional per-request prompt prefix built from the active turn's
   * context (repository scope, etc.). The worker prepends the combined
   * output to the user message — it never folds into the cached
   * `systemMessage` (output is request-dependent and would break the
   * cache fingerprint invariant). Return `null` to contribute nothing.
   */
  buildContextPrompt?: (ctx: CapabilityPromptContext) => string | null;
}

/** MCP-backed capability: composes into `session.mcpServers`. */
export interface McpCapabilitySpec extends BaseCapabilitySpec {
  kind: 'mcp';
  /** Default tools exposed when no profile-specific override is given. */
  defaultTools: readonly string[];
  /** Build an SDK MCP server config bound to a per-request token. */
  buildMcpServer: (params: BuildMcpServerParams) => MCPServerConfig;
}

/**
 * Native (in-process) capability — placeholder. No spec uses this kind
 * today; the discriminator exists so adding the first native capability
 * does not require rewriting consumers of `CapabilitySpec`.
 */
export interface NativeCapabilitySpec extends BaseCapabilitySpec {
  kind: 'native';
}

export type CapabilitySpec = McpCapabilitySpec | NativeCapabilitySpec;

/** Default GitHub MCP allowlist (mirrors the previous mcp.ts behaviour). */
const GITHUB_DEFAULT_TOOLS = [
  'get_me',
  'list_user_repositories',
  'get_file_contents',
  'search_code',
  'search_users',
] as const;

const GITHUB_PROMPT_ADDENDUM = `You have access to GitHub MCP tools. \
When the user asks about repositories, use those tools to explore them — \
search code, read files, and get repo details. Never use local shell, \
filesystem, or web tools for repository questions. Always use GitHub tools \
to look up real information rather than guessing.`;

/** RFC 1123-ish `owner/repo` shape: 1-39 chars each side, GitHub-allowed set. */
const REPO_HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Cap repos to keep the per-turn context block bounded. */
const MAX_REPOS_IN_CONTEXT = 25;

/**
 * Build the per-turn GitHub repo-scope block. Emits a directive that
 * pins the model to MCP tools (no local shell, no web fallback) before
 * answering. Returns `null` when no repos were supplied or every entry
 * failed the `owner/repo` validation (don't smuggle attacker-controlled
 * strings into a privileged instruction block).
 */
function buildGitHubContextPrompt(ctx: CapabilityPromptContext): string | null {
  const repos = ctx.repositories;
  if (!repos || repos.length === 0) return null;
  const safeRepos = repos
    .filter((repo) => typeof repo === 'string' && REPO_HANDLE_RE.test(repo))
    .slice(0, MAX_REPOS_IN_CONTEXT);
  if (safeRepos.length === 0) return null;
  const repoList = safeRepos.map((repo) => `- ${repo}`).join('\n');
  return (
    `The user has selected these repositories as context.\n` +
    `You MUST use GitHub MCP tools to look up live repository information before answering.\n` +
    `Do NOT use local shell/filesystem tools or generic web tools.\n\n` +
    `Selected repositories:\n${repoList}`
  );
}

/**
 * Capability registry. Adding a new capability = one new entry here
 * plus extending the `CapabilityId` union in `./capability-ids`.
 */
export const CAPABILITIES = {
  github: {
    kind: 'mcp',
    id: 'github',
    defaultTools: GITHUB_DEFAULT_TOOLS,
    promptAddendum: GITHUB_PROMPT_ADDENDUM,
    shouldElevate: needsGitHubCapability,
    buildContextPrompt: buildGitHubContextPrompt,
    buildMcpServer: ({ token, tools }) =>
      getMcpServerConfig({
        token,
        tools: tools ? [...tools] : [...GITHUB_DEFAULT_TOOLS],
      }),
  },
} as const satisfies Record<CapabilityId, CapabilitySpec>;

/**
 * Selection of a capability with optional per-profile tool override and
 * a resolved effective addendum (filled by `resolveProfile` when the
 * profile declares an override; otherwise omitted, and consumers fall
 * back to `CAPABILITIES[id].promptAddendum`).
 */
export interface CapabilitySelection {
  id: CapabilityId;
  /**
   * Override the capability's default tools (e.g. coach uses only
   * `get_me` + `list_user_repositories` from the github capability).
   */
  tools?: readonly string[];
  /**
   * Effective addendum to use when composing the system message. Set by
   * `resolveProfile` when the profile declares a `capabilityDefaults`
   * override for this capability; otherwise undefined and consumers fall
   * back to `CAPABILITIES[id].promptAddendum`.
   *
   * Exposed on the selection (rather than threaded through a parallel
   * map) so the capability fingerprint can mix it in without an extra
   * lookup.
   */
  promptAddendumOverride?: string;
}

/**
 * Build the `mcpServers` map accepted by `client.createSession`.
 *
 * Stable keys are derived from the capability id, so SDK telemetry and
 * tool attribution remain readable (`github`, `web-search`, …). Native
 * capabilities are skipped here — by definition they have no MCP server.
 */
export function buildMcpServersForCapabilities(
  selections: readonly CapabilitySelection[],
  token: string,
): Record<string, MCPServerConfig> {
  if (selections.length === 0) {
    return {};
  }
  const servers: Record<string, MCPServerConfig> = {};
  for (const selection of selections) {
    const spec = CAPABILITIES[selection.id];
    if (spec.kind !== 'mcp') continue;
    servers[selection.id] = spec.buildMcpServer({
      token,
      tools: selection.tools ?? spec.defaultTools,
    });
  }
  return servers;
}

// Type-level sanity: the union ALL_CAPABILITY_IDS and the registry must
// describe exactly the same set of ids — neither side may grow without
// the other.
type _IdsCoverRegistry = (typeof ALL_CAPABILITY_IDS)[number] extends keyof typeof CAPABILITIES
  ? true
  : false;
type _RegistryCoveredByIds = keyof typeof CAPABILITIES extends (typeof ALL_CAPABILITY_IDS)[number]
  ? true
  : false;
const _ASSERT_IDS_COVER_REGISTRY: _IdsCoverRegistry = true;
const _ASSERT_REGISTRY_COVERED_BY_IDS: _RegistryCoveredByIds = true;
void _ASSERT_IDS_COVER_REGISTRY;
void _ASSERT_REGISTRY_COVERED_BY_IDS;

/**
 * Filter a selection set down to the ids whose capability is MCP-backed.
 * Use for `copilot.mcp.*` telemetry attributes so native capabilities
 * don't inflate MCP server counts.
 */
export function mcpCapabilityIdsOf(
  selections: readonly CapabilitySelection[],
): readonly CapabilityId[] {
  return selections
    .filter((selection) => CAPABILITIES[selection.id].kind === 'mcp')
    .map((selection) => selection.id);
}

/**
 * Build the per-turn prompt prefix contributed by the active capabilities.
 *
 * Iterates selections in id-sort order (stable across callers), invokes
 * `spec.buildContextPrompt(ctx)` on every capability that declares one,
 * and joins non-null parts with blank lines. Returns the empty string
 * when nothing applies — the caller can prepend it unconditionally.
 *
 * Worker-only: lives next to the registry so adding a capability never
 * requires touching consumers that already prepend the prefix.
 */
export function buildCapabilityContextPrompt(
  selections: readonly CapabilitySelection[],
  ctx: CapabilityPromptContext,
): string {
  if (selections.length === 0) return '';
  const sorted = [...selections].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const parts: string[] = [];
  for (const selection of sorted) {
    const part = CAPABILITIES[selection.id].buildContextPrompt?.(ctx);
    if (part) parts.push(part);
  }
  return parts.join('\n\n');
}
