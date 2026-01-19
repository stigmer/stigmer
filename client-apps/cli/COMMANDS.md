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

# Restart server
stigmer server restart
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

The Stigmer CLI manages a local server that includes:

- **stigmer-server**: gRPC API server (localhost:50051)
- **Temporal**: Workflow orchestration (auto-downloaded and started)
- **BadgerDB**: Local embedded storage
- **agent-runner**: AI agent execution runtime

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

# Project scaffolding
stigmer init my-project
```

## Migration from Old Commands

| Old Command | New Command |
|------------|-------------|
| `stigmer init` | `stigmer server` (auto-initializes) |
| `stigmer local start` | `stigmer server` |
| `stigmer local stop` | `stigmer server stop` |
| `stigmer local status` | `stigmer server status` |
| `stigmer local restart` | `stigmer server restart` |
| `stigmer agent create` | Use UI or API (removed from CLI) |
| `stigmer workflow create` | Use UI or API (removed from CLI) |
| `stigmer version` | Removed (use `--version` flag) |
