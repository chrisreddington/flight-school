/**
 * Build an MCP-focused repository context prefix for chat prompts.
 *
 * This is used by chat jobs when users explicitly scope their question
 * to selected repositories and enable GitHub tools.
 */
export function buildRepositoryContextPrompt(
  prompt: string,
  repos: string[] | undefined,
  hasGitHubCapability: boolean,
): string {
  if (!hasGitHubCapability || !repos || repos.length === 0) {
    return prompt;
  }

  const repoList = repos.map((repo) => `- ${repo}`).join('\n');
  const repoContext =
    `The user has selected these repositories as context.\n` +
    `You MUST use GitHub MCP tools to look up live repository information before answering.\n` +
    `Do NOT use local shell/filesystem tools or generic web tools.\n\n` +
    `Selected repositories:\n${repoList}\n\n` +
    'User question: ';
  return repoContext + prompt;
}

