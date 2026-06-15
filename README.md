<div align="center">
  <a href="https://stigmer.ai">
    <img src="docs/banner_dark.png" alt="Stigmer — Open-source AI agent platform" width="100%" height="auto" />
  </a>
</div>

<br/>

# Stigmer

**An open-source AI agent platform.**

Define agents in YAML, deploy with one command, call from any app via API.
Run locally with SQLite or connect to Stigmer Cloud for production.
Bring your own LLM — Anthropic, OpenAI, or Ollama.

[![License](https://img.shields.io/github/license/stigmer/stigmer)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-community-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/EtANnfsJ8B)
[![GitHub stars](https://img.shields.io/github/stars/stigmer/stigmer?style=flat)](https://github.com/stigmer/stigmer/stargazers)

## Quick Start

```bash
# Install
brew install stigmer/tap/stigmer

# Start the server (interactive LLM setup on first run)
stigmer server

# Deploy an agent from YAML
stigmer apply -f agent.yaml

# Run it
stigmer run support-bot "How do I reset my password?"
```

<details>
<summary>Other install methods</summary>

```bash
# Shell script (macOS/Linux)
curl -fsSL https://raw.githubusercontent.com/stigmer/stigmer/main/scripts/install.sh | bash

# From source
git clone https://github.com/stigmer/stigmer.git
cd stigmer && make setup && npm install && make local
```

</details>

## What is Stigmer?

Stigmer turns domain knowledge and tools into AI agents you can call from any application.

- **Skills** — Teach agents your domain. Upload versioned knowledge and the agent answers with expertise instead of generic responses.
- **MCP Servers** — Give agents tools. Connect to your systems via the [Model Context Protocol](https://modelcontextprotocol.io). Agents discover available tools and Stigmer handles execution sandboxing.
- **Approval flows** — Set rules for human oversight. Define which actions need approval before the agent proceeds. Executions are durable — they wait without losing state.

Every capability is exposed via gRPC with public protobuf contracts. Generate type-safe clients in Go, Python, Java, TypeScript, or Rust.

## Core Concepts

### Agents

An Agent has instructions, optional MCP servers for tool access, and optional model configuration.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: support-bot
spec:
  instructions: |
    You are a helpful customer support agent.
    Answer questions politely and accurately.
    Check GitHub issues for known problems.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
    - mcp_server_ref:
        kind: mcp_server
        slug: filesystem
```

```bash
stigmer apply -f agent.yaml
stigmer run support-bot "What's the status of issue #42?"
```

### Workflows

Multi-step automations that chain HTTP calls, agent calls, variable assignments, conditionals, and loops.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: hello-world
spec:
  tasks:
    - name: set-greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello, World!"
```

Tasks support `set_vars`, `http_call`, `agent_call`, `wait`, and control flow via `flow.then`. See [examples/workflows/](examples/workflows/) for patterns including multi-agent orchestration and conditional branching.

### Skills

Versioned knowledge artifacts that agents use for domain expertise. A Skill is a directory with a `SKILL.md` file containing YAML frontmatter:

```
my-skill/
  SKILL.md          # Required: interface definition with YAML frontmatter
  tool.sh           # Optional: tool implementation
  README.md         # Optional: documentation
```

```bash
stigmer push                          # push skill from current directory
stigmer draft skill --name my-skill   # scaffold a new skill
```

### MCP Servers

Stigmer uses the [Model Context Protocol](https://modelcontextprotocol.io) to give agents tool access. Agents can use any STDIO-based MCP server — npm packages (npx), Python packages (uvx), Go modules (go run), or Docker images.

Stigmer also ships its own MCP server that exposes platform resources to AI-powered IDEs:

```bash
stigmer mcp-server
```

See [mcp-server/README.md](mcp-server/README.md) for IDE configuration (Cursor, Claude Desktop, VS Code, Windsurf).

## SDKs

| SDK | Install | Reference |
|-----|---------|-----------|
| **Go** | `go get github.com/stigmer/stigmer/sdk/go` | [Reference](https://stigmer.ai/docs/sdk/go) |
| **TypeScript** | `npm install @stigmer/sdk` | [Reference](https://stigmer.ai/docs/sdk/typescript) |
| **Python** | `pip install stigmer` | [Reference](https://stigmer.ai/docs/sdk/python) |
| **Java** | Maven: `ai.stigmer:stigmer-java` | [Reference](https://stigmer.ai/docs/sdk/java) |
| **React** | `npm install @stigmer/react` | [Reference](https://stigmer.ai/docs/sdk/react) |
| **Ink** | `npm install @stigmer/ink` | [Reference](https://stigmer.ai/docs/sdk/ink) |

The Go, TypeScript, Python, and Java SDKs provide typed API clients for all platform resources. The React SDK renders agent UIs — session composers, message threads, and approval views. The Ink SDK brings the same components to the terminal.

## Local vs Cloud

| | Local Mode (Open Source) | Cloud Mode (Stigmer Cloud) |
|---|---|---|
| **Start with** | `stigmer server` | `stigmer config backend set cloud` |
| **Storage** | SQLite (`~/.stigmer/stigmer.db`) | Distributed (managed) |
| **Users** | Single implicit user | Organizations, teams, IAM |
| **LLM** | Anthropic, OpenAI, or Ollama (your choice) | Configurable |
| **Best for** | Development, personal projects, air-gapped environments | Team collaboration, production, governance |

Resource definitions are portable across both modes. The CLI talks to the same gRPC service interfaces regardless of backend.

## Documentation

- [Getting Started (Cloud)](https://stigmer.ai/docs/getting-started/quickstart) — Create your first agent in 5 minutes
- [Getting Started (Local)](https://stigmer.ai/docs/getting-started/local) — Run agents on your machine
- [CLI Reference](https://stigmer.ai/docs/cli) — Commands, flags, and examples
- [SDK Reference](https://stigmer.ai/docs/sdk) — Go, TypeScript, Python, Java, React, and Ink
- [Core Concepts](https://stigmer.ai/docs/concepts/what-is-stigmer) — Agents, Skills, Workflows, and how they fit together
- [Examples](examples/) — Sample agents, workflows, and skills

## Development

### Prerequisites

- Go 1.25+
- Python 3.11+ with [Poetry](https://python-poetry.org/)
- Node.js 22+
- Git, Make

### Building from Source

```bash
git clone https://github.com/stigmer/stigmer.git
cd stigmer

make setup     # Install Go and Python dependencies
npm install    # Install Node.js dependencies
make local     # Build the local stigmer-server (the CLI runs from @stigmer/cli)
make test      # Run tests
```

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

- [GitHub Issues](https://github.com/stigmer/stigmer/issues) — Bug reports and feature requests
- [Discord](https://discord.com/invite/EtANnfsJ8B) — Community chat

## License

Apache License 2.0. See [LICENSE](LICENSE).
