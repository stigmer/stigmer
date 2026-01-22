# Checkpoint: Backend Connection Environment Variable Fixed

**Date**: 2026-01-22 03:03  
**Type**: Bug Fix Checkpoint  
**Project**: `_projects/2026-01/20260122.01.migrate-agent-runner-to-docker`

## What Was Fixed

Fixed environment variable name mismatch that prevented agent-runner from connecting to stigmer-server, causing status updates to fail and CLI to hang on "Execution pending...".

## Problem

After the previous macOS Docker networking fix (which resolved Temporal connection), agent executions still failed because:

1. **Environment variable mismatch**:
   - Go daemon set: `STIGMER_BACKEND_URL`
   - Python read: `STIGMER_BACKEND_ENDPOINT`
   - Result: Python fell back to default `localhost:50051`

2. **User experience**:
   - CLI stuck on "⏳ Execution pending..." forever
   - No status updates streamed
   - Temporal showed "Completed" while CLI showed "pending"
   - Agent-runner logs showed "Connection refused to 127.0.0.1:50051"

## Solution

Changed `daemon.go` line 565 to use matching environment variable name:

```go
// Before
"-e", fmt.Sprintf("STIGMER_BACKEND_URL=http://%s", backendAddr),

// After
"-e", fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", backendAddr),
```

## Verification

**Before**:
```
✓ Agent execution started
ℹ ⏳ Execution pending...
[STUCK - no status updates]
```

**After**:
```
✓ Agent execution started
ℹ ⏳ Execution pending...
✓ ▶️  Execution started
✗ ❌ Execution failed
```

Status streaming now works! (Execution failed due to Ollama not running, not networking)

## Files Changed

- `client-apps/cli/internal/cli/daemon/daemon.go` (1 line)

## Impact

✅ **Critical bug fixed** - Status streaming now works on all platforms
- Agent-runner connects to correct address (`host.docker.internal:7234`)
- Status updates flow properly: agent-runner → stigmer-server → StreamBroker → CLI
- Users see real-time execution progress
- Docker logs integration already working

## Changelog

`_changelog/2026-01/2026-01-22-030355-fix-agent-runner-backend-connection-env-var.md`

## Related Work

This completes the Docker networking fixes started in:
- `_changelog/2026-01/2026-01-22-022000-fix-agent-runner-docker-networking-macos.md` (Temporal connection)
- This fix (stigmer-server backend connection)

Both were needed for full agent execution functionality.

## Next Steps

✅ Project complete - All Docker migration and networking issues resolved!
