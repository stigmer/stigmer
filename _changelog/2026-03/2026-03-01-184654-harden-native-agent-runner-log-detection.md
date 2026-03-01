# Harden Native Agent-Runner Log Mode Detection

**Date**: March 1, 2026

## Summary

Rewrote `IsAgentRunnerDocker()` to eliminate an unnecessary Docker exec on every `stigmer server logs` call when running in native mode. The function now reads `startup-config.json` as the authoritative mode source, with a PID-first marker file fallback, achieving zero Docker dependency in the log streaming path.

## Problem Statement

The `IsAgentRunnerDocker()` function in `daemon.go` — used by the `stigmer server logs` command to decide between file-based and Docker log streaming — contained a design flaw that directly contradicted the native agent-runner migration's goal of eliminating Docker as a requirement.

### Pain Points

- Every `stigmer server logs` call in native mode shelled out to `docker ps -aq` as a fallback, adding latency and requiring Docker to be installed
- The detection order was inconsistent: `health_integration.go` correctly checked PID files first, while `IsAgentRunnerDocker` checked container ID files first
- A stale `agent-runner-container.id` file from a previous Docker-mode run could cause incorrect mode detection after switching to native mode

## Solution

Rewrote `IsAgentRunnerDocker()` with a three-tier detection strategy that never execs Docker:

1. **Authoritative**: Read `startup-config.json` `AgentRunnerMode` field (set at startup time by T01.4)
2. **Fallback**: Check marker files in PID-first order (consistent with `health_integration.go`)
3. **Default**: Return `false` — file-based log lookup handles missing files gracefully

## Implementation Details

### Changed File

- `client-apps/cli/internal/cli/daemon/daemon.go` — `IsAgentRunnerDocker()` rewritten (~15 lines net)

### New File

- `client-apps/cli/internal/cli/daemon/is_agent_runner_docker_test.go` — 10 unit tests

### Detection Priority (Before vs After)

**Before:**
1. Check `agent-runner-container.id` file → Docker
2. Exec `docker ps -aq -f name=^stigmer-agent-runner$` → Docker if found
3. Default: not Docker

**After:**
1. Read `startup-config.json` `AgentRunnerMode` → authoritative answer
2. Check `agent-runner.pid` → not Docker (native signal)
3. Check `agent-runner-container.id` → Docker
4. Default: not Docker

### Test Coverage

| Test | Scenario |
|------|----------|
| `StartupConfigNative` | Config says native → false |
| `StartupConfigDocker` | Config says docker → true |
| `StartupConfigOverridesStaleContainerID` | Native config + stale container ID → false |
| `StartupConfigOverridesStalePID` | Docker config + stale PID → true |
| `PIDFileOnly` | No config, PID file → false |
| `ContainerIDFileOnly` | No config, container ID file → true |
| `BothMarkers_PIDWins` | No config, both markers → false (PID wins) |
| `NoMarkersNoConfig` | Empty directory → false |
| `EmptyModeInConfig` | Config with empty mode → falls through to markers |
| `EmptyModeWithContainerID` | Empty mode + container ID → true |

## Benefits

- **Zero Docker dependency** in the log mode detection path — `stigmer server logs` no longer requires Docker to be installed when running in native mode
- **Consistent detection logic** across the codebase — matches `health_integration.go` PID-first pattern
- **Resilient to stale state** — startup config overrides leftover marker files from mode switches
- **Faster log command** — eliminates a `docker ps` subprocess on every invocation

## Impact

- **Users**: `stigmer server logs` works instantly in native mode without Docker Desktop installed or running
- **Developers**: Detection logic is now documented, tested, and consistent across the daemon package
- **Migration**: Removes another implicit Docker dependency from the native agent-runner path

## Related Work

- T01.4: Native agent-runner process mode (`d9b97f24`)
- T01.2: Python runtime manager (`abe9b318`)
- T01.1: Runtime filesystem layout design (DD-01)
- T01.6: End-to-end validation (next)

---

**Status**: Production Ready
**Timeline**: Part of Phase 1 — Native Agent-Runner Migration
