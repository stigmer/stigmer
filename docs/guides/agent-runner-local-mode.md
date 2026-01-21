# Agent Runner: Local Mode

The Stigmer Agent Runner supports two execution modes: **local** (filesystem-based) and **cloud** (Daytona/Redis-based). This guide explains how to run the agent runner in local mode for development and testing.

## Overview

**Local mode** enables you to run Stigmer agents directly on your host machine without cloud infrastructure dependencies. This is ideal for:

- Local development and testing
- Quick iteration on agent workflows
- Environments where cloud services are unavailable
- Learning how Stigmer works

**Cloud mode** (default) uses production infrastructure:
- Daytona for sandboxed execution
- Redis for pub/sub and state management
- Full authentication via Auth0

## Quick Start

### Using Stigmer CLI Daemon (Recommended)

The easiest way to run agent-runner in local mode is via the Stigmer CLI daemon, which handles all configuration automatically:

```bash
# Start local daemon (stigmer-server + agent-runner)
stigmer local start
```

On first start, you'll be prompted for required secrets:

```
Enter Anthropic API key: ********
✓ Anthropic API key configured
Starting daemon...
Daemon started successfully
  PID:  12345
  Port: 50051
  Data: /Users/you/.stigmer
Agent-runner started successfully
```

**What the daemon does:**
- Detects missing API keys and prompts with masked input
- Configures local mode environment automatically:
  - `MODE=local`
  - `SANDBOX_TYPE=filesystem`
  - `SANDBOX_ROOT_DIR=./workspace`
  - `STIGMER_BACKEND_ENDPOINT=localhost:50051`
- Starts stigmer-server and agent-runner processes
- Injects secrets into agent-runner environment
- Manages lifecycle (start/stop/restart)

**Check status:**
```bash
stigmer local status
```

**Stop daemon:**
```bash
stigmer local stop
```

### Manual Configuration (Advanced)

For development or testing, you can run agent-runner manually:

#### 1. Set Execution Mode

```bash
export MODE="local"
```

#### 2. Configure Temporal

```bash
export TEMPORAL_SERVICE_ADDRESS="localhost:7233"
export TEMPORAL_NAMESPACE="default"
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE="agent_execution_runner"
```

#### 3. Configure Stigmer Backend

```bash
export STIGMER_BACKEND_ENDPOINT="localhost:50051"  # Stigmer Daemon
export STIGMER_API_KEY="dummy-local-key"            # Local development key
```

#### 4. Configure Sandbox

```bash
export SANDBOX_TYPE="filesystem"      # Default for local mode
export SANDBOX_ROOT_DIR="./workspace" # Default workspace directory
```

#### 5. Configure Secrets

```bash
export ANTHROPIC_API_KEY="your-api-key"  # Required for agent execution
```

#### 6. Start Agent Runner

```bash
cd backend/services/agent-runner
python -m main
```

You should see:

```
============================================================
🚀 Stigmer Agent Runner - LOCAL Mode
============================================================
Task Queue: agent_execution_runner
Temporal: localhost:7233 (namespace: default)
Backend: localhost:50051
Sandbox: filesystem (root: ./workspace)
Note: Using gRPC to Stigmer Daemon for state/streaming
============================================================
Local mode: Skipping Redis initialization (using gRPC to Stigmer Daemon)
🔧 Execution Mode: LOCAL
...
🚀 Worker ready, polling for tasks...
```

## Mode Comparison

| Aspect | Local Mode | Cloud Mode |
|--------|-----------|------------|
| **Mode Variable** | `MODE=local` | `MODE=cloud` (or unset) |
| **Sandbox** | Filesystem (`./workspace`) | Daytona (isolated containers) |
| **State/Streaming** | Stigmer Daemon gRPC | Redis pub/sub |
| **Backend** | localhost:50051 | Cloud endpoint |
| **Authentication** | Relaxed (dummy key) | Full Auth0 validation |
| **Redis** | Not used | Required |
| **Use Case** | Development, testing | Production deployment |

## Configuration Reference

### Local Mode Environment Variables

#### Required

```bash
# Execution mode
MODE="local"

# Temporal configuration
TEMPORAL_SERVICE_ADDRESS="localhost:7233"
TEMPORAL_NAMESPACE="default"
TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE="agent_execution_runner"

# Stigmer backend
STIGMER_BACKEND_ENDPOINT="localhost:50051"
```

#### Optional (with defaults)

```bash
# Sandbox configuration
SANDBOX_TYPE="filesystem"              # Default: "filesystem"
SANDBOX_ROOT_DIR="./workspace"         # Default: "./workspace"

# API key (auto-set if missing)
STIGMER_API_KEY="dummy-local-key"      # Default: "dummy-local-key"

# Worker configuration
TEMPORAL_MAX_CONCURRENCY="10"          # Default: 10

# Logging
LOG_LEVEL="DEBUG"                      # Default: INFO
```

### Cloud Mode Environment Variables

#### Required

```bash
# Execution mode
MODE="cloud"  # or omit (defaults to cloud)

# Temporal configuration
TEMPORAL_SERVICE_ADDRESS="<temporal-address>"
TEMPORAL_NAMESPACE="<namespace>"

# Stigmer backend
STIGMER_BACKEND_ENDPOINT="<backend-endpoint>"
STIGMER_API_KEY="<auth0-jwt-token>"

# Redis configuration
REDIS_HOST="<redis-host>"
REDIS_PORT="6379"                      # Default: 6379
```

#### Optional

```bash
# Redis authentication
REDIS_PASSWORD="<password>"            # If Redis requires auth

# Daytona sandbox
DAYTONA_DEV_TOOLS_SNAPSHOT_ID="<id>"   # If using snapshot

# Worker configuration
TEMPORAL_MAX_CONCURRENCY="10"
```

## Architecture

### Local Mode Flow

```
┌─────────────────┐
│ Agent Runner    │
├─────────────────┤
│ MODE=local      │
│                 │
│ Temporal        │──────> localhost:7233
│                 │
│ Stigmer Daemon  │──────> localhost:50051 (gRPC)
│                 │
│ Filesystem      │──────> ./workspace
│                 │
│ Redis           │        (not used)
└─────────────────┘
```

**Key characteristics:**
- Commands execute directly on host via `subprocess`
- Agent workspace: `./workspace` directory
- State/streaming via Stigmer Daemon gRPC
- API key validation relaxed

### Cloud Mode Flow

```
┌─────────────────┐
│ Agent Runner    │
├─────────────────┤
│ MODE=cloud      │
│                 │
│ Temporal        │──────> <cloud-temporal>
│                 │
│ Stigmer Backend │──────> <cloud-backend> (gRPC)
│                 │
│ Daytona Sandbox │──────> Daytona API
│                 │
│ Redis           │──────> <redis-host>:6379
└─────────────────┘
```

**Key characteristics:**
- Commands execute in isolated Daytona containers
- Sandbox managed by Daytona API
- State/streaming via Redis pub/sub
- Full Auth0 JWT validation

## Mode Detection

The agent runner automatically detects execution mode at startup:

```python
# config.py
mode = os.getenv("MODE", "cloud")  # Defaults to cloud if not set

if mode == "local":
    # Local mode initialization
    - Skip Redis
    - Connect to Stigmer Daemon (localhost:50051)
    - Use filesystem sandbox
else:
    # Cloud mode initialization
    - Initialize Redis connection
    - Connect to cloud backend
    - Use Daytona sandbox
```

## Secret Management

### CLI Daemon (Recommended)

When using `stigmer local start`, the daemon handles secret management automatically:

**Security features:**
- ✅ Masked terminal input (password-style)
- ✅ Secrets only in process memory (never written to disk)
- ✅ No plaintext secrets in config files
- ✅ Environment isolation (secrets only visible to agent-runner subprocess)

**How it works:**
1. Daemon checks for `ANTHROPIC_API_KEY` in environment
2. If missing, prompts user with masked input
3. Injects secret into agent-runner subprocess environment
4. Secret exists only in process memory

**Using existing environment variables:**
```bash
# Set API key in your shell
export ANTHROPIC_API_KEY="sk-ant-..."

# Start daemon (no prompt)
stigmer local start
```

### Manual Configuration

If running agent-runner manually (not via daemon), set required secrets in your environment:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."  # If using OpenAI
```

**⚠️ Security Note:** Manual configuration requires you to manage secret security yourself. The CLI daemon approach is more secure for local development.

## Security Considerations

### Local Mode

- **API key validation**: Relaxed (accepts dummy values)
- **Auth0**: Not enforced
- **Execution**: Commands run with your user permissions
- **Filesystem access**: Full host filesystem accessible
- **LLM API Keys**: Managed via CLI daemon (prompting + injection) or manual environment variables
- **Suitable for**: Trusted local development environments only

### Cloud Mode

- **API key validation**: Full Auth0 JWT validation required
- **Auth0**: Token must be valid and non-expired
- **Execution**: Commands run in isolated Daytona containers
- **Filesystem access**: Limited to sandbox
- **Suitable for**: Production deployments

## Troubleshooting

### Connection Failures

**Redis Connection Failed (Cloud Mode)**:
```
❌ Failed to connect to Redis: [Errno 61] Connection refused
```

**Solution**: Ensure Redis is running and `REDIS_HOST`/`REDIS_PORT` are correct.

**Temporal Connection Failed**:
```
❌ Failed to connect to Temporal: Cannot connect to Temporal server
```

**Solution**: Ensure Temporal is running at `TEMPORAL_SERVICE_ADDRESS`.

**Agent-Runner Docker Container Connection Failed (macOS/Windows)**:
```
❌ Failed client connect: Server connection error: 
tonic::transport::Error(Transport, ConnectError(ConnectError(
  "tcp connect error", 127.0.0.1:7233, 
  Os { code: 111, kind: ConnectionRefused, message: "Connection refused" }
)))
```

**Root Cause**: Docker Desktop on macOS and Windows runs in a VM. Containers cannot reach the host via `localhost` even with `--network host`.

**Solution**: The CLI daemon automatically handles this by using `host.docker.internal` on macOS/Windows and `localhost` on Linux. If you see this error:

1. **Check Temporal is running**:
   ```bash
   lsof -ti:7233  # Should return a PID
   ```

2. **Check agent-runner logs**:
   ```bash
   docker logs stigmer-agent-runner --tail 20
   ```

3. **Verify daemon is passing correct address**:
   ```bash
   docker inspect stigmer-agent-runner | grep TEMPORAL_SERVICE_ADDRESS
   # Should show: host.docker.internal:7233 (macOS/Windows)
   # Or: localhost:7233 (Linux)
   ```

4. **Restart Stigmer server** (fixes 99% of cases):
   ```bash
   stigmer server stop
   stigmer server start
   ```

**Note**: This issue was fixed in version 0.3.0+ (January 2026). If using older CLI, upgrade:
```bash
brew upgrade stigmer  # macOS
# or download latest from GitHub releases
```

### Configuration Errors

**Missing Environment Variable**:
```
❌ Failed to load configuration: Missing required environment variable: TEMPORAL_SERVICE_ADDRESS
```

**Solution**: Set all required environment variables for your mode.

### Mode Confusion

**Wrong mode detected**:
- Check `MODE` environment variable is set correctly
- Verify no conflicting env vars (e.g., `ENV` vs `MODE`)
- Check startup banner shows correct mode

## Related Documentation

- **Implementation Details**: See `_changelog/2026-01/2026-01-19-030000-agent-runner-local-cloud-mode-switching.md`
- **Project Documentation**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`
- **ADR**: `_cursor/adr-doc` (Section 2: Configuration & Dependencies)
- **Graphton FilesystemBackend**: For details on how local execution works

## Environment Variable Reference

### MODE vs ENV

**Important distinction:**

- `MODE`: Execution infrastructure (local filesystem vs cloud sandbox)
  - Values: `local`, `cloud`
  - Purpose: Determines which backend infrastructure to use

- `ENV`: Deployment environment (development vs staging vs production)
  - Values: `development`, `staging`, `production`
  - Purpose: Determines configuration profiles

**You can use both together:**
```bash
# Local development
MODE=local ENV=development

# Cloud staging
MODE=cloud ENV=staging

# Cloud production
MODE=cloud ENV=production
```

The `MODE` variable is specifically for this agent runner feature. The `ENV` variable may be used by other Stigmer components for deployment-specific configuration.
