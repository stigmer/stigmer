# Native Agent-Runner Process Mode (T01.4)

**Date**: March 1, 2026

## Summary

Implemented native OS process mode for agent-runner, enabling it to run as a host process backed by a hermetic CPython runtime instead of requiring Docker. This is Phase 1 of eliminating Docker Desktop as a prerequisite for the Stigmer platform, bringing agent-runner to parity with stigmer-server and workflow-runner as a native daemon process.

## Problem Statement

Agent-runner required Docker Desktop to be installed and running, creating friction for new users and causing alarming warnings about sharing the home directory with containers. Docker also added startup latency, resource overhead, and complexity to the development workflow.

### Pain Points

- Docker Desktop required as a prerequisite for all Stigmer users
- Home directory mount warning scared users: "Are you sure you want to share /Users/x?"
- ~5-10 second startup overhead per container lifecycle
- Docker networking complexity (`host.docker.internal` resolution)
- Environment variable mismatch: Docker mode passed `WORKSPACE_ROOT` but Python code reads `SANDBOX_ROOT_DIR`

## Solution

Added a dual-path execution model where agent-runner can start as either a native OS process (backed by python-build-standalone + venv from T01.2) or a Docker container. Mode is configurable via env var, config file, or auto-detection.

## Implementation Details

### New Packages

- **`embedded/agentrunner/`**: Provides agent-runner Python source as `io/fs.FS` with build-tagged resolution (dev mode: repo tree walk; production: `//go:embed`)
- **`daemon/agent_runner_native.go`**: Native startup, env var construction, viability probe

### Modified Packages

- **`pythonrt/manager.go`**: `AppSourceFS` field for embedding Python app source, `AppDir()` method, extraction during bootstrap
- **`config/config.go`**: `AgentRunnerConfig` with 3-tier mode resolution (env var > config file > "auto" default)
- **`daemon/daemon.go`**: Mode dispatch in `StartWithOptions()`, split into `startAgentRunnerNative()`/`startAgentRunnerDocker()`, refactored stop/cleanup for PID+Docker dual support, startup config persistence
- **`daemon/health_integration.go`**: Mode-aware health checks and restart logic
- **`supervisor/supervisor.go`**: Minimal 3-line guard to skip agent-runner when daemon manages it natively

### Key Design Decision: Auto Mode Viability Probe

In "auto" mode, the daemon probes native viability *before* starting stigmer-server. This determines whether to pass `STIGMER_SKIP_AGENT_RUNNER=true` to the server environment, preventing the supervisor from starting a Docker container that would conflict with the native process.

### Environment Variable Fix

Native mode correctly passes `SANDBOX_ROOT_DIR` (which the Python code reads) instead of `WORKSPACE_ROOT` (which Docker mode used but only worked by accident due to mount semantics).

## Benefits

- No Docker Desktop required for core Stigmer functionality
- Faster agent-runner startup (no container lifecycle overhead)
- Simpler networking (localhost instead of host.docker.internal)
- Correct environment variable mapping (SANDBOX_ROOT_DIR)
- Docker retained as configurable fallback for compatibility
- Clean separation: native stop uses PID + SIGTERM/SIGKILL, Docker stop uses container ID

## Impact

- **Users**: Can run `stigmer server start` without Docker Desktop installed
- **Developers**: Native mode is default in "auto"; Docker fallback transparent
- **Architecture**: Daemon now owns agent-runner lifecycle in native mode; supervisor handles Docker mode

## Related Work

- T01.2: Python runtime manager (`pythonrt` package) — prerequisite
- T01.3: Wheelhouse build pipeline — enables offline dep installation (future)
- WA-01: Dual lifecycle concern documented for Phase 3 investigation
- DD-01-A: Runtime layout amended with `app/` directory

---

**Status**: Production Ready (with network-based pip install; air-gapped mode after T01.3)
**Timeline**: T01.4 implementation session
