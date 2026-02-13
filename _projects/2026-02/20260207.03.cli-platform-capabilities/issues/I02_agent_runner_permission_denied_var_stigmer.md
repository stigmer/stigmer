# Issue: Agent-Runner Permission Denied for /var/stigmer Artifacts Directory

**Date Discovered**: 2026-02-13
**Severity**: High (Blocks all agent executions with attachments)
**Status**: Open - To be fixed in a separate conversation
**Related**: I01_agent_runner_startup_failure_hidden.md

## Summary

When an agent execution processes attachments, the agent-runner container fails with a permission denied error when trying to create the local artifact storage directory at `/var/stigmer/artifacts`. This blocks all agent executions that use file attachments.

## Error Details

```
[Errno 13] Permission denied: '/var/stigmer'
```

Full log context:
```
2026-02-13 12:39:36,248 - worker.storage - INFO - Creating local artifact storage at /var/stigmer/artifacts
2026-02-13 12:39:36,248 - temporalio.activity - ERROR - ExecuteGraphton failed for execution aex-01khbg72yx7rs74ytr74h1vqmn: [Errno 13] Permission denied: '/var/stigmer'
2026-02-13 12:39:36,248 - temporalio.activity - ERROR - ❌ SYSTEM ERROR in ExecuteGraphton for aex-01khbg72yx7rs74ytr74h1vqmn: cannot access local variable 'status_builder' where it is not associated with a value
```

## Secondary Bug: Error Handling

When the permission error occurs, there's a secondary bug in the error handling:
```
cannot access local variable 'status_builder' where it is not associated with a value
```

This is a Python variable scoping issue in the error handling path - the `status_builder` variable is referenced before being assigned when an early exception occurs. This makes debugging harder because the actual root cause (permission denied) is obscured.

## Root Cause Analysis

1. **The agent-runner runs in a Docker container** (`ghcr.io/stigmer/agent-runner:latest`)
2. **Container user doesn't have permission** to create `/var/stigmer/` directory
3. **The artifact storage location** is hardcoded or configured to `/var/stigmer/artifacts`
4. **No volume mount** is provided for this directory in the Docker run command

## Execution Flow That Fails

```
stigmer draft skill --attach file.proto ...
  ↓
skill-creator-agent invoked
  ↓
Agent-runner processes attachments
  ↓
Tries to create /var/stigmer/artifacts
  ↓
Permission denied (container user can't write to /var)
  ↓
Execution fails with cryptic error
```

## Current Agent-Runner Startup

Looking at daemon.go, the container is started with:
```go
docker run ... -v ~/.stigmer/data/workspace:/workspace ...
```

But there's no volume mount for `/var/stigmer/artifacts`.

## Proposed Fixes

### Option 1: Add Volume Mount (Quick Fix)

Add a volume mount for the artifacts directory in the Docker run command:
```bash
docker run ... \
  -v ~/.stigmer/data/artifacts:/var/stigmer/artifacts \
  ...
```

### Option 2: Use Existing Workspace Directory

Configure the artifact storage to use a subdirectory of the already-mounted workspace:
```
/workspace/artifacts  # Already writable since /workspace is mounted
```

This may require changing the storage configuration in:
- `backend/services/agent-runner/worker/storage.py` (or similar)

### Option 3: Fix Container Permissions

Ensure `/var/stigmer` directory exists in the Docker image with proper permissions:
```dockerfile
RUN mkdir -p /var/stigmer/artifacts && chmod 777 /var/stigmer/artifacts
```

### Secondary Fix: Error Handling Bug

Fix the `status_builder` variable scoping issue in the error handling path to properly report the actual error.

## Files to Investigate

- `backend/services/agent-runner/worker/storage.py` - Artifact storage configuration
- `backend/services/agent-runner/Dockerfile` - Container image build
- `client-apps/cli/internal/cli/daemon/daemon.go` - Docker run command
- Error handling in `execute_graphton.py` or related activity code

## How to Reproduce

```bash
# Start server
export ANTHROPIC_API_KEY=<key>
stigmer server start

# Run any draft command with attachments
stigmer draft skill --attach some-file.txt -m "Create a skill"

# Observe the failure
# Check logs: docker logs stigmer-agent-runner
```

## Impact on Current Task

This issue blocked the creation of the agent-drafter skill via `stigmer draft skill`. The skill creation task (T02) is paused until this is resolved.

## Workaround

None currently - the agent-runner cannot process attachments until this is fixed.
