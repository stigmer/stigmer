# Stigmer

**Build AI agents and workflows with zero infrastructure.**

Stigmer is an open-source agentic automation platform. Run it locally with SQLite for development, or connect to Stigmer Cloud for production. Bring your own LLM — Anthropic, OpenAI, or Ollama. Same CLI, same SDK, same resource definitions — your choice of backend.

## Quick Start

### 1. Install

```bash
# Homebrew (macOS/Linux)
brew install stigmer/tap/stigmer

# Or from source
git clone https://github.com/stigmer/stigmer.git
cd stigmer && make release-local

# Or via shell script
curl -fsSL https://raw.githubusercontent.com/stigmer/stigmer/main/scripts/install.sh | bash
```

This installs a single self-contained `stigmer` binary that embeds all required components.

### 2. Configure LLM Provider

Stigmer agents need an LLM to generate responses. You can pre-configure one before starting the server, or let the interactive setup guide you on first run.

**Option A: Anthropic (recommended for best quality)**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Option B: OpenAI**

```bash
export OPENAI_API_KEY=sk-...
```

**Option C: Ollama (free, local, offline)**

```bash
brew install ollama
ollama serve
ollama pull qwen2.5-coder:7b
```

If you skip this step, `stigmer server` will prompt you to choose a provider interactively.

### 3. Start the Server

```bash
stigmer server
```

On first run, this prompts you to choose an LLM provider, auto-downloads Temporal, starts all services, and is ready on `localhost:7234`.

### 4. Deploy and Run an Agent

```bash
# Deploy from a YAML file
stigmer apply -f agent.yaml

# Execute
stigmer run support-bot "How do I reset my password?"
```

### Managing the Server

```bash
stigmer server status   # check if running
stigmer server stop     # stop all services
stigmer server          # start again
stigmer server setup    # reconfigure LLM provider
stigmer server reset    # stop and remove all data (keeps config)
```

## Core Concepts

### Agents

An agent has instructions, optional MCP servers for tool access, and optional model configuration.

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
  mcpServers:
    - github
    - filesystem
```

```bash
stigmer apply -f agent.yaml
stigmer run support-bot "What's the status of issue #42?"
```

### Workflows

Multi-step automations that chain HTTP calls, agent calls, variable assignments, conditionals, and loops. Workflows follow the [CNCF Serverless Workflow](https://serverlessworkflow.io/) DSL.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: hello-world
spec:
  description: A minimal workflow
  document:
    dsl: "1.0.0"
    namespace: examples
    name: hello-world
    version: "1.0.0"
  tasks:
    - name: set-greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello, World!"
          timestamp: "${now()}"
      export:
        as: "${.}"
```

Tasks support `kind: set_vars`, `kind: http_call`, `kind: agent_call`, `kind: wait`, and control flow via `flow.then`. See [examples/workflows/](examples/workflows/) for more complex patterns including multi-agent orchestration and conditional branching.

```bash
stigmer apply -f workflow.yaml
stigmer run hello-world
```

### Skills

Versioned knowledge artifacts (instructions + reference material) that agents can use. A skill is a directory with a `SKILL.md` file containing YAML frontmatter:

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

## Go SDK

Define agents and workflows programmatically using a Pulumi-aligned struct args API.

```go
package main

import (
    "fmt"
    "log"

    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        a, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
            Instructions: "Review code for best practices and security issues",
        })
        if err != nil {
            return err
        }
        fmt.Printf("Created agent: %s\n", a.Name)
        return nil
    })
    if err != nil {
        log.Fatal(err)
    }
}
```

See [sdk/go/README.md](sdk/go/README.md) for the full SDK reference, workflow builders, and more examples in [sdk/go/examples/](sdk/go/examples/).

## CLI Reference

| Command | Description |
|---------|-------------|
| `stigmer run <name> [prompt]` | Execute an agent or workflow |
| `stigmer apply -f <file>` | Create or update resources from YAML |
| `stigmer get <kind> <name>` | Get a resource |
| `stigmer list <kind>` | List resources |
| `stigmer delete <kind> <name>` | Delete a resource |
| `stigmer search <query>` | Full-text search across resources |
| `stigmer draft <kind>` | Scaffold a new resource |
| `stigmer push` | Push a skill artifact |
| `stigmer download <kind> <name>` | Download a resource artifact |
| `stigmer validate -f <file>` | Validate a resource definition |
| `stigmer server` | Start/stop/status/setup/reset for local server |
| `stigmer mcp-server` | Start the Stigmer MCP server |
| `stigmer backend` | Switch between local and cloud backends |
| `stigmer config` | Manage CLI configuration |

## Local vs Cloud

| | Local Mode (Open Source) | Cloud Mode (Stigmer Cloud) |
|---|---|---|
| **Start with** | `stigmer server` | `stigmer backend set cloud` |
| **Storage** | SQLite (`~/.stigmer/stigmer.db`) | Distributed (managed) |
| **Orchestration** | Temporal (auto-managed) | Temporal (managed) |
| **Users** | Single implicit user | Organizations, teams, IAM |
| **LLM** | Anthropic, OpenAI, or Ollama (user's choice) | Configurable |
| **Best for** | Development, personal projects, air-gapped environments | Team collaboration, production, governance |

Resource definitions are portable across both modes. The CLI talks to the same gRPC service interfaces regardless of backend.

### LLM Configuration

On first run, `stigmer server` guides you through an interactive setup to choose your LLM provider. The chosen provider and API key are saved to `~/.stigmer/config.yaml`.

**Supported providers:**

| Provider | Model (default) | Requires |
|----------|----------------|----------|
| Anthropic | `claude-sonnet-4.5` | `ANTHROPIC_API_KEY` env var or API key in config |
| OpenAI | `gpt-4` | `OPENAI_API_KEY` env var or API key in config |
| Ollama | `qwen2.5-coder:7b` | Ollama installed and running locally |

**Config file example** (`~/.stigmer/config.yaml`):

```yaml
backend:
  local:
    llm:
      provider: anthropic
      model: claude-sonnet-4.5
```

**Environment variables** (take precedence over config file):

```bash
export STIGMER_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
```

### Changing Your LLM Provider

Re-run the interactive setup:

```bash
stigmer server setup
```

Or set the provider directly:

```bash
stigmer config set llm.provider anthropic    # switch to Anthropic
stigmer config set llm.provider openai       # switch to OpenAI
stigmer config set llm.provider ollama       # switch to Ollama
```

After changing the provider, restart the server:

```bash
stigmer server stop && stigmer server
```

## Architecture

Stigmer is a single binary (BusyBox pattern) that embeds all required services:

```
┌──────────────────────────────────────────────────────┐
│                  stigmer CLI (Go)                     │
│              (client-apps/cli/)                       │
└────────────────────┬─────────────────────────────────┘
                     │ gRPC (localhost:7234)
┌────────────────────▼─────────────────────────────────┐
│            stigmer-server (Go)                        │
│        (backend/services/stigmer-server/)             │
│                                                       │
│  Controllers: Agent, Workflow, Skill, MCP Server      │
│  Storage: SQLite via modernc.org/sqlite (pure Go)     │
└────────────────────┬─────────────────────────────────┘
                     │ Temporal Client
┌────────────────────▼─────────────────────────────────┐
│            Temporal (auto-managed)                     │
└───────────┬───────────────────────┬──────────────────┘
┌───────────▼──────────┐  ┌────────▼──────────────────┐
│  agent-runner        │  │  workflow-runner           │
│  (Python)            │  │  (Go)                      │
│  Graphton agent      │  │  CNCF Serverless Workflow  │
│  execution           │  │  execution                 │
└──────────────────────┘  └───────────────────────────┘
```

**Components:**

- **stigmer CLI** — User-facing command-line interface with backend abstraction (local daemon vs cloud). Location: `client-apps/cli/`
- **stigmer-server** — Go gRPC API server with SQLite storage, protobuf validation, and full-text search (FTS5). Location: `backend/services/stigmer-server/`
- **agent-runner** — Python Temporal worker for AI agent execution via the Graphton framework. Location: `backend/services/agent-runner/`
- **workflow-runner** — Go Temporal worker for CNCF Serverless Workflow execution with Claim Check and Continue-As-New patterns. Location: `backend/services/workflow-runner/`
- **Go SDK** — Pulumi-aligned SDK for defining agents and workflows programmatically. Location: `sdk/go/`
- **MCP Server** — Stateless MCP gateway bridging AI IDEs to stigmer-server via gRPC. Location: `mcp-server/`
- **Proto APIs** — gRPC service definitions that serve as the contract between CLI and backends. Location: `apis/`

## Development

### Prerequisites

- Go 1.25 or later
- Python 3.11+ with [Poetry](https://python-poetry.org/) (for agent-runner)
- Git, Make

### Building from Source

```bash
git clone https://github.com/stigmer/stigmer.git
cd stigmer

# Install all dependencies
make setup

# Build the CLI (outputs bin/stigmer)
make build

# Run tests
make test
```

### Proto Generation

```bash
cd apis
make build         # generate Go + Python stubs
make lint          # lint proto files
make fmt           # format proto files
```

Generated stubs go to `apis/stubs/` (excluded from version control). See [apis/README.md](apis/README.md) for details.

### Releases

```bash
make release bump=patch   # create a release tag (triggers GoReleaser via GitHub Actions)
make protos-release       # publish protos to Buf separately
```

See [Distribution Guide](docs/guides/distribution.md) for the full packaging and release process.

## Troubleshooting

**Server won't start:**

```bash
stigmer server status              # check if already running
stigmer server stop && sleep 2 && stigmer server   # restart cleanly
```

**Check logs:**

```bash
stigmer server logs
```

**Reset all local data:**

```bash
stigmer server reset    # stops services, removes data, keeps config
stigmer server          # recreates everything on first run
```

To also remove configuration (API keys, LLM preferences):

```bash
stigmer server reset --include-config
```

## Documentation

- [Full Documentation Index](docs/README.md)
- [Local Mode Guide](docs/getting-started/local-mode.md)
- [Architecture](docs/architecture/) — [Temporal Integration](docs/architecture/temporal-integration.md), [Open Core Model](docs/architecture/open-core-model.md), [Packaging Flow](docs/architecture/packaging-flow.md)
- [Guides](docs/guides/) — [Environment Variables](docs/guides/environment-variables.md), [Using MCP Servers](docs/guides/using-mcp-servers.md), [Uploading Skills](docs/guides/uploading-skills.md)
- [Examples](examples/) — Sample agents, workflows, and skills

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

- [GitHub Issues](https://github.com/stigmer/stigmer/issues) — Bug reports and feature requests
- [Discord](https://discord.gg/stigmer) — Community chat

## License

Apache License 2.0. See [LICENSE](LICENSE).
