# Complete Daemon Architecture with Port 7234 and Workflow-Runner

**Date**: 2026-01-20  
**Type**: Architecture + Feature  
**Impact**: Major - Complete local daemon with all components

## Summary

Completed the local daemon architecture with:
1. ✅ stigmer-server (port **7234**) - Main gRPC API
2. ✅ Temporal (port **7233**) - Workflow orchestration  
3. ✅ workflow-runner (Temporal worker, no port) - Zigflow execution
4. ✅ agent-runner (Temporal worker, no port) - AI agent execution

## Problem

The local daemon was incomplete:
- ❌ Port mismatch (8080 vs 50051)
- ❌ No standard Stigmer port number
- ❌ workflow-runner not managed by daemon
- ❌ Workflows couldn't execute (no worker running)

## Solution

### 1. Standardized Port: 7234

**Why 7234?**
- Temporal uses port 7233 (gRPC) and 8233 (UI)
- Stigmer now uses **7234** (Temporal + 1)
- Clear relationship between Temporal and Stigmer
- In the "distributed systems" port range (7000s)

**Port allocation:**
```
7233 - Temporal gRPC
7234 - Stigmer Server ← NEW!
8233 - Temporal UI
```

### 2. Complete Worker Architecture

```
┌─────────────────────────────────────────┐
│       LOCAL DAEMON (stigmer server)     │
├─────────────────────────────────────────┤
│                                         │
│  Temporal           (port 7233)        │  ← Orchestration
│      ↓                                  │
│  stigmer-server     (port 7234)        │  ← Main gRPC API
│      ↓                                  │
│  ┌──────────────────────────────────┐  │
│  │ TEMPORAL WORKERS (no ports):     │  │
│  │                                  │  │
│  │  workflow-runner                │  │  ← Zigflow workflows
│  │  agent-runner                   │  │  ← AI agent execution
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

### 3. Workflow-Runner Integration

Added workflow-runner to daemon in **temporal mode only**:
- No gRPC server (that's only for dev/testing)
- Pure Temporal worker
- Executes Zigflow workflows
- Started automatically with daemon

## Files Changed

### CLI Daemon
**`client-apps/cli/internal/cli/daemon/daemon.go`:**
- Changed `DaemonPort` from 50051 → **7234**
- Added `WorkflowRunnerPIDFileName` constant
- Added `startWorkflowRunner()` function
- Added `stopWorkflowRunner()` function
- Added `findWorkflowRunnerBinary()` function
- Updated startup sequence to start workflow-runner
- Updated shutdown sequence to stop workflow-runner
- Environment variables for workflow-runner:
  - `EXECUTION_MODE=temporal` (worker only, no gRPC)
  - `TEMPORAL_SERVICE_ADDRESS=localhost:7233`
  - `STIGMER_BACKEND_ENDPOINT=localhost:7234`

### Server Config
**`backend/services/stigmer-server/pkg/config/config.go`:**
- Changed default `GRPCPort` from 8080 → **7234**
- Added comment explaining port choice

## Daemon Startup Sequence

```
1. Load configuration
2. Start managed Temporal (if configured)
   ↓ Port 7233
3. Start stigmer-server
   ↓ Port 7234
4. Wait 500ms for server startup
5. Start workflow-runner (temporal worker)
   ↓ No port (Temporal worker)
6. Start agent-runner (temporal worker)
   ↓ No port (Temporal worker)
```

## Daemon Shutdown Sequence

```
1. Stop workflow-runner (SIGTERM, 5s timeout)
2. Stop agent-runner (SIGTERM, 5s timeout)
3. Stop managed Temporal
4. Stop stigmer-server (SIGTERM, 10s timeout)
```

## Log Files

All components now have dedicated log files in `~/.stigmer/data/logs/`:

```
daemon.log             ← stigmer-server stdout
daemon.err             ← stigmer-server stderr
workflow-runner.log    ← workflow-runner stdout (NEW!)
workflow-runner.err    ← workflow-runner stderr (NEW!)
agent-runner.log       ← agent-runner stdout
agent-runner.err       ← agent-runner stderr
temporal.log           ← Temporal server logs
```

## PID Files

All components tracked in `~/.stigmer/data/`:

```
daemon.pid             ← stigmer-server PID
workflow-runner.pid    ← workflow-runner PID (NEW!)
agent-runner.pid       ← agent-runner PID
```

## Usage

### Start Everything

```bash
# Start the complete daemon
stigmer server

# Check status
stigmer server status

# View logs
stigmer server logs                          # stigmer-server
stigmer server logs -c workflow-runner       # workflow-runner
stigmer server logs -c agent-runner          # agent-runner
```

### Execute Workflows

Now workflows will actually run!

```bash
# This now works end-to-end:
stigmer apply

# Flow:
# 1. CLI → stigmer-server (port 7234)
# 2. stigmer-server → Temporal workflow
# 3. Temporal → workflow-runner worker
# 4. workflow-runner executes Zigflow workflow
# 5. Results returned
```

## Environment Variables

Users can override defaults:

```bash
# Override stigmer-server port
export GRPC_PORT=9999

# Point to custom workflow-runner binary
export STIGMER_WORKFLOW_RUNNER_BIN=/path/to/workflow-runner

# Point to custom agent-runner script
export STIGMER_AGENT_RUNNER_SCRIPT=/path/to/run.sh
```

## Auto-Build Support

If binaries not found, daemon will attempt to build them:

```bash
# Daemon will try:
go build -o ~/bin/stigmer-server ./backend/services/stigmer-server/cmd/server
go build -o ~/bin/workflow-runner ./backend/services/workflow-runner
```

## Migration Notes

**For existing users:**

If you have stigmer-server running on 8080:
1. Stop the old daemon: `stigmer server stop`
2. Rebuild: `make build` or `make release-local`
3. Start fresh: `stigmer server`

Logs from old port will remain but daemon will use 7234.

## Testing

```bash
# Build all components
make release-local

# Start daemon
stigmer server

# Check all components running
stigmer server status

# View each component's logs
stigmer server logs                    # stigmer-server
stigmer server logs -c workflow-runner # workflow-runner  
stigmer server logs -c agent-runner    # agent-runner

# Test workflow execution
stigmer apply
```

## What This Enables

**Before:**
- ❌ Incomplete daemon
- ❌ Workflows couldn't execute
- ❌ Port confusion (8080? 50051?)
- ❌ Manual component management

**After:**
- ✅ Complete zero-config daemon
- ✅ Workflows execute automatically
- ✅ Standard port (7234)
- ✅ All components auto-managed

## Architecture Benefits

1. **Single port for users**: Only stigmer-server exposes a port (7234)
2. **Workers are invisible**: workflow-runner and agent-runner are internal
3. **Clean separation**: API layer vs execution layer
4. **Zero config**: Just `stigmer server` and everything works
5. **Logs for everything**: Easy debugging with `stigmer server logs`

## Next Steps

With this complete architecture:
- ✅ All components managed
- ✅ Port standardized
- ✅ Logs accessible
- 🚀 Ready for full workflow execution
- 🚀 Ready for AI agent execution

---

## Quick Reference

**Ports:**
- 7233 - Temporal gRPC
- 7234 - Stigmer Server
- 8233 - Temporal UI

**Commands:**
```bash
stigmer server              # Start everything
stigmer server status       # Check status
stigmer server logs         # View stigmer-server logs
stigmer server logs -c workflow-runner  # View workflow-runner logs
stigmer server logs -c agent-runner     # View agent-runner logs
stigmer server stop         # Stop everything
```

**Log locations:**
- `~/.stigmer/data/logs/daemon.{log,err}`
- `~/.stigmer/data/logs/workflow-runner.{log,err}`
- `~/.stigmer/data/logs/agent-runner.{log,err}`

---

*"A complete architecture with standard ports, managed workers, and observable logs. That's the foundation we need."*
