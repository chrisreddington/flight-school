/** Parse the optional MCP tool allowlist from env using one shared rule. */
export function getCopilotGithubMcpTools(): string[] {
  return process.env.COPILOT_GITHUB_MCP_TOOLS
    ?.split(',')
    .map((tool) => tool.trim())
    .filter(Boolean) ?? [];
}
