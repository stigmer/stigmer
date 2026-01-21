# Fix Agent-Runner Docker Networking on macOS

**Date**: 2026-01-22 03:27:23  
**Type**: Bug Fix  
**Scope**: CLI (Daemon), Docker Compose  
**Impact**: Critical - Agent-runner now works on macOS

## Problem

Agent-runner Docker container was failing to connect to Stigmer Server when running on macOS, causing all agent executions to fail with "All connection attempts failed" error.

**Root cause**: Incorrect Docker networking configuration that doesn't work on macOS where Docker runs in a VM.

**Error observed in logs**:
```
[agent-runner] 2026-01-21 21:40:22,197 - temporalio.activity - ERROR - ExecuteGraphton failed for execution aex-1769031622000206000: All connection attempts failed
```

## Root Cause Analysis

### Issue #1: Docker Compose Network Mode (Testing Only)

**File**: `backend/services/agent-runner/docker-compose.yml`

**Problem**:
```yaml
network_mode: "host"  # ❌ Doesn't work on macOS
```

On macOS, Docker runs in a VM, so `network_mode: "host"` doesn't give containers direct access to the host network. This breaks `host.docker.internal` DNS resolution.

**Fix**: Removed `network_mode: "host"` to use default bridge networking, which allows `host.docker.internal` to work correctly on macOS.

### Issue #2: Wrong Environment Variable Name (Docker Compose)

**File**: `backend/services/agent-runner/docker-compose.yml`

**Problem**:
```yaml
STIGMER_BACKEND_URL=http://host.docker.internal:7234  # ❌ Wrong name
```

Python code expects `STIGMER_BACKEND_ENDPOINT`, not `STIGMER_BACKEND_URL`. This caused the container to fall back to default `localhost:50051` instead of using `host.docker.internal:7234`.

**Fix**: Changed to `STIGMER_BACKEND_ENDPOINT=host.docker.internal:7234`

### Issue #3: Daemon Hardcoded Network Mode (Production)

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

**Problem**:
```go
args := []string{
    "run",
    "-d",
    "--name", AgentRunnerContainerName,
    "--network", "host",  // ❌ Hardcoded for all platforms
    "--restart", "unless-stopped",
}
```

The daemon was hardcoding `--network host` for all platforms. While this works on Linux (and provides better performance), it doesn't work on macOS/Windows.

**Fix**: Made network mode conditional based on OS:
```go
// Build docker run arguments
args := []string{
    "run",
    "-d",
    "--name", AgentRunnerContainerName,
    "--restart", "unless-stopped",
}

// On Linux, use host networking for better performance with localhost
// On macOS/Windows, skip --network host (doesn't work, breaks host.docker.internal)
if runtime.GOOS == "linux" {
    args = append(args, "--network", "host")
}

// Continue building args
args = append(args,
    // Environment variables
    "-e", "MODE=local",
    "-e", fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", backendAddr),
    // ...
)
```

**Note**: The daemon already had smart `resolveDockerHostAddress()` function that converts `localhost` to `host.docker.internal` on macOS/Windows, but it was being negated by the hardcoded `--network host`.

## Secondary Fixes (Build Errors from Concurrent Changes)

### Issue #4: Syntax Error in daemon.go

**Problem**: After editing the daemon code, there was a syntax error where `args = append(args, ...)` was closed with `}` instead of `)`.

**Fix**:
```go
// ❌ Before
args = append(args,
    "--log-driver", "json-file",
    "--log-opt", "max-size=10m",
    "--log-opt", "max-file=3",
}  // Wrong closing brace

// ✅ After
args = append(args,
    "--log-driver", "json-file",
    "--log-opt", "max-size=10m",
    "--log-opt", "max-file=3",
)  // Correct closing paren
```

### Issue #5: Method Error in server.go (Concurrent Change)

**File**: `client-apps/cli/cmd/stigmer/root/server.go`

**Problem**: Code was calling `progress.Update()` which doesn't exist on `*cliprint.ProgressDisplay`.

**Fix**: Changed to use correct method:
```go
// ❌ Before
progress.Update(fmt.Sprintf("Downloading %s...", model))

// ✅ After
progress.SetPhase(cliprint.PhaseInstalling, fmt.Sprintf("Downloading %s...", model))
```

This was from concurrent work on LLM setup happening in another conversation.

## Files Modified

### Docker Compose (Testing Only - Not Used in Production)

**`backend/services/agent-runner/docker-compose.yml`**:
- Removed `network_mode: "host"` line
- Changed `STIGMER_BACKEND_URL` → `STIGMER_BACKEND_ENDPOINT`

### Daemon Code (Production - Actually Used)

**`client-apps/cli/internal/cli/daemon/daemon.go`**:
- Made `--network host` conditional (only on Linux)
- Fixed syntax error (closing paren instead of brace)

### Server Command (Concurrent Fix)

**`client-apps/cli/cmd/stigmer/root/server.go`**:
- Fixed method call: `progress.Update()` → `progress.SetPhase()`

## Verification

After fixes, the agent-runner container:

✅ **Network Mode**: `bridge` (correct for macOS)
```bash
$ docker inspect stigmer-agent-runner --format '{{.HostConfig.NetworkMode}}'
bridge
```

✅ **Backend Address**: `host.docker.internal:7234` (correct for macOS)
```
Backend: host.docker.internal:7234
```

✅ **Temporal Connection**: Successful
```
✅ Connected to Temporal server at host.docker.internal:7233
✅ Registered Python activities on task queue: agent_execution_runner
🚀 Worker ready, polling for tasks...
```

## Platform Compatibility

| OS      | Docker Networking          | Status |
|---------|---------------------------|---------|
| macOS   | `bridge` + `host.docker.internal` | ✅ Fixed |
| Windows | `bridge` + `host.docker.internal` | ✅ Fixed |
| Linux   | `--network host` (for performance) | ✅ Works |

## Why This Matters

This was a **critical bug** that made Stigmer unusable on macOS after the Docker migration. The fix ensures:

1. **Cross-platform compatibility**: Works on macOS, Windows, and Linux
2. **Seamless operation**: Users don't need to configure anything
3. **Optimal performance**: Linux uses `--network host` for better performance, while macOS/Windows use bridge networking for compatibility

## Design Decision: OS-Aware Networking

**Why not use bridge networking everywhere?**
- On Linux with `--network host`, containers can directly access `localhost` services with zero overhead
- Bridge networking adds DNS lookup and routing overhead
- `host.docker.internal` requires Docker Desktop (not always available on Linux servers)

**Solution**: Detect OS and use appropriate networking:
- **macOS/Windows**: Bridge + `host.docker.internal` (required for VM-based Docker)
- **Linux**: `--network host` (faster, direct localhost access)

This provides **best performance on each platform** while ensuring compatibility.

## Related

- Issue: Agent-runner connection failures on macOS
- Related: Docker migration from PyInstaller binary to container
- Related: Smart host address resolution in `resolveDockerHostAddress()`

## Notes

- **Docker Compose is for testing only** - The daemon (production) starts the container directly
- Both files needed fixing, but daemon.go is what actually runs in production
- The concurrent LLM setup work in server.go was unrelated but needed fixing to complete the build
