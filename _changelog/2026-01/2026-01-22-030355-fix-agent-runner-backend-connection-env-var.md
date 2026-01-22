# Fix Agent-Runner Backend Connection - Environment Variable Mismatch

**Date**: 2026-01-22 03:03:55  
**Type**: Bug Fix  
**Scope**: CLI (Daemon)  
**Impact**: Critical - Fixes agent-runner connection to stigmer-server on all platforms

## Problem

Agent execution status updates were not streaming to CLI, causing executions to appear stuck on "⏳ Execution pending..." indefinitely. When checking Temporal UI, workflows showed "Completed" while CLI still showed "pending".

**Root Cause**: Environment variable name mismatch between Go daemon and Python agent-runner:
- **Daemon sets**: `STIGMER_BACKEND_URL=http://host.docker.internal:7234`
- **Python reads**: `STIGMER_BACKEND_ENDPOINT` (defaults to `localhost:50051` if not set)
- **Result**: Agent-runner tried to connect to wrong address (`localhost:50051` instead of `host.docker.internal:7234`)

**Error manifestation**:
```
ERROR - ExecuteGraphton failed:
  ipv4:127.0.0.1:50051: Failed to connect to remote host: connect: Connection refused (111)
```

**Impact on user experience**:
1. CLI showed "⏳ Execution pending..." forever (no status updates received)
2. Agent-runner couldn't send status updates via gRPC (connection refused)
3. StreamBroker never received updates to broadcast to CLI
4. Temporal workflow completed successfully but CLI never knew
5. Users had no visibility into execution progress

## Solution

Changed environment variable name in daemon to match what Python agent-runner expects:

```go
// Before (wrong variable name)
"-e", fmt.Sprintf("STIGMER_BACKEND_URL=http://%s", backendAddr),

// After (correct variable name)
"-e", fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", backendAddr),
```

**Why this fix works**:
- Python's `Config.load_from_env()` reads `STIGMER_BACKEND_ENDPOINT` (line 313 in `worker/config.py`)
- Go daemon now sets the variable Python actually reads
- Agent-runner connects to correct address: `host.docker.internal:7234`
- Status updates flow properly: agent-runner → stigmer-server → StreamBroker → CLI

## Files Modified

**Core Fix**:
- `client-apps/cli/internal/cli/daemon/daemon.go` (1 line changed)
  - Line 565: Changed `STIGMER_BACKEND_URL` to `STIGMER_BACKEND_ENDPOINT`

## Verification

**Before the fix**:
```
$ stigmer run pr-reviewer
✓ Agent execution started: pr-reviewer
✓ Streaming agent execution logs
ℹ ⏳ Execution pending...
[STUCK HERE FOREVER - no status updates]
```

**After the fix**:
```
$ stigmer run pr-reviewer
✓ Agent execution started: pr-reviewer
✓ Streaming agent execution logs
ℹ ⏳ Execution pending...
✓ ▶️  Execution started
✗ ❌ Execution failed
```

**Agent-runner logs showing successful connection**:
```
2026-01-21 21:32:45 - INFO - ExecuteGraphton started
2026-01-21 21:32:45 - INFO - 📤 Sending status update
2026-01-21 21:32:45 - INFO - ✅ Status update sent successfully
```

**Docker container has correct environment**:
```bash
$ docker inspect stigmer-agent-runner --format '{{range .Config.Env}}{{println .}}{{end}}' | grep BACKEND
STIGMER_BACKEND_ENDPOINT=host.docker.internal:7234
```

## Impact

**Severity**: Critical - System was non-functional for agent executions

**Before**:
- ❌ Agent executions appeared to hang indefinitely
- ❌ No status updates streamed to CLI
- ❌ Users couldn't see execution progress
- ❌ Agent-runner logs showed connection errors
- ❌ Required checking Temporal UI to see actual status

**After**:
- ✅ Status updates stream properly to CLI
- ✅ Users see real-time execution progress
- ✅ Agent-runner connects successfully to stigmer-server
- ✅ StreamBroker broadcasts updates
- ✅ Full visibility into execution lifecycle

## Platform Compatibility

This fix works on all platforms:
- ✅ macOS: Agent-runner connects via `host.docker.internal:7234`
- ✅ Windows: Agent-runner connects via `host.docker.internal:7234`
- ✅ Linux: Agent-runner connects via `localhost:7234` (with `--network host`)

The `resolveDockerHostAddress()` function (added in previous fix) already handles platform-specific address resolution.

## Debugging Notes

**How this was discovered**:
1. User reported CLI stuck on "Execution pending..."
2. Checked Temporal UI: Workflow showed "Completed"
3. Checked agent-runner Docker logs: "Connection refused to 127.0.0.1:50051"
4. Realized agent-runner was trying wrong address
5. Checked what env var Python reads: `STIGMER_BACKEND_ENDPOINT`
6. Checked what Go sets: `STIGMER_BACKEND_URL` ← **MISMATCH**
7. Fixed variable name, rebuilt CLI, restarted server
8. Status streaming now works

**Key lesson**: When integrating Go and Python services, always verify environment variable names match exactly between writer and reader. Silent fallbacks to defaults can hide configuration mismatches.

## Related Work

- Related to Docker networking fix: `_changelog/2026-01/2026-01-22-022000-fix-agent-runner-docker-networking-macos.md`
- That fix resolved Temporal connection (`host.docker.internal:7233`)
- This fix resolves stigmer-server connection (`host.docker.internal:7234`)
- Both were needed for full agent execution functionality

## Design Decision: Environment Variable Naming Convention

**Why not change Python to match Go's variable name?**

Python's `Config.load_from_env()` is the established convention used throughout the agent-runner codebase. Changing it would require:
1. Updating all references in Python code
2. Updating documentation
3. Potential breaking changes for users with custom configurations

**Better approach**: Fix Go to match Python's established convention.

**Future prevention**: When adding cross-language environment variables:
1. Check what the consumer expects before setting in provider
2. Use consistent naming conventions (e.g., `STIGMER_*_ENDPOINT` vs `STIGMER_*_URL`)
3. Test with actual deployment, not just unit tests
4. Document expected environment variables in both codebases
