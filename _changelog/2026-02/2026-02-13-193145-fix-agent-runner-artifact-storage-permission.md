# Fix Agent-Runner Artifact Storage Permission Error

**Date**: February 13, 2026

## Summary

Fixed a critical permission error that blocked all agent executions with file attachments. The agent-runner container was trying to access artifacts at `/var/stigmer/artifacts`, which didn't exist and couldn't be created. This fix properly mounts the host's artifact directory into the container and aligns the storage paths between stigmer-server and agent-runner. Additionally, fixed a secondary bug where error handling crashed when status_builder was referenced before initialization.

## Problem Statement

When users ran agent commands with attachments (e.g., `stigmer draft skill --attach file.proto`), the execution would fail with a permission denied error. This completely blocked the ability to provide context files to agents, severely limiting functionality.

### Pain Points

- **All agent executions with attachments failed**: Users couldn't provide files as context to agents
- **Cryptic error messages**: The actual permission error was hidden by a secondary bug in error handling
- **Filesystem isolation**: Agent-runner container and stigmer-server were accessing different filesystems with no shared storage
- **Path misalignment**: Storage paths between Go (stigmer-server) and Python (agent-runner) were inconsistent
- **No diagnostic visibility**: Errors only appeared in Docker logs, not in user-facing output

### Error Details

Primary error:
```
[Errno 13] Permission denied: '/var/stigmer'
Artifact not found: attachments/{key}/{filename}
```

Secondary error (masked the primary):
```
cannot access local variable 'status_builder' where it is not associated with a value
```

## Solution

Implemented a three-part fix:

1. **Volume Mount for Artifacts**: Added a Docker volume mount mapping host `~/.stigmer/data/artifacts` to container `/artifacts`
2. **Path Alignment**: Standardized artifact base paths across all components to use `~/.stigmer/data`
3. **Error Handling Fix**: Initialized `status_builder = None` early and added null checks in error handlers

This creates a shared artifact storage location accessible by both stigmer-server (writes) and agent-runner (reads).

## Implementation Details

### 1. CLI Daemon (daemon.go)

Added artifacts directory creation and volume mount:

```go
// Prepare artifacts directory for attachment storage
artifactsDir := filepath.Join(dataDir, "artifacts")
if err := os.MkdirAll(artifactsDir, 0755); err != nil {
    return errors.Wrap(err, "failed to create artifacts directory")
}

// Add to Docker run args
"-e", "LOCAL_ARTIFACT_PATH=/artifacts",
"-e", fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=%s/api/v1/artifacts", backendAddr),
"-v", fmt.Sprintf("%s:/artifacts", artifactsDir),
```

### 2. Stigmer-Server Supervisor (supervisor.go)

Applied identical changes for initial container startup:

```go
// Prepare artifacts directory
artifactsDir := filepath.Join(s.config.DataDir, "artifacts")
if err := os.MkdirAll(artifactsDir, 0755); err != nil {
    return errors.Wrap(err, "failed to create artifacts directory")
}

// Configure agent-runner environment
args = append(args,
    "-e", "LOCAL_ARTIFACT_PATH=/artifacts",
    "-e", fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=%s/api/v1/artifacts", backendAddr),
)

// Mount artifacts volume
args = append(args,
    "-v", fmt.Sprintf("%s:/artifacts", artifactsDir),
)
```

### 3. Stigmer-Server Config (config.go)

Changed default artifact path to avoid double-nesting:

```go
// Old: ~/.stigmer/artifacts
// New: ~/.stigmer/data (storage layer adds /artifacts subdirectory)
func defaultArtifactPath() string {
    home, err := os.UserHomeDir()
    if err != nil {
        return "./"
    }
    return filepath.Join(home, ".stigmer", "data")
}
```

This accounts for the fact that `local_storage.go` automatically creates an `artifacts/` subdirectory under the base path.

### 4. Agent-Runner Error Handling (execute_graphton.py)

Fixed the status_builder scoping bug:

```python
# Initialize early (before try block)
status_builder = None

try:
    # ... existing code ...
    status_builder = StatusBuilder(...)  # Assigned later
    # ...
except Exception as e:
    # Check if status_builder was initialized
    if status_builder is not None:
        # Use status_builder for rich error reporting
        status_builder.current_status.messages.append(error_msg)
        status_builder.finalize_context_info()
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
        failed_status = status_builder.current_status
    else:
        # Early failure - create minimal failed status
        failed_status = AgentExecutionStatus(
            phase=ExecutionPhase.EXECUTION_FAILED,
            error=error_message,
            messages=[error_msg]
        )
```

## Benefits

### User Experience
- **Agent attachments now work**: Users can successfully provide files as context to agents
- **Clear error messages**: When failures occur, users see the actual error instead of a scoping bug
- **Consistent behavior**: All attachment operations work reliably across different startup paths

### System Reliability
- **Filesystem consistency**: Single source of truth for artifact storage location
- **Graceful error handling**: Early failures are reported properly without crashing
- **Better diagnostics**: Errors include context about when status_builder wasn't initialized

### Developer Experience
- **Path alignment**: Go and Python storage implementations now use consistent paths
- **Volume mount pattern**: Clear precedent for sharing filesystem state between host and containers
- **Defensive coding**: Error handlers check for null before dereferencing

## Impact

### Components Affected
- **CLI daemon** (`client-apps/cli/internal/cli/daemon/daemon.go`): Docker container configuration
- **Stigmer-server supervisor** (`backend/services/stigmer-server/pkg/supervisor/supervisor.go`): Initial container startup
- **Stigmer-server config** (`backend/services/stigmer-server/pkg/config/config.go`): Default artifact path
- **Agent-runner activities** (`backend/services/agent-runner/worker/activities/execute_graphton.py`): Error handling

### Users Affected
- **All users with attachments**: Anyone using `stigmer draft skill --attach` or similar commands
- **Local development**: OSS deployments using local artifact storage
- **Agent development**: Developers creating and testing agents that process file inputs

### Validation

End-to-end test confirmed:
```
✓ Artifact upload: test-artifact.proto (40 B)
✓ Artifact storage: ~/.stigmer/data/artifacts/attachments/...
✓ Artifact download: Downloaded 40 bytes from /artifacts/attachments/...
✓ Attachment injection: Successfully injected 1 attachments
```

Container verification:
```bash
# Volume mounts confirmed
docker inspect stigmer-agent-runner --format '{{json .Mounts}}'
# Shows: /Users/suresh/.stigmer/data/artifacts -> /artifacts

# Environment variables confirmed
docker inspect stigmer-agent-runner --format '{{json .Config.Env}}'
# Shows: LOCAL_ARTIFACT_PATH=/artifacts
```

## Architecture Decision

### Why Not Use /workspace/artifacts?

The issue documentation suggested using `/workspace/artifacts` since `/workspace` is already mounted. We chose a separate `/artifacts` mount because:

- **Different semantics**: Workspace is for agent execution sandboxes (temporary, per-execution), while artifacts are for persistent attachment storage (shared across executions)
- **Different retention policies**: Workspace can be cleaned up after execution, artifacts need to persist
- **Cleaner separation of concerns**: Keeps execution state separate from storage state

### Path Structure

The final path structure is:
- **Host**: `~/.stigmer/data/artifacts/attachments/{storage_key}/{filename}`
- **Container**: `/artifacts/attachments/{storage_key}/{filename}`
- **Storage base**: `~/.stigmer/data` (Go) → creates `artifacts/` subdirectory (Go storage layer)
- **Agent-runner base**: `/artifacts` (Python) → directly accesses mounted directory

## Related Work

- **Issue I02**: Agent-Runner Permission Denied for /var/stigmer Artifacts Directory
- **Issue I01**: Agent-Runner Startup Failures Are Hidden from Users (future work)
- **T02**: Create Drafter Skills (was blocked, now unblocked)

## Next Steps

1. ✅ **Verify in production**: Test with cloud deployments using R2 storage
2. ✅ **Documentation**: Update architecture docs with volume mount patterns
3. 📋 **Migration**: Consider cleanup of old `~/.stigmer/artifacts` directory for existing users
4. 📋 **Health checks**: Add artifact directory accessibility checks to startup diagnostics

---

**Status**: ✅ Production Ready
**Timeline**: Single session (4 hours)
**Testing**: End-to-end validated with attachment upload/download flow
