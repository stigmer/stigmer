# Stigmer

**Build AI agents and workflows with zero infrastructure.**

Stigmer is an open-source agentic automation platform that runs locally with BadgerDB key-value store or scales to production with Stigmer Cloud. Define agents and workflows in code, execute them anywhere.

## Why Stigmer?

Most AI agent frameworks force you to choose: either run locally with limited features, or commit to a cloud platform from day one. Stigmer gives you both.

**Local Mode**: Run agents and workflows on your laptop with a BadgerDB key-value store. No servers, no auth, no complexity. Perfect for development, personal projects, and small teams.

**Cloud Mode**: When you're ready, `stigmer login` switches to Stigmer Cloud for multi-user collaboration, secrets management, and production scale—without changing your code.

Same CLI. Same SDK. Same workflow definitions. Your choice of backend.

## Prerequisites

### Optional: Ollama (Recommended for Local Development)

For the best local experience with zero API costs, install Ollama:

```bash
# macOS
brew install ollama

# Start Ollama
ollama serve

# Pull the default model
ollama pull qwen2.5-coder:7b
```

**With Ollama**: Zero-config, free, works offline  
**Without Ollama**: You'll be prompted for an Anthropic API key (cloud LLM)

## Quick Start

### 1. Install Stigmer

```bash
# Clone and build
git clone https://github.com/stigmer/stigmer.git
cd stigmer/client-apps/cli
make install
```

### 2. Start Local Mode

```bash
stigmer local
```

**That's it!** This single command:
- ✅ Downloads and starts Temporal automatically
- ✅ Uses Ollama (local LLM - no API keys!)
- ✅ Starts the daemon with zero configuration
- ✅ Ready for agent execution

**First run output:**
```
✓ Using Ollama (no API key required)
✓ Starting managed Temporal server...
✓ Temporal started on localhost:7233
✓ Starting stigmer-server...
✓ Starting agent-runner...
✓ Ready! Stigmer is running on localhost:50051
```

### Managing Local Mode

```bash
# Check status
stigmer local status

# Stop daemon
stigmer local stop

# Restart
stigmer local restart
```

### Configuration (Optional)

**Default**: Uses Ollama with `qwen2.5-coder:7b` (free, local)

**Switch to Anthropic** (paid, cloud):

Edit `~/.stigmer/config.yaml`:
```yaml
backend:
  local:
    llm:
      provider: anthropic
      model: claude-sonnet-4.5
```

Or use environment variables:
```bash
export STIGMER_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
stigmer local restart
```

**See the full documentation** for advanced configuration options.

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
│         │   BadgerDB Storage Layer     │                    │
│         │  (libs/go/badger)            │                    │
│         │                              │                    │
│         │  Key-Value Pattern:          │                    │
│         │  - Key: kind/id              │                    │
│         │  - Value: Protobuf bytes     │                    │
│         │  - Prefix scan for listing   │                    │
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

**stigmer CLI** - Command-line interface for managing agents and workflows
- Backend abstraction (local daemon vs cloud)
- Daemon lifecycle management
- Agent and workflow CRUD operations
- **Location**: `client-apps/cli/` - [See CLI README](client-apps/cli/README.md)

**stigmer-server** - Go gRPC API server with BadgerDB storage
- Key-value storage with prefix scanning (zero schema migrations)
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

### Local Development Stack

For full local development with agent execution:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: User Interface                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         stigmer CLI (Go)                              │  │
│  │  Commands: agent create/list/execute, workflow, etc. │  │
│  └──────────────────┬───────────────────────────────────┘  │
└────────────────────│──────────────────────────────────────┘
                     │ gRPC (localhost:50051)
┌────────────────────▼──────────────────────────────────────┐
│  Layer 2: API Server (stigmer-server - Go)                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Controllers: Agent, Workflow, Session, etc.         │ │
│  │  Storage: BadgerDB (~/.stigmer/data/)                │ │
│  └──────────────────┬───────────────────────────────────┘ │
└────────────────────│──────────────────────────────────────┘
                     │ Temporal Client
┌────────────────────▼──────────────────────────────────────┐
│  Layer 3: Temporal (Docker)                               │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Workflow Orchestration                              │ │
│  │  Task Queues: agent_execution_stigmer (Go)           │ │
│  │              agent_execution_runner (Python)         │ │
│  └──────────────────┬───────────────────────────────────┘ │
└────────────────────│──────────────────────────────────────┘
                     │ Task Queue Polling
┌────────────────────▼──────────────────────────────────────┐
│  Layer 4: Agent Runner (Python)                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Temporal Activities: ExecuteGraphton, etc.          │ │
│  │  AI Provider: Anthropic Claude (via API key)         │ │
│  │  Sandbox: Filesystem-based workspace                 │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

**Zero-config setup**:
```bash
stigmer local
# That's it! Temporal auto-starts, Ollama used by default
```

**With Anthropic (paid)**:
```bash
export STIGMER_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
stigmer local
```

### Storage Strategy

Stigmer uses **BadgerDB** with a simple **key-value pattern**:

**Key Format**: `resource_kind/resource_id` (e.g., `agent/abc123`)  
**Value**: Raw Protobuf bytes (no JSON conversion overhead)

**Listing**: BadgerDB's prefix scan enables fast listing by kind:
```go
// List all agents: Seek("agent/")
// List all workflows: Seek("workflow/")
```

**Benefits**:
- ✅ Zero schema migrations when adding new resource kinds
- ✅ 10-50x faster than SQLite for Protobuf storage (no JSON conversion)
- ✅ Pure Go implementation (no CGO dependencies)
- ✅ 90% less persistence layer code

See [ADR: Local Backend to Use BadgerDB](docs/adr/20260118-181912-local-backend-to-use-badgerdb.md)

### Open Source vs Cloud

**Open Source** (Apache 2.0):
- CLI and execution engine (`cmd/stigmer/`)
- stigmer-server (Go gRPC API server)
- agent-runner (Python Temporal worker)
- workflow-runner (Go Temporal worker)
- Go and Python SDKs
- BadgerDB storage layer
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
- Local daemon runs on `localhost:50051` (started with `stigmer local`)
- BadgerDB key-value store in `~/.stigmer/data/` (daemon holds exclusive lock)
- CLI and Agent Runner both connect to daemon via gRPC
- Single implicit user (`local-user`)
- Uses Ollama by default (no API keys needed)
- Auto-manages Temporal for workflow orchestration

**What runs in local mode:**
- **stigmer-server** (Go): gRPC API server with BadgerDB storage
- **agent-runner** (Python): Temporal worker for executing AI agents
- **Temporal** (managed): Workflow orchestration (auto-downloaded and started)

**Start using**:
```bash
# Single command to start everything
stigmer local

# Now you can create and execute agents
stigmer agent create --name my-agent --instructions "..."
stigmer agent execute my-agent "Your prompt here"
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

## Troubleshooting

### Daemon won't start

**Check if already running:**
```bash
stigmer local status
```

**Kill existing processes:**
```bash
ps aux | grep stigmer
killall stigmer-server stigmer
```

**Check logs:**
```bash
cat ~/.stigmer/logs/daemon.log
```

### Agent execution fails

**Verify Temporal is running:**
```bash
docker ps | grep temporal
# If not running:
docker start temporal
```

**Check Temporal connection:**
```bash
# stigmer-server should log Temporal connection on startup
cat ~/.stigmer/logs/daemon.log | grep -i temporal
```

**Connect to custom Temporal server:**
```bash
# If Temporal is running on a different host/port
stigmer local restart --temporal-host=192.168.1.5:7233

# Or set environment variable
export TEMPORAL_HOST=192.168.1.5:7233
stigmer local restart
```

**Without Temporal:** Agent execution will fail. You can still create/list agents, but execution requires Temporal.

### Missing Anthropic API key

**Set via environment variable:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
stigmer local restart
```

**Set via flag:**
```bash
stigmer local start --anthropic-api-key=sk-ant-...
```

**Update keychain (macOS):**
```bash
# Open Keychain Access app
# Search for "ANTHROPIC_API_KEY" and update
stigmer local restart
```

### Database locked errors

If you see "database is locked":

```bash
# Stop the daemon first
stigmer local stop

# Wait a moment for cleanup
sleep 2

# Restart
stigmer local start
```

### Reset everything

**⚠️ This deletes all local data:**

```bash
stigmer local stop
rm -rf ~/.stigmer
stigmer init
```

## Documentation

- 📚 [Complete Documentation](docs/README.md) - Full documentation index
- [Getting Started](docs/getting-started/) - Detailed guides
- [Architecture](docs/architecture/) - How Stigmer works
  - [Temporal Integration](docs/architecture/temporal-integration.md) - Workflow orchestration design
  - [Request Pipeline Context Design](docs/architecture/request-pipeline-context-design.md) - Multi-context vs single-context architectural analysis
- [API Reference](docs/api/) - gRPC service interfaces and SDK docs
- [Examples](examples/) - Sample agents and workflows

## Development

### Building from Source

**Prerequisites:**
- Go 1.21 or later
- Git
- Make

**Build the CLI:**

```bash
# Clone the repository
git clone https://github.com/stigmer/stigmer.git
cd stigmer

# Build the CLI
cd client-apps/cli
make build

# Binary will be in: client-apps/cli/bin/stigmer
```

**Build stigmer-server (optional, if modifying the API server):**

```bash
cd backend/services/stigmer-server
go build -o stigmer-server cmd/server/main.go
```

**Build agent-runner (optional, if modifying agent execution):**

```bash
cd backend/services/agent-runner

# Install dependencies
poetry install

# Run type checking
make build
```

**Run tests:**

```bash
# CLI tests
cd client-apps/cli
make test

# stigmer-server tests
cd backend/services/stigmer-server
go test ./...
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
