# Stigmer CLI Commands

## Available Commands

### Server Management

```bash
# Start Stigmer server (auto-initializes on first run)
stigmer server

# Stop server
stigmer server stop

# Check server status
stigmer server status

# Restart server (start automatically stops if already running)
stigmer server start

# View server logs (last 50 lines)
stigmer server logs

# Stream logs in real-time (like kubectl logs -f)
stigmer server logs --follow

# View agent-runner logs
stigmer server logs --component agent-runner

# View error logs
stigmer server logs --stderr

# Custom number of recent lines
stigmer server logs --tail 100
```

### Backend Configuration

```bash
# Show current backend (local/cloud)
stigmer backend status

# Switch to local backend
stigmer backend set local

# Switch to cloud backend
stigmer backend set cloud
```

### Project Scaffolding

```bash
# Option 1: Create in current directory (Pulumi-style)
# Uses directory name as project name
mkdir my-project && cd my-project
stigmer new

# Option 2: Create new directory with specified name
stigmer new my-project
cd my-project

# The generated project includes:
# - AI agent (PR code reviewer)
# - Workflow (analyzes GitHub PRs)
# - Zero configuration setup
# - Complete documentation

# After creation:
stigmer run
```

## Configuration

### `~/.stigmer/config.yaml`

Auto-created on first run:

```yaml
backend:
  type: local  # or cloud
  local:
    endpoint: localhost:50051
    data_dir: ~/.stigmer/data
  cloud:
    endpoint: api.stigmer.ai:443
    token: <your-token>
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STIGMER_DATA_DIR` | Data directory for storage and logs | `~/.stigmer` |

## Quick Start

### Option 1: Start with a New Project (Recommended)

```bash
# 1. Create a new project with example code
mkdir my-first-project && cd my-first-project
stigmer new

# Or create new directory:
# stigmer new my-first-project && cd my-first-project

# 2. Start the server
stigmer server

# 3. Run the example workflow
stigmer run

# The example demonstrates:
# - AI agent that reviews code
# - Workflow that fetches and analyzes a real GitHub PR
# - Zero configuration required
```

### Option 2: Manual Setup

```bash
# 1. Start the server (auto-initializes everything)
stigmer server

# 2. Use the Stigmer UI or API to create agents and workflows
#    Open: http://localhost:8233 (Temporal UI)

# 3. Check server status anytime
stigmer server status

# 4. Stop when done
stigmer server stop
```

## Development

```bash
# Build CLI
make build

# Install to GOPATH/bin
make install

# Build, install, and verify (recommended)
make release-local

# Run without installing
make run ARGS="server status"

# Run tests
make test
```

## Architecture

The Stigmer CLI manages a complete local daemon that includes:

- **stigmer-server**: gRPC API server (localhost:7234)
- **Temporal**: Workflow orchestration (localhost:7233, auto-downloaded)
- **workflow-runner**: Zigflow workflow execution (Temporal worker)
- **agent-runner**: AI agent execution (Temporal worker)
- **BadgerDB**: Local embedded storage

Port allocation:
- **7233** - Temporal gRPC
- **7234** - Stigmer Server (Temporal + 1)
- **8233** - Temporal UI

Everything runs locally with zero external dependencies.

## Future Commands (Planned)

The following commands are planned for future releases:

```bash
# Resource management via YAML
stigmer apply -f agent.yaml
stigmer delete -f workflow.yaml

# Direct execution
stigmer agent execute <id> <prompt>
stigmer workflow execute <id> --input key=value
```

## Migration from Old Commands

| Old Command | New Command |
|------------|-------------|
| `stigmer init` | `stigmer server` (auto-initializes) |
| `stigmer local start` | `stigmer server` |
| `stigmer local stop` | `stigmer server stop` |
| `stigmer local status` | `stigmer server status` |
| `stigmer local restart` | `stigmer server start` (idempotent) |
| `stigmer agent create` | Use UI or API (removed from CLI) |
| `stigmer workflow create` | Use UI or API (removed from CLI) |
| `stigmer version` | Removed (use `--version` flag) |
