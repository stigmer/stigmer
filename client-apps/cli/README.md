# Stigmer CLI

Command-line interface for running Stigmer server locally.

## Architecture

The CLI implements a clean **backend abstraction** inspired by Pulumi:

**Local Mode** (default):
- Runs Stigmer server on `localhost:50051`
- Auto-downloads and starts Temporal
- Uses BadgerDB for embedded storage
- Zero infrastructure - just files on disk
- Perfect for development and personal use

**Cloud Mode** (future):
- Connects to Stigmer Cloud API at `api.stigmer.ai:443`
- Multi-user collaboration
- Production-scale infrastructure
- Managed secrets and execution

**Same CLI. Same commands. Different backend.**

## Distribution

The Stigmer CLI is a **single self-contained binary** (~123 MB) that embeds all required components:
- `stigmer-server` (Go backend)
- `workflow-runner` (Temporal worker for Zigflow)
- `agent-runner` (Temporal worker for AI agents)

**On first run**, the CLI automatically extracts these binaries to `~/.stigmer/data/bin/` (< 3 seconds). This happens transparently - you just run `stigmer server` and it works.

**Benefits**:
- ✅ **Works completely offline** - No downloads after install
- ✅ **Version sync guaranteed** - All components from same build
- ✅ **Simple installation** - One binary, no dependencies
- ✅ **Homebrew-friendly** - Platform-specific bottles

**For developers**: See `RELEASE.md` for build and release process details.

## Quick Start

### Start Stigmer Server

```bash
stigmer server
```

That's it! On first run, this command:
1. Creates `~/.stigmer/` directory
2. Generates default config
3. **Extracts embedded binaries** (< 3 seconds, one-time)
4. Downloads Temporal (if needed)
5. Starts stigmer-server, workflow-runner, agent-runner

### Manage Server

```bash
# Check server status
stigmer server status

# Stop server
stigmer server stop

# Restart server (start is idempotent - stops if running, then starts)
stigmer server start
```

### Switch to Cloud Backend (Future)

```bash
stigmer backend set cloud
stigmer login
```

## Commands

### Server Management

```bash
stigmer server              # Start server (auto-initializes)
stigmer server stop         # Stop server
stigmer server status       # Show server status
stigmer server start        # Start (idempotent - restarts if already running)
```

### Backend Configuration

```bash
stigmer backend status      # Show current backend (local/cloud)
stigmer backend set local   # Switch to local mode
stigmer backend set cloud   # Switch to cloud mode
```

## Configuration

Config file: `~/.stigmer/config.yaml` (auto-created on first run)

**Local mode**:
```yaml
backend:
  type: local
  local:
    endpoint: localhost:50051
    data_dir: ~/.stigmer/data
```

**Cloud mode** (future):
```yaml
backend:
  type: cloud
  cloud:
    endpoint: api.stigmer.ai:443
    token: <your-token>
```

## Stigmer Server

The Stigmer server is a long-running Go process that includes:

- **stigmer-server**: gRPC API server (localhost:50051)
- **Temporal**: Workflow orchestration (auto-downloaded)
- **BadgerDB**: Embedded local storage
- **agent-runner**: AI agent execution runtime

**Data directory**: `~/.stigmer/data/`
- `daemon.pid` - Process ID
- `logs/` - Server logs
- `badger/` - BadgerDB files

**Access Temporal UI**: http://localhost:8233

## Build

```bash
# Build CLI
make build

# Install to GOPATH/bin
make install

# Build, install, and verify
make release-local

# Run directly without installing
make run ARGS="server status"

# Clean build artifacts
make clean
```

## Development

The CLI is built with:
- **cobra**: Command framework
- **gRPC**: Backend communication
- **Go embed**: Binary embedding (stigmer-server, workflow-runner, agent-runner)
- **BadgerDB**: Local storage (via server)
- **YAML**: Configuration files

**Project structure**:
```
client-apps/cli/
├── cmd/stigmer/          # Command definitions
│   └── root/            # Individual commands
├── embedded/            # Binary embedding package
│   ├── embedded.go     # Platform detection & embed directives
│   ├── extract.go      # Extraction logic
│   └── version.go      # Version checking
├── internal/cli/
│   ├── backend/         # gRPC client
│   ├── config/          # Config management
│   ├── daemon/          # Server lifecycle
│   ├── clierr/          # Error handling
│   └── cliprint/        # Output formatting
├── main.go              # Entry point
└── BUILD.bazel          # Build configuration
```

### Building Locally

```bash
# Build CLI with embedded binaries for your platform
make release-local

# Result: ~/bin/stigmer (123 MB, self-contained)
```

### Development Mode

Override extracted binaries with local builds using environment variables:

```bash
export STIGMER_SERVER_BIN=~/bin/stigmer-server
export STIGMER_WORKFLOW_RUNNER_BIN=~/bin/workflow-runner
export STIGMER_AGENT_RUNNER_SCRIPT=~/code/stigmer/backend/services/agent-runner/run.sh

stigmer server  # Uses env vars instead of extracted binaries
```

**Production**: Uses only extracted binaries from `~/.stigmer/data/bin/`  
**Development**: Optionally use env vars to point to local builds

#### Agent-Runner Workspace Detection

The agent-runner needs to locate its workspace (where `pyproject.toml` lives). Detection order:

1. **Production**: `STIGMER_AGENT_RUNNER_WORKSPACE` (set automatically by daemon)
2. **Bazel**: `BUILD_WORKSPACE_DIRECTORY` (set automatically by `bazel run`)
3. **Development**: Directory tree walking (finds `MODULE.bazel` or `WORKSPACE`)

The daemon automatically sets `STIGMER_AGENT_RUNNER_WORKSPACE` when starting agent-runner, pointing to the extracted agent-runner directory. No manual configuration needed.

## Resource Management

Agents and workflows are managed through:
- **Web UI**: Temporal UI at http://localhost:8233
- **gRPC API**: Direct API calls to stigmer-server
- **Future**: YAML-based declarative config (`stigmer apply -f agent.yaml`)

The CLI focuses on server lifecycle management, not CRUD operations.

## Status

✅ Server lifecycle management (start/stop/status - start is idempotent)
✅ Backend abstraction (local + cloud)
✅ Configuration management
✅ Auto-initialization on first run
⏳ Cloud backend integration (planned)
⏳ YAML-based resource management (planned)

## See Also

- [Commands Reference](./COMMANDS.md)
- [ADR 011: Local Daemon Architecture](../../docs/adr/20260118-190513-stigmer-local-deamon.md)
- [Backend Architecture](../../backend/README.md)
