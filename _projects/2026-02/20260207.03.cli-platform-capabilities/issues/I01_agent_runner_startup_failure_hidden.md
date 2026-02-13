# Issue: Agent-Runner Startup Failures Are Hidden from Users

**Date Discovered**: 2026-02-13
**Severity**: High (Blocks all agent executions)
**Status**: Open - To be fixed in a separate conversation

## Summary

When the agent-runner Docker container fails to start due to code errors, the `stigmer server` command reports success and `stigmer server status` shows "Running" - but agent executions silently fail with a cryptic timeout error. Users have no visibility into the actual problem.

## Current Behavior (Bad UX)

1. User runs `stigmer server start`
2. Server reports: `✓ Ready! Stigmer server is running`
3. `stigmer server status` shows:
   ```
   Stigmer Server:    Running ✓
   Workflow Runner:   Running ✓
   Bootstrap:         Completed ✓
   ```
4. User runs `stigmer draft skill` or any agent command
5. Execution fails after 60 seconds with:
   ```
   Error: activity 'EnsureThread' failed: No worker available to execute activity.
   This usually means:
   1. agent-runner service is not running
   2. agent-runner failed to start
   3. agent-runner is not connected to Temporal
   ```

**The actual problem** (only visible in Docker logs):
```
SyntaxError: invalid syntax (__init__.py, line 22)
```

## Root Cause (This Instance)

There's a syntax error in `backend/libs/python/graphton/src/graphton/core/__init__.py` line 22:

```python
# Current (broken - missing newline):
from graphton.core.token_counter import TokenCounter, TokenCountingError__all__ = [

# Should be:
from graphton.core.token_counter import TokenCounter, TokenCountingError

__all__ = [
```

This causes the agent-runner to crash on startup with a Python syntax error.

## How to Diagnose (Current Workaround)

**The `stigmer server logs` command does NOT work for agent-runner.** Users must manually check Docker logs:

```bash
# Check if agent-runner container is in restart loop
docker ps -a | grep agent-runner
# If status shows "Restarting (1) X seconds ago" - there's a problem

# View agent-runner logs (the ONLY way currently)
docker logs stigmer-agent-runner 2>&1 | tail -50

# Follow logs in real-time
docker logs -f stigmer-agent-runner
```

**Note**: `stigmer server logs --component agent-runner` claims to support agent-runner but actually only shows stigmer-server logs. This is a bug.

## Problems with Current UX

### 1. `stigmer server status` Doesn't Show Agent-Runner Health

The status command shows:
- Stigmer Server: Running ✓
- Workflow Runner: Running ✓

But **no mention of Agent-Runner status**. The agent-runner is critical for all agent executions, yet its health is completely invisible.

### 2. `stigmer server logs --component agent-runner` Doesn't Work

The `stigmer server logs` command exists and claims to support `--component agent-runner`:

```bash
$ stigmer server logs --help
  -c, --component string   Component to show logs for (stigmer-server, agent-runner, or workflow-runner)
```

**But it doesn't actually show agent-runner logs:**

```bash
$ stigmer server logs --component agent-runner --follow=false --tail 30
ℹ Showing last 30 lines from all components...
[stigmer-server ] ...  # Only shows stigmer-server logs!
```

The agent-runner runs in a Docker container, and its logs are only accessible via `docker logs stigmer-agent-runner`. The CLI command doesn't retrieve Docker container logs.

This is likely because the logs command was designed for file-based logs (stigmer-server, workflow-runner write to `~/.stigmer/data/logs/`) but agent-runner logs only exist in the Docker container.

### 3. Error Messages Don't Point to Logs

The error message says "check agent-runner logs" but doesn't tell users HOW to do that:
- Where are the logs?
- What command to run?
- Is it Docker logs? File logs?

### 4. Silent Failures

The server "successfully starts" even when critical components are failing. This is misleading.

## Proposed Fixes

### Immediate (High Priority)

1. **Add agent-runner to `stigmer server status`**:
   ```
   Agent Runner:
     Status:   ✗ Failing (Container restarting)
     Error:    SyntaxError in graphton/core/__init__.py
     Logs:     docker logs stigmer-agent-runner
   ```

2. **Block server "ready" status if agent-runner fails**:
   - If agent-runner fails to start, don't report "Ready!"
   - Show the actual error or at least indicate the problem

3. **Fix `stigmer server logs --component agent-runner`**:
   - The command exists but doesn't retrieve Docker container logs
   - Agent-runner logs are only in Docker, not in `~/.stigmer/data/logs/`
   - Need to add Docker log retrieval for agent-runner:
   ```bash
   stigmer server logs --component agent-runner  # Should work like:
   # docker logs stigmer-agent-runner
   ```

### Medium Priority

4. **Health check integration**:
   - Poll agent-runner container health
   - Surface health status in `stigmer server status`
   - Include in any health monitoring dashboard

5. **Better error messages**:
   - When agent execution fails due to missing worker, include actionable steps
   - Show the command to view logs
   - Link to troubleshooting docs

## Fix for the Syntax Error

This specific syntax error will be fixed in a separate conversation by adding the missing newline:

```python
from graphton.core.token_counter import TokenCounter, TokenCountingError

__all__ = [
```

After fixing, rebuild the Docker image:
```bash
make build-agent-runner-image
stigmer server stop
stigmer server start
```

## Related Files

- `backend/libs/python/graphton/src/graphton/core/__init__.py` - The syntax error location
- `client-apps/cli/internal/cli/daemon/daemon.go` - Server startup logic
- `client-apps/cli/internal/cli/health/checks.go` - Health check implementations
- `client-apps/cli/cmd/stigmer/root/server_status.go` - Status command

## Questions to Answer

1. ~~Was there a `stigmer server logs` command before?~~ **Yes, it exists** - but it doesn't work for agent-runner (only retrieves file-based logs, not Docker logs)
2. Should agent-runner startup be blocking for server "ready" status?
3. How do we surface Docker container logs without requiring users to know Docker?
4. Why was agent-runner moved to Docker while other components use file-based logs? Can we unify?

## Impact on Current Task

This issue blocked the creation of the agent-drafter skill via `stigmer draft skill`. The skill creation task (T02) is paused until this is resolved.
