# Stigmer

**Build AI agents and workflows with zero infrastructure.**

Stigmer is an open-source agentic automation platform that runs locally with BadgerDB or scales to production with Stigmer Cloud. Define agents and workflows in code, execute them anywhere.

## Why Stigmer?

Most AI agent frameworks force you to choose: either run locally with limited features, or commit to a cloud platform from day one. Stigmer gives you both.

**Local Mode**: Run agents and workflows on your laptop with a BadgerDB key-value store. No servers, no auth, no complexity. Perfect for development, personal projects, and small teams.

**Cloud Mode**: When you're ready, `stigmer login` switches to Stigmer Cloud for multi-user collaboration, secrets management, and production scale—without changing your code.

Same CLI. Same SDK. Same workflow definitions. Your choice of backend.

## Quick Start

### Install

```bash
# macOS/Linux
curl -sSL https://stigmer.ai/install.sh | bash

# Or with Homebrew
brew install stigmer/tap/stigmer
```

### Initialize Local Mode

```bash
stigmer init
```

This creates `~/.stigmer/data` and you're ready to build agents.

### Create Your First Agent

```bash
stigmer agent create support-bot \
  --instructions "You are a helpful customer support agent" \
  --mcp-server github
```

### Execute

```bash
stigmer agent execute support-bot "Check open issues in myorg/myrepo"
```

## Architecture

Stigmer uses an **Open Core** model with a clean separation between local and cloud backends:

```
┌─────────────────────────────────────────────────────────────┐
│                     Stigmer CLI                              │
│              (cmd/stigmer - Open Source)                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ In-process gRPC
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                  stigmer-server (Go)                         │
│              (backend/services/stigmer-server)               │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Agent API    │  │ Workflow API │  │ Skill API    │      │
│  │ Controller   │  │ Controller   │  │ Controller   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                       │                                      │
│                       ↓                                      │
│         ┌──────────────────────────────┐                    │
│         │   SQLite Storage Layer       │                    │
│         │  (libs/go/sqlite)            │                    │
│         │                              │                    │
│         │  resources table:            │                    │
│         │  - id (PK)                   │                    │
│         │  - kind (discriminator)      │                    │
│         │  - data (JSON)               │                    │
│         └──────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
                       │
                       ↓
         ┌──────────────────────────────┐
         │   Temporal Orchestration     │
         └──────────────────────────────┘
                   ↙         ↘
          ┌──────────┐   ┌──────────────┐
          │  agent-  │   │  workflow-   │
          │  runner  │   │  runner      │
          │ (Python) │   │    (Go)      │
          └──────────┘   └──────────────┘
```

### Components

**stigmer-server** - Go gRPC API server with SQLite storage
- Single-table generic resource storage (zero migrations)
- In-process gRPC (no network overhead for local usage)
- Protobuf validation
- **Location**: `backend/services/stigmer-server/`

**agent-runner** - Python Temporal worker for Graphton agent execution
- Real-time status updates via gRPC
- Session-based sandbox management
- Skills integration
- **Location**: `backend/services/agent-runner/`

**workflow-runner** - Go Temporal worker for CNCF Serverless Workflows
- Claim Check pattern for large payloads
- Continue-As-New for unbounded workflows
- gRPC command controller
- **Location**: `backend/services/workflow-runner/`

### Storage Strategy

Stigmer uses a **generic single-table pattern** to avoid migration hell:

```sql
CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,           -- "Agent", "Workflow", "Skill"
    org_id TEXT DEFAULT '',
    data JSON NOT NULL,           -- Full proto serialized to JSON
    updated_at DATETIME
);
```

**Benefits**:
- ✅ Zero schema migrations when adding new resource kinds
- ✅ 90% less persistence layer code
- ✅ Cloud parity (mimics MongoDB document model)

See [ADR: Generic Resource Storage Strategy](docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md)

### Open Source vs Cloud

**Open Source** (Apache 2.0):
- CLI and execution engine (`cmd/stigmer/`)
- stigmer-server (Go gRPC API server)
- agent-runner (Python Temporal worker)
- workflow-runner (Go Temporal worker)
- Go and Python SDKs
- SQLite storage layer
- **Repository**: `github.com/stigmer/stigmer`

**Proprietary** (Stigmer Cloud):
- Multi-tenant SaaS platform
- stigmer-service (Java Spring Boot with MongoDB)
- Organizations and IAM (Auth0 + FGA)
- Web console (React + TanStack)
- Advanced governance and audit
- **Repository**: `github.com/leftbin/stigmer-cloud` (private)

## Core Concepts

### Agents

AI agents with instructions, tools (via MCP servers), and conversation memory.

```yaml
# agent.yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-analyst
spec:
  instructions: |
    Analyze GitHub repositories for code quality issues.
  mcpServers:
    - github
    - filesystem
```

Deploy and execute:

```bash
stigmer apply -f agent.yaml
stigmer agent execute github-analyst "Analyze myorg/myrepo"
```

### Workflows

Multi-step automations with conditional logic, loops, and agent tasks.

```yaml
# workflow.yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: pr-review
spec:
  tasks:
    - name: fetch-pr
      agent: github-analyst
      inputs:
        pr_url: "${workflow.inputs.pr_url}"
    
    - name: review-code
      agent: code-reviewer
      inputs:
        code: "${tasks.fetch-pr.output}"
```

Execute:

```bash
stigmer workflow execute pr-review \
  --input pr_url=https://github.com/myorg/myrepo/pull/123
```

### MCP Servers

Stigmer uses the [Model Context Protocol](https://modelcontextprotocol.io) to give agents capabilities:

- **GitHub**: Repository access, issues, PRs
- **Filesystem**: Read/write files
- **Postgres**: Database queries
- **Slack**: Send messages
- **Custom**: Build your own

## Local vs. Cloud

### Local Mode (Open Source)

**Perfect for**:
- Development and testing
- Personal projects
- Small teams sharing a machine
- Air-gapped environments

**How it works**:
- Local daemon runs on `localhost:50051` (started with `stigmer local start`)
- BadgerDB key-value store in `~/.stigmer/data` (daemon holds file lock)
- CLI and Agent Runner both connect to daemon via gRPC
- Single implicit user (`local-user`)
- Secrets stored in OS keychain or encrypted file

**Start using**:
```bash
# Start the local daemon
stigmer local start

# In another terminal, initialize and run commands
stigmer init
```

### Cloud Mode (Stigmer Cloud)

**Perfect for**:
- Team collaboration
- Production workloads
- Enterprise governance
- Multi-region deployment

**How it works**:
- Multi-tenant SaaS platform
- Organizations, teams, and users
- Web console for management
- IAM policies and audit logs

**Start using**:
```bash
stigmer login
```

**Switching is seamless**: Your agent and workflow definitions work in both modes. Both implementations use the same gRPC service interfaces.

## SDK Usage

### Go SDK

```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    wf := workflow.New("data-pipeline")
    
    wf.Task("extract", func(ctx workflow.TaskContext) error {
        // Extract data
        return ctx.SetOutput("data", extractedData)
    })
    
    wf.Task("transform", func(ctx workflow.TaskContext) error {
        data := ctx.GetInput("data")
        // Transform data
        return ctx.SetOutput("transformed", result)
    })
    
    wf.Execute()
}
```

### Python SDK

```python
from stigmer import workflow

@workflow.task
def extract_data(ctx):
    # Extract data
    ctx.set_output("data", extracted_data)

@workflow.task
def transform_data(ctx):
    data = ctx.get_input("data")
    # Transform data
    ctx.set_output("transformed", result)

workflow.run("data-pipeline")
```

## gRPC Service Architecture

Stigmer uses gRPC service interfaces as the contract between CLI and backends:

```protobuf
// Each resource defines its own gRPC services
service AgentCommandController {
  rpc create(Agent) returns (Agent);
  rpc update(Agent) returns (Agent);
  rpc delete(AgentId) returns (Agent);
}

service AgentQueryController {
  rpc get(AgentId) returns (Agent);
  rpc list(ListRequest) returns (ListResponse);
}
```

**Local Mode**: Implements these gRPC services with BadgerDB (in-process, no network).  
**Cloud Mode**: Implements these gRPC services over network with distributed storage.

This guarantees:
- ✅ Same features in both modes
- ✅ Zero code changes when switching backends
- ✅ Compiler enforces interface compatibility
- ✅ No drift between implementations

## Documentation

- [Getting Started](docs/getting-started/) - Installation and first agent
- [Architecture](docs/architecture/) - How Stigmer works
- [API Reference](docs/api/) - gRPC service interfaces and SDK docs
- [Examples](examples/) - Sample agents and workflows

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/stigmer/stigmer.git
cd stigmer

# Build the CLI
make build

# Run tests
make test
```

### Proto Generation

Stigmer uses Protocol Buffers to define its gRPC API contracts. All proto files are located in the `apis/` directory.

```bash
# Navigate to apis directory
cd apis

# Generate all stubs (Go + Python)
make build

# Or generate specific language stubs
make go-stubs
make python-stubs

# Lint and format proto files
make lint
make fmt

# Clean generated stubs
make clean
```

Generated stubs are placed in `apis/stubs/` and are excluded from version control:
- Go stubs: `apis/stubs/go/`
- Python stubs: `apis/stubs/python/stigmer/`

See [apis/README.md](apis/README.md) for more details on the proto structure and build process.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas we need help**:
- Additional MCP server integrations
- SDK improvements (new languages welcome)
- Documentation and examples
- Bug reports and feature requests

## Community

- **Discord**: [Join our community](https://discord.gg/stigmer)
- **GitHub Issues**: [Report bugs or request features](https://github.com/stigmer/stigmer/issues)
- **Documentation**: [Read the docs](https://docs.stigmer.ai)

## License

Stigmer is licensed under the **Apache License 2.0**.

See [LICENSE](LICENSE) for details.

## Commercial Support

For enterprise support, SLA guarantees, and custom integrations, contact us at [enterprise@stigmer.ai](mailto:enterprise@stigmer.ai).

---

**Built with ❤️ by the Stigmer team.**
