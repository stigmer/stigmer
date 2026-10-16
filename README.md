<div align="center">
  <a href="https://stigmer.ai">
    <img src="docs/banner_dark.png" alt="Stigmer — Open-source AI agent platform" width="100%" height="auto" />
  </a>
</div>

<br/>

# Stigmer

**An open-source AI agent platform.**

Define agents in YAML, deploy with one command, call from any app via API.
Run it yourself on a laptop, one server or Kubernetes, or use Stigmer Cloud.
Agents run on your own model provider key.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
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
# Shell script (macOS/Linux) — no prerequisites, bundles its own Node.js runtime
curl -fsSL https://stigmer.ai/install.sh | sh

# npm (requires Node.js >= 22.13)
npm install -g @stigmer/cli

# From source
git clone https://github.com/stigmer/stigmer.git
cd stigmer && make setup && npm install && make local
```

</details>

## What is Stigmer?

Stigmer turns domain knowledge and tools into AI agents you can call from any application.

- **Skills** — Teach agents your domain. Upload versioned knowledge and the agent answers with expertise instead of generic responses.
- **Plugins** — Give agents tools. Install the Claude Code, Cursor or Codex plugins you already have: a plugin carries skills, hooks, subagents and the [MCP](https://modelcontextprotocol.io) servers that connect agents to your systems. Agents discover the tools and Stigmer handles execution sandboxing.
- **Approval flows** — Set rules for human oversight. Define which actions need approval before the agent proceeds. Runs are durable — they wait without losing state.

Every capability is exposed via gRPC with public protobuf contracts. Generate type-safe clients in Go, Python, Java, TypeScript, or Rust.

## Core Concepts

### Agents

An Agent has instructions, optional plugins for skills and tools, optional MCP servers of its own (`mcp_servers`), and optional model configuration.

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
  plugins:
    - kind: plugin
      slug: github
```

```bash
stigmer install github          # the plugin that carries GitHub's MCP server
stigmer apply -f agent.yaml
stigmer run support-bot "What's the status of issue #42?"
```

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
```

### Plugins

A plugin is one package of skills, MCP servers, hooks and subagents, in the format Claude Code, Cursor and Codex already use. Installing it stores the plugin alone; an agent or a chat that lists it under `plugins` gets all of it, each part named after the plugin (`<plugin>:<skill>`). See [Plugins](https://stigmer.ai/docs/concepts/plugins).

```bash
stigmer install github                # from the marketplace
stigmer push plugin ./my-plugin       # from a folder
stigmer mcp add orders https://orders.example.com/mcp   # one MCP server, as a plugin of its own
```

Stigmer uses the [Model Context Protocol](https://modelcontextprotocol.io) to give agents tool access. An MCP server reaches an agent two ways: in a plugin it lists, shared by every agent and chat that lists it, or written in the agent itself under `mcp_servers`, reached over HTTP and added only by an organization's admins. Remote (HTTP) MCP servers work everywhere, including the marketplace catalog and cloud-hosted sessions. STDIO-based servers — npm packages (npx), Python packages (uvx), Go modules (go run) — run on local runners only, where the machine executing the subprocess is your own.

### Stigmer's own MCP server

Stigmer also ships its own MCP server that exposes platform resources to AI-powered IDEs:

```bash
stigmer mcp-server
```

See [mcp-server/README.md](mcp-server/README.md) for IDE configuration (Cursor, Claude Desktop, VS Code, Windsurf).

## SDKs

| SDK | Install | Reference |
|-----|---------|-----------|
| **Go** | `go get go.stigmer.ai/sdk` | [Reference](https://stigmer.ai/docs/sdk/go) |
| **TypeScript** | `npm install @stigmer/client` | [Reference](https://stigmer.ai/docs/sdk/typescript) |
| **Python** | `pip install stigmer-sdk` | [Reference](https://stigmer.ai/docs/sdk/python) |
| **Java** | Maven: `ai.stigmer:stigmer-sdk` | [Reference](https://stigmer.ai/docs/sdk/java) |
| **React** | `npm install @stigmer/react-sdk` | [Reference](https://stigmer.ai/docs/sdk/react) |
| **Ink** | `npm install @stigmer/ink-ui` | [Reference](https://stigmer.ai/docs/sdk/ink) |

The Go, TypeScript, Python, and Java SDKs provide typed API clients for all platform resources. The React SDK renders agent UIs — session composers, message threads, and approval views. The Ink SDK brings the same components to the terminal.

### Embed in your app

The React SDK ships the same chat surface the Stigmer Console uses — as drop-in components. One provider and two components put your agent in front of your users:

```tsx
<StigmerProvider client={client}>
  {sessionId ? (
    <SessionViewer sessionId={sessionId} org="my-org" audience="endUser" />
  ) : (
    <NewSessionViewer
      org="my-org"
      audience="endUser"
      initialAgentRef={{ org: "my-org", slug: "support-agent" }}
      onSessionCreated={setSessionId}
    />
  )}
</StigmerProvider>
```

Every component is themeable with design tokens, and the hooks underneath are exported for fully custom UIs. Follow the [Add agent chat to your app](https://stigmer.ai/docs/getting-started/embed-agent) tutorial for the complete walkthrough.

## Open source, Enterprise and Cloud

| | Stigmer open source | Stigmer Enterprise | Stigmer Cloud |
|---|---|---|---|
| **Start with** | `stigmer server`, Docker Compose or the Helm chart | The Helm chart with a license key Secret | `stigmer config backend set cloud` |
| **Storage** | SQLite (`~/.stigmer/stigmer.db`) or your Postgres | Your Postgres | Managed |
| **Users** | One organization, with sign-in, roles and service accounts | Many organizations, teams, invitations and federation | The same, hosted |
| **LLM** | Your key, held by the runner (Anthropic, or Cursor) | Your key, held by the runner (Anthropic, or Cursor) | Your organization's keys (Anthropic, OpenAI, compatible endpoints, Cursor) |
| **Best for** | Development, personal projects, one team, full data ownership | Companies that must keep many teams on their own infrastructure | Teams that want a managed platform |

Stigmer runs no model of its own: every edition runs your agents on your own provider key. Stigmer Enterprise is licensed annually; [compare the editions](https://stigmer.ai/docs/guides/self-hosting/cloud-vs-self-hosted) or see [pricing](https://stigmer.ai/pricing).

Resource definitions are portable across all three. The CLI talks to the same gRPC service interfaces regardless of backend.

## Brand assets

The [brand folder](brand/README.md) contains the current logo and ready-to-upload
profile images. Use `brand/avatar.png` for GitHub and other profile uploads.

## Documentation

- [Getting Started (Cloud)](https://stigmer.ai/docs/getting-started/quickstart) — Create your first agent in 5 minutes
- [Getting Started (Local)](https://stigmer.ai/docs/getting-started/local) — Run agents on your machine
- [Try it in one container](https://stigmer.ai/docs/guides/self-hosting/all-in-one) — `docker run ghcr.io/stigmer/stigmer` for evaluation (not for production)
- [Self-hosting](https://stigmer.ai/docs/guides/self-hosting/docker-compose) — Run the full stack on your own machine with Docker Compose
- [Kubernetes](https://stigmer.ai/docs/guides/self-hosting/kubernetes) — The same stack on a cluster with the Helm chart (`oci://ghcr.io/stigmer/charts/stigmer`)
- [CLI Reference](https://stigmer.ai/docs/cli) — Commands, flags, and examples
- [SDK Reference](https://stigmer.ai/docs/sdk) — Go, TypeScript, Python, Java, React, and Ink
- [Core Concepts](https://stigmer.ai/docs/concepts/what-is-stigmer) — Agents, Skills, Sessions, and how they fit together
- [Examples](examples/) — Sample agents and skills

## Development

### Prerequisites

- Node.js 22+ (22.13 or newer; the server needs `node:sqlite` with FTS5)
- Go 1.25+ (for the Go SDK, codegen tools, and integration harnesses)
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

Stigmer is open source under the [Apache License 2.0](LICENSE), with one
exception: the [`ee/`](ee/) directory, Stigmer Enterprise, is under the
[Stigmer Enterprise License](ee/LICENSE). The Enterprise code is public and
readable; running it in production needs a license key. Without a key, the
Enterprise server behaves exactly as the open-source server and runs no
Enterprise code. Everything outside `ee/` stays Apache 2.0 and never depends
on it.

The licenses grant rights in the code, not in the Stigmer names or logo; see
[TRADEMARKS.md](TRADEMARKS.md).
