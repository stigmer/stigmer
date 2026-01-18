# Stigmer CLI

Command-line interface for managing AI agents and workflows in Stigmer.

## Architecture

The CLI implements a clean **backend abstraction** inspired by Pulumi:

**Local Mode** (default):
- Connects to local daemon on `localhost:50051`
- Daemon manages BadgerDB storage
- Zero infrastructure - just files on disk
- Perfect for development and personal use

**Cloud Mode**:
- Connects to Stigmer Cloud API at `api.stigmer.ai:443`
- Multi-user collaboration
- Production-scale infrastructure
- Managed secrets and execution

**Same CLI. Same commands. Different backend.**

## Quick Start

### Initialize Local Backend

```bash
stigmer init
```

This creates `~/.stigmer/` directory, config file, and starts the local daemon.

### Create an Agent

```bash
stigmer agent create \
  --name support-bot \
  --instructions "You are a helpful customer support agent"
```

### Create a Workflow

```bash
stigmer workflow create \
  --name customer-onboarding \
  --description "Onboard new customers"
```

### Manage Local Daemon

```bash
# Check daemon status
stigmer local status

# Start daemon
stigmer local start

# Stop daemon
stigmer local stop

# Restart daemon
stigmer local restart
```

### Switch to Cloud Backend

```bash
stigmer backend set cloud
stigmer login
```

## Commands

### Daemon Management

```bash
stigmer init                 # Initialize local backend
stigmer local start          # Start local daemon
stigmer local stop           # Stop local daemon
stigmer local status         # Show daemon status
stigmer local restart        # Restart daemon
```

### Backend Configuration

```bash
stigmer backend status       # Show current backend
stigmer backend set local    # Switch to local mode
stigmer backend set cloud    # Switch to cloud mode
```

### Agent Management

```bash
stigmer agent create --name <name> --instructions <text>
stigmer agent list
stigmer agent get <id>
stigmer agent delete <id>
```

### Workflow Management

```bash
stigmer workflow create --name <name> [--description <text>]
stigmer workflow list
stigmer workflow get <id>
stigmer workflow delete <id>
```

## Configuration

Config file: `~/.stigmer/config.yaml`

**Local mode**:
```yaml
backend:
  type: local
  local:
    endpoint: localhost:50051
    data_dir: ~/.stigmer/data
```

**Cloud mode**:
```yaml
backend:
  type: cloud
  cloud:
    endpoint: api.stigmer.ai:443
    token: <your-token>
```

## Local Daemon (ADR 011)

The local daemon (`stigmer-server`) is a long-running Go process that:

- **API Server**: Serves gRPC on `localhost:50051`
- **Data Guardian**: Manages exclusive BadgerDB connection
- **Stream Broker**: Provides real-time updates via Go channels
- **Supervisor**: Manages workflow and agent runner processes

**Data directory**: `~/.stigmer/data/`
- `daemon.pid` - Process ID
- `logs/` - Daemon logs
- `badger/` - BadgerDB files

## Build

```bash
# Build CLI
make build

# Run directly
make run ARGS="agent list"

# Clean build artifacts
make clean
```

## Development

The CLI is built with:
- **cobra**: Command framework
- **gRPC**: Backend communication
- **BadgerDB**: Local storage (via daemon)
- **YAML**: Configuration files

**Project structure**:
```
client-apps/cli/
├── cmd/stigmer/          # Command definitions
│   └── root/            # Individual commands
├── internal/cli/
│   ├── backend/         # gRPC client
│   ├── config/          # Config management
│   ├── daemon/          # Daemon lifecycle
│   ├── clierr/          # Error handling
│   └── cliprint/        # Output formatting
├── main.go              # Entry point
└── BUILD.bazel          # Build configuration
```

## Status

✅ Complete CLI structure
✅ Backend abstraction (local + cloud)
✅ Configuration management
✅ Daemon lifecycle management  
✅ Agent CRUD commands
✅ Workflow CRUD commands
⏳ Proto import path fix needed (see KNOWN_ISSUES.md)

## See Also

- [ADR 011: Local Daemon Architecture](../../docs/adr/20260118-190513-stigmer-local-deamon.md)
- [Backend Architecture](../../backend/README.md)
