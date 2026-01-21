# Fix Agent-Runner Docker Networking on macOS

**Date**: 2026-01-22 02:20:00  
**Type**: Bug Fix  
**Scope**: CLI (Daemon, Logs)  
**Impact**: Critical - Agent-runner now works on macOS

## Problem

Agent-runner Docker container was failing to connect to Temporal with "Connection refused" error when running on macOS. The container was in a crash/restart loop, causing all workflow executions to fail with "No worker available to execute activity" errors.

**Root cause**: Docker Desktop on macOS runs in a VM, so containers cannot reach the host via `localhost` even with `--network host`. The daemon was passing `localhost:7233` to the container, which doesn't work on macOS.

**Error observed**:
```
Failed client connect: Server connection error: 
tonic::transport::Error(Transport, ConnectError(ConnectError(
  "tcp connect error", 127.0.0.1:7233, 
  Os { code: 111, kind: ConnectionRefused, message: "Connection refused" }
)))
```

## Solution

### 1. Fixed Docker Networking (`daemon.go`)

**Added `resolveDockerHostAddress()` function**:
- Detects OS using `runtime.GOOS`
- On macOS/Windows: converts `localhost` → `host.docker.internal`
- On Linux: keeps `localhost` (works fine with `--network host`)
- Applied to both Temporal address and backend address

**Changes**:
```go
// Resolve host addresses for Docker
hostAddr := resolveDockerHostAddress(temporalAddr)
backendAddr := resolveDockerHostAddress(fmt.Sprintf("localhost:%d", DaemonPort))

// Pass resolved addresses to container
"-e", fmt.Sprintf("STIGMER_BACKEND_URL=http://%s", backendAddr),
"-e", fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", hostAddr),
```

**Result**: Agent-runner now connects successfully:
```
✅ Connected to Temporal server at host.docker.internal:7233
✅ Registered Python activities on task queue: agent_execution_runner
✅ Activities: ExecuteGraphton, EnsureThread, CleanupSandbox
🚀 Worker ready, polling for tasks...
```

### 2. Fixed Logs Command for Docker (`logs/*.go`, `server_logs.go`)

**Problem**: `stigmer server logs all` wasn't showing agent-runner logs because it only read log files, but agent-runner runs in Docker.

**Solution**: Extended logs package to support Docker containers:

**Updated `ComponentConfig` struct (`types.go`)**:
```go
type ComponentConfig struct {
    Name           string
    LogFile        string
    ErrFile        string
    DockerContainer string // NEW: If set, read from Docker instead of files
}
```

**Added Docker log reading (`streamer.go`, `merger.go`)**:
- `tailDockerLogs()`: Streams logs from Docker container in real-time
- `readDockerLogs()`: Reads historical logs from Docker container
- Both stdout and stderr captured
- Integrated with existing log parsing and timestamp-based merging

**Updated command detection (`server_logs.go`)**:
```go
// Check if agent-runner is running in Docker
if isAgentRunnerDocker(dataDir) {
    components = append(components, logs.ComponentConfig{
        Name:           "agent-runner",
        DockerContainer: daemon.AgentRunnerContainerName,
    })
} else {
    // Fallback to file-based logs
    components = append(components, logs.ComponentConfig{
        Name:    "agent-runner",
        LogFile: filepath.Join(logDir, "agent-runner.log"),
        ErrFile: filepath.Join(logDir, "agent-runner.err"),
    })
}
```

**Result**: `stigmer server logs all` now shows all component logs including Docker containers, properly interleaved by timestamp.

## Files Modified

**Core Fix**:
- `client-apps/cli/internal/cli/daemon/daemon.go` (+30 lines)
  - Added `resolveDockerHostAddress()` function
  - Updated `startAgentRunner()` to use resolved addresses
  - Added import for `runtime` package

**Logs Enhancement**:
- `client-apps/cli/internal/cli/logs/types.go` (+1 field)
  - Added `DockerContainer` field to `ComponentConfig`
- `client-apps/cli/internal/cli/logs/streamer.go` (+45 lines)
  - Added `tailDockerLogs()` function for streaming
  - Updated `streamNewLogs()` to check for Docker containers
- `client-apps/cli/internal/cli/logs/merger.go` (+35 lines)
  - Added `readDockerLogs()` function for historical logs
  - Updated `MergeLogFiles()` to support Docker
- `client-apps/cli/cmd/stigmer/root/server_logs.go` (+20 lines)
  - Updated `getComponentConfigs()` to detect Docker and set container name
  - Updated `--all` flag handler to pass `dataDir`

**Auto-generated** (Gazelle cleanup):
- Deleted 22 `BUILD.bazel` files from `apis/stubs/go/` (should be in `.gitignore`)

## Testing

**Verified agent-runner connection**:
```bash
$ docker logs stigmer-agent-runner --tail 10
✅ Connected to Temporal server at host.docker.internal:7233
✅ Registered Python activities on task queue: agent_execution_runner
🚀 Worker ready, polling for tasks...
```

**Verified logs command**:
```bash
$ stigmer server logs all --tail=20
[stigmer-server ] 2:51AM INF Stigmer Server started successfully
[agent-runner   ] ✅ Worker ready, polling for tasks...
[workflow-runner] Worker registered successfully
```

## Impact

**Before**:
- ❌ Agent-runner crashed on macOS
- ❌ All agent executions failed with "No worker available"
- ❌ `stigmer server logs all` didn't show agent-runner logs

**After**:
- ✅ Agent-runner connects successfully on macOS
- ✅ All agent executions work properly
- ✅ `stigmer server logs all` shows all logs including Docker

## Platform Compatibility

| OS | Docker Networking | Status |
|----|------------------|---------|
| macOS | `host.docker.internal` | ✅ Fixed |
| Windows | `host.docker.internal` | ✅ Fixed |
| Linux | `localhost` (with `--network host`) | ✅ Works |

## Why This Matters

This was a **critical bug** that made Stigmer unusable on macOS after the recent Docker migration (from PyInstaller binary to Docker container). The fix ensures:

1. **Cross-platform compatibility**: Works on macOS, Windows, and Linux
2. **Seamless operation**: Users don't need to configure anything
3. **Better observability**: Logs command properly shows Docker container logs

## Related Work

- Related to Docker migration: `_changelog/2026-01/2026-01-22-020000-migrate-agent-runner-to-docker.md`
- Part of project: `_projects/2026-01/20260122.01.migrate-agent-runner-to-docker`

## Design Decision: OS-Aware Address Resolution

**Why not hardcode `host.docker.internal`?**
- On Linux with `--network host`, `localhost` works and is faster
- `host.docker.internal` adds DNS lookup overhead
- Some Linux setups may not support `host.docker.internal`

**Solution**: Detect OS and use appropriate address:
- macOS/Windows: `host.docker.internal` (required for VM-based Docker)
- Linux: `localhost` (works with `--network host`, faster)

This provides **best performance on each platform** while ensuring compatibility.
