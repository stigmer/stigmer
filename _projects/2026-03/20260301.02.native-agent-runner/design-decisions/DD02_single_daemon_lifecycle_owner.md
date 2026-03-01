# DD-02: Single Daemon as Lifecycle Owner for All Components

**Date**: 2026-03-01
**Status**: Decided
**Supersedes**: Dual lifecycle management (daemon.go + supervisor.go)
**Resolves**: WA-01 (Dual Lifecycle Management)

## Decision

A single long-lived background process (`stigmer internal-daemon`) is the exclusive lifecycle owner for all managed components: stigmer-server, workflow-runner, and agent-runner. The supervisor package inside stigmer-server is removed entirely. Docker-based agent-runner execution is removed entirely.

## Context

Investigation of WA-01 revealed that two independent systems — the CLI daemon (`client-apps/cli/internal/cli/daemon/`) and the supervisor inside stigmer-server (`backend/services/stigmer-server/pkg/supervisor/`) — both managed the same components with conflicting configurations, different state files, and competing health monitors.

### Problems with Dual Ownership

| Problem | Impact |
|---------|--------|
| Double-start risk | Both systems independently start agent-runner and workflow-runner |
| Conflicting state files | Daemon uses `agent-runner-container.id`, supervisor uses `agent-runner.containerid` |
| Competing health monitors | Both independently decide when to restart a component |
| Different configurations | Different env vars, Docker images, and volume mounts per system |
| No native health monitoring | The daemon started processes but did not monitor them after launch |

### Prior Architecture

```
┌──────────────────┐          ┌───────────────────────┐
│   CLI daemon.go  │          │   stigmer-server      │
│  (ephemeral)     │          │                       │
├──────────────────┤          │  ┌─────────────────┐  │
│ start server     │──exec──▶ │  │  supervisor.go  │  │
│ start WR         │──exec──▶ │  │  start WR       │  │ ← duplicate
│ start AR (Docker)│──exec──▶ │  │  start AR       │  │ ← duplicate
│                  │          │  │  health monitor  │  │
│ (exits)          │          │  └─────────────────┘  │
└──────────────────┘          └───────────────────────┘
```

The CLI daemon was ephemeral: it started processes and exited. It had no ongoing health monitoring. The supervisor inside stigmer-server compensated by running its own health loop, but this created the dual-ownership conflict.

## Design

### New Architecture

```
┌────────────────────┐
│  stigmer server    │  (foreground CLI — user-facing)
│  start             │
│  ├─ load config    │
│  ├─ resolve secrets│
│  ├─ start Temporal │
│  ├─ bootstrap AR   │  (Python runtime — shows progress to user)
│  ├─ spawn daemon   │──detach──▶ ┌───────────────────────┐
│  └─ exit(0)        │            │ stigmer internal-daemon│
└────────────────────┘            │ (long-lived background)│
                                  │                        │
                                  │ start stigmer-server   │
                                  │ start workflow-runner   │
                                  │ start agent-runner      │
                                  │                        │
                                  │ ┌────────────────────┐ │
                                  │ │  health loop (5s)  │ │
                                  │ │  check PIDs        │ │
                                  │ │  restart crashed    │ │
                                  │ │  write health-state │ │
                                  │ └────────────────────┘ │
                                  │                        │
                                  │ SIGTERM → graceful     │
                                  │ shutdown all children  │
                                  └────────────────────────┘
```

### Key Components

**Foreground CLI (`StartWithOptions`)**: Performs user-interactive setup — configuration loading, secret resolution, Temporal startup, Python runtime bootstrap (with progress output). Spawns `stigmer internal-daemon` as a detached background process, passing all resolved configuration via environment variables. Exits after confirming the daemon started.

**Long-lived daemon (`RunDaemonProcess` in `daemon_process.go`)**: Reads configuration from environment variables. Starts all three child components as OS processes. Runs a health monitoring loop every 5 seconds: checks process liveness via PID, automatically restarts crashed components, writes `health-state.json` atomically. Handles `SIGTERM`/`SIGINT` by gracefully shutting down all children in reverse start order.

**health-state.json**: Written atomically by the daemon every health check cycle. Contains the daemon PID, start time, and per-component state (PID, status, start time, restart count, last error). Read by `stigmer server status` for display.

### PID File Layout

```
~/.stigmer/data/
├── daemon.pid              # long-lived daemon process
├── stigmer-server.pid      # child of daemon
├── workflow-runner.pid     # child of daemon
└── agent-runner.pid        # child of daemon
```

### Configuration Flow

Environment variables are the sole mechanism for passing configuration from the foreground CLI to the background daemon. The daemon propagates relevant subsets to each child component.

| Variable | Consumer |
|----------|----------|
| `STIGMER_DATA_DIR` | daemon, all children |
| `STIGMER_LOG_DIR` | daemon, all children |
| `STIGMER_TEMPORAL_ADDR` | daemon → server, WR, AR |
| `STIGMER_LLM_*` | daemon → server, AR |
| `STIGMER_EXECUTION_*` | daemon → AR |
| `STIGMER_AR_PYTHON_BIN` | daemon → AR |
| `STIGMER_AR_APP_DIR` | daemon → AR |
| `STIGMER_GRPC_PORT` | daemon → server |

### Shutdown Flow

`stigmer server stop` sends `SIGTERM` to the daemon PID. The daemon catches the signal, sends `SIGTERM` to each child (agent-runner, workflow-runner, stigmer-server), waits up to 10 seconds for graceful shutdown, and force-kills any remaining processes. A safety-net `cleanupOrphanedProcesses` function in the CLI reads PID files and terminates any orphaned processes.

## Alternatives Considered

### A. Fix Supervisor to Be the Single Owner (Rejected)

Making stigmer-server's internal supervisor the lifecycle owner for all components keeps component management close to the backend. Rejected because:

- stigmer-server is a gRPC service — embedding process management creates a responsibility mismatch.
- The supervisor cannot display bootstrap progress to the user (it runs headless).
- The CLI already handles Temporal and configuration; splitting lifecycle ownership across layers is confusing.
- In cloud deployments, stigmer-server runs as a container — supervisor is meaningless there.

### B. Keep Both with Coordination Protocol (Rejected)

Adding a coordination mechanism (lock files, leader election) so daemon and supervisor cooperate. Rejected because:

- Unnecessary complexity for a local development tool.
- The two systems serve the same purpose — running the same processes.
- No user scenario requires both to be active simultaneously.

### C. Ephemeral CLI + Systemd/launchd Service (Rejected)

Using the OS service manager (launchd on macOS, systemd on Linux) to manage the daemon process. Rejected because:

- Requires root/sudo for service installation on some systems.
- Different APIs per OS adds significant complexity.
- Users expect `stigmer server start/stop` to be self-contained.
- Could be revisited later as an optional integration.

## Consequences

### What Changes

- **Removed**: `backend/services/stigmer-server/pkg/supervisor/` package (~300 lines).
- **Removed**: All Docker agent-runner code from daemon package (~500 lines).
- **Removed**: `AgentRunnerConfig`, `ResolveAgentRunnerMode`, and mode constants from config package.
- **Removed**: `DockerContainerHealthCheck`, `AgentRunnerHealthCheck` from health package.
- **Removed**: Docker log streaming branches from logs package.
- **Added**: `daemon_process.go` (~250 lines) implementing the long-lived daemon with health monitoring.
- **Added**: `stigmer internal-daemon` hidden Cobra command.
- **Modified**: `StartWithOptions` now bootstraps Python runtime and spawns daemon via env vars.
- **Modified**: `Stop` sends SIGTERM to daemon, which cascades shutdown.
- **Modified**: `server status` reads `health-state.json` instead of probing Docker containers.
- **Modified**: `server logs` always uses file-based streaming.
- **Net code change**: ~1300 lines removed, ~250 lines added.

### What Does Not Change

- `stigmer server start/stop/status/logs` CLI commands — same UX.
- Log file locations and naming.
- Temporal lifecycle management (separate from daemon).
- Configuration file format (config.yaml).

## References

- WA-01: `_projects/2026-03/20260301.02.native-agent-runner/wrong-assumptions/WA01_dual_lifecycle_management.md`
- DD-01: `_projects/2026-03/20260301.02.native-agent-runner/design-decisions/DD01_runtime_filesystem_layout.md`
- Daemon process: `client-apps/cli/internal/cli/daemon/daemon_process.go`
- Daemon entry: `client-apps/cli/internal/cli/daemon/daemon.go`
