# Idle Self-Termination and Server-Side Sandbox Cleanup

**Date**: April 21, 2026

## Summary

Implemented application-level idle self-termination for ephemeral AgentRunners and server-side Daytona sandbox cleanup, completing the full ephemeral runner lifecycle. A critical Daytona auto-stop bug was discovered and fixed: Daytona kills sandboxes based on toolbox API interaction time, not running processes.

## Problem Statement

Ephemeral runners spawned by `DaytonaSandboxRunnerLauncher` consume Daytona sandbox resources indefinitely after their work completes. The existing `autoStopInterval` (Daytona-level) was assumed to handle this, but empirical testing revealed it measures toolbox API interaction time — not process activity — making it both dangerous (kills active runners) and insufficient (cannot distinguish application-level idle).

### Pain Points

- Daytona auto-stop at 5 minutes kills active runners that are processing Temporal activities (latent bug since Session 9)
- No mechanism to reclaim idle ephemeral runner sandboxes cleanly
- No graceful shutdown path — abrupt sandbox kill means no final STOPPED heartbeat (90s dispatch delay)
- Persistent and local runners would incorrectly self-terminate if given a default timeout

## Solution

Three-layer idle lifecycle: Python idle watchdog (application-level idle detection) -> SIGTERM graceful shutdown (final STOPPED heartbeat) -> server-side sandbox cleanup (Daytona delete via heartbeat pipeline).

## Implementation Details

### Daytona Auto-Stop Finding (Empirically Validated)

Created a Daytona sandbox with `autoStopInterval: 2` minutes, started a background `sleep 600` process, and monitored the sandbox state without touching the toolbox API. Result: Daytona auto-stopped the sandbox after exactly 2 minutes, killing the running process. This proves `autoStopInterval` tracks toolbox API interaction time, not process presence.

Fix: Set `autoStopIntervalMinutes` default to `0` (disabled).

### Python Idle Watchdog (stigmer)

- `IdleWatchdog` class: asyncio task polling `execution_tracker` every 30s
- `execution_tracker` extended with `last_activity_at` monotonic timestamp (updated on every `increment()`/`decrement()`)
- Idle condition: `get_count() == 0 AND monotonic() - last_activity_at() >= timeout`
- Fires `os.kill(os.getpid(), signal.SIGTERM)` — reuses existing signal handler for graceful shutdown
- Opt-in via `STIGMER_IDLE_TIMEOUT_SECONDS` env var (absent/0 = disabled)
- Lifecycle: starts after heartbeat, stops first in shutdown (prevents re-trigger during drain)

### Launcher Config (stigmer-cloud)

- `autoStopIntervalMinutes` default changed from 5 to 0
- New `idleTimeoutSeconds` property (default 300) passed as `STIGMER_IDLE_TIMEOUT_SECONDS` env var

### Server-Side Sandbox Cleanup (stigmer-cloud)

- `RunnerLauncher` interface extended with `deprovisionAsync(AgentRunner)` — mirror of `provisionAsync`
- `DaytonaSandboxRunnerLauncher.deprovisionAsync()`: loads sandbox by ID and deletes it (best-effort)
- `DeprovisionInfrastructureStep`: pipeline step in heartbeat handler, fires on STOPPED phase for ephemeral runners with a `sandbox_id`
- Wired after `persistRunner`, before `sendResponse` in the heartbeat pipeline

## Benefits

- Ephemeral runners self-terminate after 5 minutes of idle (configurable)
- Final STOPPED heartbeat enables immediate dispatch feedback (vs 90s server timeout)
- Server-side sandbox cleanup prevents Daytona resource leaks
- Active runners are never killed by Daytona auto-stop (latent bug fixed)
- Persistent and local runners are unaffected (watchdog disabled by default)

## Impact

- **Agent Runner**: New idle watchdog module, execution tracker timestamp extension
- **Stigmer Service (Cloud)**: Heartbeat handler now triggers sandbox cleanup, launcher config restructured
- **Operations**: Daytona auto-stop disabled — sandboxes stay alive until the Python watchdog fires. Auto-archive remains at 5 minutes for stopped sandboxes.

## Related Work

- Session 9: RunnerLauncher abstraction (introduced `autoStopInterval` — now fixed)
- Session 11: Runner heartbeat client (idle watchdog reads from the same execution tracker)
- Deferred: Stale runner timeout detection (90s heartbeat timeout -> STOPPED + cleanup for crash scenarios)

---

**Status**: Production Ready
**Timeline**: Phase 1, Item 14 (final Phase 1 coding item)
