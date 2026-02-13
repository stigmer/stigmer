---
name: Agent-Runner UX Fix
overview: Improve visibility of agent-runner health status in the Stigmer CLI by ensuring the status command always shows agent-runner state (including restart loops), and making error messages actionable with clear instructions for viewing logs.
todos:
  - id: unified-detection
    content: Create unified agent-runner status detection in daemon package with fallback logic
    status: completed
  - id: restart-loop-detection
    content: Enhance DockerContainerHealthCheck to detect restart loops and capture last error
    status: completed
  - id: always-show-status
    content: Modify status command to always show agent-runner section with appropriate state
    status: completed
  - id: actionable-messages
    content: Add log viewing commands to unhealthy status output
    status: completed
  - id: update-logs-command
    content: Refactor logs command to use shared detection helper
    status: completed
  - id: test-scenarios
    content: "Test all scenarios: crash loop, missing container, healthy state"
    status: completed
isProject: false
---

# Fix Agent-Runner Startup Failures Hidden from Users

## Problem Summary

When the agent-runner Docker container fails to start (e.g., due to code errors), users have no visibility into the problem. The `stigmer server status` command shows agent-runner **only when the container ID file exists**, and doesn't detect container restart loops. Error messages don't tell users how to view logs.

## Root Causes Identified

1. **Conditional Status Display**: Agent-runner status only shown if `daemon.GetAgentRunnerContainerID()` succeeds (requires non-empty container ID file)
2. **Missing Restart Loop Detection**: Current health check only fails if container is explicitly "unhealthy" - doesn't detect restart loops
3. **Non-Actionable Error Messages**: When failures occur, messages say "check agent-runner logs" but don't explain HOW

## Implementation Plan

### 1. Always Show Agent-Runner Status

**File**: [client-apps/cli/cmd/stigmer/root/server.go](client-apps/cli/cmd/stigmer/root/server.go)

Currently (lines 269-272):

```go
if containerID, err := daemon.GetAgentRunnerContainerID(dataDir); err == nil {
    showAgentRunnerStatus(healthSummary["agent-runner"], containerID)
}
```

Change to:

- Always display the agent-runner section
- Add fallback to `docker ps` if container ID file missing
- Show "Not Running" state with helpful message when container not found
- Unify detection logic with logs command's `isAgentRunnerDocker()`

### 2. Detect Container Restart Loops

**File**: [client-apps/cli/internal/cli/health/checks.go](client-apps/cli/internal/cli/health/checks.go)

Enhance `DockerContainerHealthCheck` (lines 96-133) to detect:

- `{{.State.Restarting}}` - container currently restarting
- `{{.RestartCount}}` - high restart count indicates crash loop
- `{{.State.ExitCode}}` - non-zero indicates failure
- `{{.State.FinishedAt}}` - recent finish time with high restart count = crash loop

Add new helper function `GetDockerContainerExtendedStatus()` that returns:

- Running state
- Restart count
- Restarting flag
- Last exit code
- Last error from `docker logs --tail 3`

### 3. Show Restart Count and Last Error in Status

**File**: [client-apps/cli/cmd/stigmer/root/server.go](client-apps/cli/cmd/stigmer/root/server.go)

Update `createBasicHealthStatus()` (lines 330-368) to:

- Fetch extended container status including restart count
- Detect crash loops (restarting + recent crash + high restart count)
- Capture last error from container logs
- Set state to "unhealthy" when in restart loop

Update `showAgentRunnerStatus()` (lines 403-430) to:

- Display Docker restart count (different from internal restart tracking)
- Show last error message when unhealthy
- Include actionable log viewing command

### 4. Actionable Error Messages

When agent-runner is unhealthy, show:

```
Agent Runner (Docker):
  Status:    Unhealthy (Restarting) ✗
  Container: abc123def456
  Restarts:  15 (crash loop detected)
  Last Error: SyntaxError: invalid syntax (__init__.py, line 22)
  
  View logs: stigmer server logs --component agent-runner
        or:  docker logs stigmer-agent-runner
```

### 5. Unify Detection Logic

**File**: [client-apps/cli/cmd/stigmer/root/server_logs.go](client-apps/cli/cmd/stigmer/root/server_logs.go)

Extract `isAgentRunnerDocker()` (lines 368-380) into a shared helper in the daemon package so both status and logs commands use identical detection logic.

**New file**: [client-apps/cli/internal/cli/daemon/agent_runner.go](client-apps/cli/internal/cli/daemon/agent_runner.go) (or add to existing daemon.go)

```go
// GetAgentRunnerStatus returns the agent-runner container status
// Uses container ID file with docker ps fallback
func GetAgentRunnerStatus(dataDir string) (*AgentRunnerStatus, error) {
    // Try container ID file first
    // Fall back to docker ps by name
    // Return status including container ID, running state, restart count, etc.
}
```

## Files to Modify


| File                                              | Changes                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `client-apps/cli/internal/cli/health/checks.go`   | Add restart loop detection, extended status helper                  |
| `client-apps/cli/cmd/stigmer/root/server.go`      | Always show agent-runner, display restart info, actionable messages |
| `client-apps/cli/internal/cli/daemon/daemon.go`   | Add unified agent-runner status helper                              |
| `client-apps/cli/cmd/stigmer/root/server_logs.go` | Use shared detection helper                                         |


## Testing Approach

1. **Simulate crash loop**: Start server with intentional Python syntax error, verify status shows "Unhealthy" with restart count
2. **Missing container**: Stop agent-runner, remove ID file, verify status shows "Not Running" (not blank)
3. **Healthy state**: Normal startup, verify status shows "Running" with restart count 0
4. **Logs command**: Verify `stigmer server logs --component agent-runner` works in all scenarios

## What This Does NOT Change

- Server startup blocking behavior (per user preference)
- The underlying Python syntax error (separate fix)
- How agent-runner is started or managed
- The health monitoring background process

