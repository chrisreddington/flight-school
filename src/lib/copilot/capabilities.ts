/**
 * Capability registry — composable building blocks for chat profiles.
 *
 * Each capability bundles everything we need to attach an MCP-backed
 * domain to a session:
 *  - MCP server factory (per-request token binding)
 *  - default tool allowlist
 *  - system-prompt addendum that joins the resolved prompt when active
 *  - optional `shouldElevate(prompt)` heuristic used by profiles that
 *    allow auto-elevation
 *
 * Adding a new MCP server = one new row here. Profiles compose
 * capabilities; the resolved profile concatenates the base prompt with
 * each active capability's addendum, so any N×M combination of
 * capabilities and chat surfaces costs zero extra code.
 *
 * Worker-internal: imports the SDK and stays behind the
 * `check-copilot-sdk-boundary` guardrail.
 */

import type { MCPServerConfig } from '@github/copilot-sdk';

import { getMcpServerConfig } from './mcp';
import { needsGitHubCapability } from './profile-heuristics';

/**
 * Stable identifier for a capability. Extend the union as new MCP
 * servers are added (e.g. `'web-search'`, `'knowledge'`, `'filesystem'`).
 */
export type CapabilityId = 'github';

/**
 * Parameters passed to a capability's MCP factory.
 */
export interface BuildMcpServerParams {
  /** GitHub user-to-server token from the active `UserContext`. */
  token: string;
  /** Optional tool allowlist override; falls back to capability defaults. */
  tools?: readonly string[];
}

/**
 * Descriptor for a single capability.
 */
export interface CapabilitySpec {
  id: CapabilityId;
  /** Default tools exposed when no profile-specific override is given. */
  defaultTools: readonly string[];
  /**
   * System-prompt addendum appended to the profile's base prompt when this
   * capability is active. Keep these tightly scoped to *capability usage*
   * instructions — voice / tone belongs in the profile base prompt.
   */
  promptAddendum: string;
  /** Build an SDK MCP server config bound to a per-request token. */
  buildMcpServer: (params: BuildMcpServerParams) => MCPServerConfig;
  /**
   * Pure heuristic that, when true, signals this capability would be
   * useful for the supplied prompt. Profiles with `allowElevation: true`
   * use this to auto-attach the capability at resolve time.
   *
   * Omit when a capability should never be auto-elevated (e.g. expensive
   * MCP servers, capabilities with side-effects, or capabilities that
   * should only be active when the user explicitly opts in).
   */
  shouldElevate?: (prompt: string) => boolean;
}

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

/**
 * Capability registry. Adding a new MCP server = one new entry here
 * (plus extending the `CapabilityId` union above).
 */
export const CAPABILITIES = {
  github: {
    id: 'github',
    defaultTools: GITHUB_DEFAULT_TOOLS,
    promptAddendum: GITHUB_PROMPT_ADDENDUM,
    shouldElevate: needsGitHubCapability,
    buildMcpServer: ({ token, tools }) =>
      getMcpServerConfig({
        token,
        tools: tools ? [...tools] : [...GITHUB_DEFAULT_TOOLS],
      }),
  },
} as const satisfies Record<CapabilityId, CapabilitySpec>;

/** All capability ids in declaration order. */
export const ALL_CAPABILITY_IDS = Object.keys(CAPABILITIES) as CapabilityId[];

/**
 * Selection of a capability with optional per-profile tool override.
 */
export interface CapabilitySelection {
  id: CapabilityId;
  /**
   * Override the capability's default tools (e.g. coach uses only
   * `get_me` + `list_user_repositories` from the github capability).
   */
  tools?: readonly string[];
}

/**
 * Build the `mcpServers` map accepted by `client.createSession`.
 *
 * Stable keys are derived from the capability id, so SDK telemetry
 * and tool attribution remain readable (`github`, `web-search`, …).
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
    servers[selection.id] = spec.buildMcpServer({
      token,
      tools: selection.tools ?? spec.defaultTools,
    });
  }
  return servers;
}
