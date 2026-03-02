# Consolidate Lifecycle Management: Single Long-Lived Daemon

**Date**: March 1, 2026

## Summary

Resolved the dual lifecycle management problem (WA-01) by consolidating two competing component management systems into a single long-lived daemon process. The supervisor package inside stigmer-server was removed entirely, all Docker agent-runner code was eliminated, and a new `stigmer internal-daemon` background process now serves as the exclusive lifecycle owner for stigmer-server, workflow-runner, and agent-runner — with built-in health monitoring and auto-restart.

## Problem Statement

Two independent systems managed the same components with conflicting behavior:

1. **CLI daemon** (`client-apps/cli/internal/cli/daemon/`) — started components as an ephemeral process, then exited. No ongoing health monitoring.
2. **Supervisor** (`backend/services/stigmer-server/pkg/supervisor/`) — ran inside stigmer-server, independently starting and monitoring the same components.

### Pain Points

- **Competing ownership**: Both systems started agent-runner and workflow-runner independently, risking double-starts
- **Conflicting state files**: Daemon used `agent-runner-container.id`, supervisor used `agent-runner.containerid` — neither could detect what the other started
- **Health monitoring gap**: Native agent-runner (the new mode) had zero health monitoring — the daemon exited after starting it, and the supervisor only handled Docker containers
- **Docker-only status/logs**: `stigmer server status` and `stigmer server logs` were hardcoded to Docker container inspection
- **~1,300+ lines of dead/duplicate code**: health_integration.go was entirely unreachable, Docker functions were legacy

## Solution

Made the daemon a real long-lived background process — the standard Unix daemon pattern (systemd, supervisord, launchd). The foreground CLI (`stigmer server start`) does interactive setup, spawns the daemon, and exits. The daemon starts all children, monitors their health, and auto-restarts crashed components.

## Implementation Details

### New Architecture

```
stigmer server start (foreground)
  ├── load config, resolve secrets
  ├── start Temporal
  ├── bootstrap Python runtime (user sees progress)
  ├── spawn "stigmer internal-daemon" (background, detached)
  └── exit(0)

stigmer internal-daemon (long-lived background)
  ├── start stigmer-server
  ├── start workflow-runner
  ├── start agent-runner (native)
  ├── health monitor loop (every 5s)
  │   ├── check PIDs via Signal(0)
  │   ├── restart crashed components
  │   └── write health-state.json atomically
  └── SIGTERM handler → graceful shutdown
```

### Key Files Changed

| File | Change |
|------|--------|
| `daemon/daemon_process.go` | New: long-lived daemon with health monitoring, signal handling, atomic health-state.json writes |
| `daemon/daemon.go` | Refactored: StartWithOptions bootstraps Python, spawns daemon; Stop sends SIGTERM to daemon |
| `supervisor/` | Deleted entirely (~580 lines) |
| `daemon/health_integration.go` | Deleted entirely (~520 lines of dead code) |
| `server/server.go` | Removed supervisor integration |
| `root/server_status.go` | Rewritten to read health-state.json |
| `root/server_logs.go` | Simplified to file-only streaming |
| `logs/streamer.go`, `merger.go`, `types.go` | Removed Docker branches |
| `health/checks.go` | Removed DockerContainerHealthCheck |
| `config/config.go` | Removed AgentRunnerMode, AgentRunnerConfig |
| `daemon/reset.go` | Removed Docker container cleanup |
| `daemon/startup_config.go` | Simplified (no mode/container fields) |

### Metrics

- **25 files changed**
- **~3,400 lines removed** (supervisor, health_integration.go, Docker agent-runner code, mode plumbing)
- **~350 lines added** (daemon_process.go, internal-daemon command)
- **Net: ~3,050 lines removed**

## Benefits

- **Single lifecycle owner**: No competing systems, no state conflicts, no double-starts
- **Health monitoring for ALL components**: Including native agent-runner, which previously had none
- **Auto-restart**: Crashed components restart automatically (up to threshold)
- **Simpler codebase**: ~3,000 lines of dead/duplicate/Docker code eliminated
- **stigmer-server is a pure backend service**: No child process management responsibility
- **Uniform status/logs**: All components displayed and streamed the same way — no Docker special cases

## Impact

- **Developers**: `stigmer server start/stop/status/logs` commands work the same but with better reliability
- **Codebase maintainers**: Dramatically simplified lifecycle management — one system to understand, not two
- **Native agent-runner**: Now has proper health monitoring and auto-restart (was completely unmonitored before)
- **Future work**: T01.6 end-to-end validation can proceed on a clean foundation

## Related Work

- **WA-01**: `_projects/2026-03/20260301.02.native-agent-runner/wrong-assumptions/WA01_dual_lifecycle_management.md` — Resolved
- **DD-02**: `_projects/2026-03/20260301.02.native-agent-runner/design-decisions/DD02_single_daemon_lifecycle_owner.md` — Design decision document
- **DD-01**: Runtime filesystem layout for native agent-runner
- **T01.4**: Native agent-runner process mode (predecessor)

---

**Status**: Production Ready
**Timeline**: Single session
