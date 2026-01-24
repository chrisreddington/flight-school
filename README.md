# Flight School

**Train with your Copilot. Reach new heights.**

Flight School is a reference implementation demonstrating how to build AI-powered developer tools using the [GitHub Copilot SDK](https://github.com/github/copilot-sdk). It's a learning platform where developers practice coding challenges, receive real-time AI evaluation, and get personalized guidance all powered by GitHub Copilot.

## Vision

AI can be a learning partner, not just a tool that helps generate solutions. Flight School explores how the Copilot SDK can create educational experiences that adapt to each developer's existing experience, their skill level, provide constructive feedback, and guide learners toward understanding.

## What It Does

Flight School gathers data from your GitHub profile and repositories through the Octokit package and uses the Copilot SDK to tailor a personalized learning experience:

- **Daily Focus** — A challenge, goal, and learning topics tailored to your skill gaps
- **Interactive Challenges** — Practice in a sandbox with real-time AI evaluation
- **Progressive Hints** — Get guidance without spoilers when you're stuck
- **Learning Conversations** — Chat with an AI coach about your code and repositories

```mermaid
flowchart LR
    subgraph Flight School
        A[GitHub Profile<br>& Repos] --> B[Copilot SDK<br>+ MCP Tools]
        B --> C[Your Learning<br>Dashboard]
        B --> D[AI-Powered:<br>• Evaluation<br>• Hints<br>• Coaching<br>• Focus Gen]
    end
```

## How It Uses the Copilot SDK

Flight School demonstrates several Copilot SDK patterns that you can adapt for your own applications:

### Session Management

The SDK's `CopilotClient` manages authenticated sessions. To optimize performance, Flight School creates different session types for different use cases:

- **Lightweight sessions** for fast responses (hints, quick chats)
- **MCP-enabled sessions** when GitHub exploration is needed (repo search, file contents, etc.)
- **Conversation caching** for multi-turn chats that maintain context

### MCP Tool Integration

Flight School connects to [GitHub's Remote MCP Server](https://github.com/github/github-mcp-server), giving the AI access to GitHub tools like `get_me`, `list_user_repositories`, and `search_code`. This enables context-aware responses based on your actual repositories in the chat experience.

### Streaming Responses

The chat and challenge evaluation experiences stream feedback in real-time using the SDK's streaming mode, showing results as they're generated rather than waiting for the full response.

## Using Flight School

### Prerequisites

- Node.js 22+
- GitHub CLI authenticated (`gh auth login`)
- GitHub Copilot access

### Quick Start

```bash
# Clone and install
git clone https://github.com/chrisreddington/flight-school.git
cd flight-school
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with your GitHub account.

### Environment Configuration

Flight School automatically uses your GitHub CLI authentication. For explicit configuration:

```bash
# Optional: Create .env.local
GITHUB_TOKEN=your_github_pat_here
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Create production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |

## Contributing

We welcome contributions! Flight School is both a learning platform and a reference implementation. Improving either helps the community.

### Getting Started

The fastest way to contribute is with **GitHub Codespaces**:

1. Click **Code** → **Codespaces** → **Create codespace on main**
2. Wait for the dev container to configure (installs dependencies automatically)
3. Run `npm run dev` and start coding

For local development, see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed setup instructions.

### Ways to Contribute

- **Report bugs** — Open an issue with reproduction steps
- **Suggest features** — Describe your use case in an issue
- **Improve documentation** — Help others understand the SDK patterns
- **Submit code** — Fix bugs or implement features

### Development Workflow

1. Fork the repository
2. Create a feature branch (`feature/your-feature-name`)
3. Make your changes with clear commits
4. Run tests (`npm test`) and linting (`npm run lint`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, testing practices, and code review process.

## Local Data Storage

Flight School stores your data **outside the repository** in your user data directory to prevent accidental commits:

| Platform | Location |
|----------|----------|
| **Linux/macOS** | `~/.local/share/flight-school/` |
| **Windows** | `%LOCALAPPDATA%\flight-school\` |
| **Custom** | Set `FLIGHT_SCHOOL_DATA_DIR` environment variable |

### What's Stored

| File | Contents |
|------|----------|
| `profile-cache.json` | Cached GitHub profile (username, avatar, bio, repos) |
| `focus-storage.json` | Daily challenges, goals, learning topics, completion states |
| `habits.json` | Your custom learning habits and progress tracking |
| `threads.json` | Chat conversation history with the AI coach |
| `workspaces/{id}/` | Challenge solution code and metadata |

### Storage Structure

```
~/.local/share/flight-school/    # or %LOCALAPPDATA%\flight-school\ on Windows
├── profile-cache.json           # GitHub profile cache
├── focus-storage.json           # Daily focus content + state
├── habits.json                  # Learning habits
├── threads.json                 # Chat history
└── workspaces/                  # Challenge workspaces
    └── {challengeId}/
        ├── _workspace.json      # Metadata
        └── solution.ts          # Your code files
```

- **Chat history** may contain sensitive info based on whatever you discuss with the AI coach.
- **Workspace files** contain your actual solution code for challenges.

### Precautions

1. **Back up before clearing** — Delete the data folder to reset all local state

## Tech Stack

- **Framework**: [Next.js with App Router](https://nextjs.org/docs/app)
- **UI**: [GitHub Primer React Components](https://primer.style/react/)
- **AI**: [GitHub Copilot SDK](https://github.com/github/copilot-sdk) with MCP tool integration
- **Data**: [Octokit](https://github.com/octokit/octokit.js) for GitHub API access
- **Storage**: Local JSON files in user data directory (see above)
- **Testing**: [Vitest](https://vitest.dev/)

## License

This project is licensed under the MIT License—see the [LICENSE](LICENSE) file for details.
