# WA-01: Dual Lifecycle Management — daemon.go and supervisor.go

**Date**: 2026-03-01
**Discovered during**: T01.4 planning
**Status**: Open — needs architectural investigation
**Severity**: Architectural concern — potential double-starts and conflicting state

## Discovery

During T01.4 planning, we discovered that agent-runner and workflow-runner are independently managed by two separate systems that both start, stop, and health-monitor the same components:

1. **Daemon package** (`client-apps/cli/internal/cli/daemon/`)
   - `daemon.go` — `startAgentRunner()`, `stopAgentRunner()`, `startWorkflowRunner()`, `stopWorkflowRunner()`
   - `health_integration.go` — periodic health checks via `health.Monitor`, restarts crashed components

2. **Supervisor package** (`backend/services/stigmer-server/pkg/supervisor/`)
   - `supervisor.go` — `startAgentRunner()`, `startWorkflowRunner()`, `startHealthMonitoring()`
   - Independent health ticker (10s interval), restarts unhealthy components

## Divergences Between the Two Systems

| Aspect | Daemon (CLI) | Supervisor (stigmer-server) |
|---|---|---|
| Container ID file | `agent-runner-container.id` | `agent-runner.containerid` |
| Docker image | `stigmer-agent-runner:local` | `ghcr.io/stigmer/agent-runner:latest` |
| Image management | Builds/tags from embedded or pulls | Pulls from registry |
| Env: `STIGMER_SERVER_ADDRESS` | Not set | Set to backend addr |
| Sandbox/execution options | Full set (mode, image, TTL, etc.) | Not passed |
| Log volume mount | Not mounted | `-v <logDir>:/logs` |
| Artifact HTTP port | `DaemonPort + 1` hardcoded | Configurable via `ArtifactHTTPPort` |

## Potential Problems

1. **Double-start**: `StartWithOptions()` starts stigmer-server (which runs `supervisor.Start()`), then separately calls `startWorkflowRunner()` and `startAgentRunner()`. The supervisor starts the same components as children of the server process. For Docker, the daemon's `docker rm -f` before start masks this. For native processes, this would create duplicate instances.

2. **Conflicting state files**: Different container ID filenames mean neither system can detect what the other started.

3. **Competing health monitors**: Both systems independently decide when to restart a component. If one restarts while the other is health-checking, they could interfere.

4. **Different configurations**: The two systems pass different environment variables and use different Docker images, meaning agent-runner's behavior differs depending on which system started it.

## Hypotheses (Unverified)

- **Hypothesis A**: Supervisor is intended for cloud/production deployments (no CLI daemon), daemon is for local development. In local mode, the supervisor's component management should be disabled. The overlap is unintentional.
- **Hypothesis B**: Supervisor is the real owner (added later). Daemon's direct management is legacy code from before the supervisor was introduced. Should be removed from daemon.
- **Hypothesis C**: Both are intentional with idempotency guarantees we haven't identified yet.

## Decision

**Do NOT modify `supervisor.go` for native agent-runner mode** until this architecture is investigated and a deliberate decision is made about single ownership.

T01.4 proceeds with daemon-only changes. The supervisor continues running its Docker-based agent-runner management unchanged.

## Required Follow-Up

- Investigate the startup call flow end-to-end: trace exactly what happens when `stigmer server start` runs
- Determine whether both systems actually start components (or if one is disabled in local mode)
- Make a deliberate architectural decision about ownership
- Consolidate to a single lifecycle manager
- Fix the container ID file naming mismatch
