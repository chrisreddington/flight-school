# GitHub Copilot SDK Skill

## Overview

The `@github/copilot-sdk` package provides programmatic access to GitHub Copilot's agentic workflows. It exposes the same production-tested agent runtime behind Copilot CLI with support for custom tools, **MCP servers**, streaming responses, and custom agents.

**Repository**: https://github.com/github/copilot-sdk  
**NPM Package**: `@github/copilot-sdk`  
**Current Version**: 0.1.20+

## Architecture

```
Your Application
     ↓
SDK Client (CopilotClient)
     ↓ JSON-RPC
Copilot CLI (server mode)
     ↓
MCP Servers (optional)
```

## How This Project Uses the SDK

**Server-side** (`lib/copilotService.ts`):

```typescript
import { CopilotClient, CopilotSession } from '@github/copilot-sdk';

// Singleton service pattern
const client = new CopilotClient({ logLevel: 'warning', useLoggedInUser: true });
await client.start();

const session = await client.createSession({
  model: 'gpt-5-mini',
  systemMessage: { mode: 'append', content: buildSystemMessage() },
});

// Synchronous chat
const response = await session.sendAndWait({ prompt });

// Streaming chat (event-based)
session.on('assistant.message', (event) => { /* chunk */ });
session.on('session.idle', () => { /* done */ });
session.on('session.error', (event) => { /* error */ });
await session.send({ prompt });
```

**Key patterns in this codebase**:
- System prompt built dynamically from tool definitions (`lib/copilot/system-prompt.ts`)
- Session auto-recovery on `"Session not found"` errors
- Tool definitions in `lib/tools/` generate LLM documentation automatically
- Actions extracted from LLM JSON responses via `lib/copilot/actionParser.ts`

## Custom Tools via `defineTool`

```typescript
import { defineTool } from '@github/copilot-sdk';

const myTool = defineTool('tool_name', {
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
  handler: async (args: { city: string }) => {
    return { result: `Data for ${args.city}` };
  },
});

const session = await client.createSession({
  model: 'gpt-4.1',
  tools: [myTool],
});
```

## MCP Server Integration

Built-in support via `mcpServers` config — no separate MCP client needed.

| Type | Description | Use Case |
|------|-------------|----------|
| **local/stdio** | Subprocess via stdin/stdout | Local tools, npm packages |
| **http/sse** | Remote HTTP server | Cloud services, shared tools |

```typescript
const session = await client.createSession({
  mcpServers: {
    "github": {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      tools: ["*"],
    },
    "filesystem": {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      tools: ["*"],
    },
  },
});
```

## Custom Agents

Define specialized AI personas with focused prompts. This project uses `customAgents` to create analysis specialists (SWOT, Risk, Blockers, etc.):

```typescript
import { toCustomAgentConfigs } from './copilot/agents';

const session = await client.createSession({
  model: 'gpt-5-mini',
  systemMessage: { mode: 'append', content: buildSystemMessage() },
  customAgents: toCustomAgentConfigs(), // 8 analysis agents
});
```

Agent definitions live in `lib/copilot/agents.ts`. Each has:
- `name` — SDK identifier (e.g. `canvas-swot-analyst`)
- `displayName` — Human label
- `prompt` — Specialized workflow instructions
- `id` — App-level key matching quick start template IDs

## Event Subscription

```typescript
// Subscribe to specific event type
const unsub = session.on('assistant.message_delta', (event) => {
  process.stdout.write(event.data.deltaContent);
});

// Unsubscribe when done
unsub();
```

| Event | When |
|-------|------|
| `assistant.message` | Full message received |
| `assistant.message_delta` | Streaming chunk |
| `session.idle` | Response complete |
| `session.error` | Error occurred |

## Resources

- **GitHub Repo**: https://github.com/github/copilot-sdk
- **Getting Started**: https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md
- **MCP Documentation**: https://github.com/github/copilot-sdk/blob/main/docs/mcp
- **Cookbook**: https://github.com/github/awesome-copilot/blob/main/cookbook/copilot-sdk
