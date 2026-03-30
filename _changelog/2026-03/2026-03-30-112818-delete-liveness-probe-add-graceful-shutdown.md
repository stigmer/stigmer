# Delete Liveness Probe & Add Graceful Shutdown Timeout

**Date**: March 30, 2026

## Summary

Removed the Kubernetes liveness probe from the agent-runner that was killing healthy idle pods every ~3.5 minutes, and added a 30-second graceful shutdown timeout to the Temporal Worker so in-flight activities survive SIGTERM.

## Problem Statement

The liveness probe introduced in the event-loop-blocking fix (changelog `2026-03-30-102416`) was actively causing the failures it was meant to prevent. The probe checked a heartbeat file (`/tmp/agent-runner-heartbeat`) that was only touched by the `_event_loop_watchdog` inside `StreamExecutor.execute()` — a task that only runs during active LangGraph streaming. When the worker was idle (polling for Temporal tasks but not executing any), the file was never touched, so the probe saw it as stale and killed the pod.

### Pain Points

- Healthy idle pods were killed every ~3.5 minutes (120s initial delay + 3 × 30s failure threshold)
- The Worker had `graceful_shutdown_timeout=0` (default), so SIGTERM from the probe caused immediate cancellation of in-flight activities
- Activities interrupted mid-setup (e.g., during git clone) produced `WorkerShutdown` errors that exhausted Temporal retries
- The Temporal workflow entered a broken state machine replay loop (`LocalActivity: MARKER_COMMAND_CREATED->RECORD_MARKER`), permanently stuck

## Solution

Delete the liveness probe entirely. The root cause (sync I/O blocking the event loop) is already fixed by `asyncio.to_thread()` wrapping. Temporal's own heartbeat mechanism detects hung activities. The diagnostic watchdog logs `[WATCHDOG]` warnings for sub-second blockage. The Docker HEALTHCHECK verifies startup. The probe was defense-in-depth for a solved problem, and its implementation was actively destructive.

Add `graceful_shutdown_timeout=timedelta(seconds=30)` to the Temporal Worker independently — this protects in-flight activities from any SIGTERM source (deployment rollout, node drain, manual restart), not just the probe.

## Implementation Details

### Liveness probe deletion (`service.yaml`)

Removed the entire `livenessProbe` block from the Kustomize overlay. No replacement needed — Temporal heartbeats, the diagnostic watchdog, and the Docker HEALTHCHECK cover all the same ground without conflating "idle" with "hung."

### Heartbeat file cleanup (`streaming.py`)

Removed `_WATCHDOG_HEARTBEAT_FILE` constant, the `import os`, and the `open()`/`os.utime()` block from `_event_loop_watchdog`. The watchdog retains its diagnostic role: measuring event loop blockage during streaming and logging warnings when the threshold is exceeded.

### Graceful shutdown timeout (`worker.py`)

Added `graceful_shutdown_timeout=timedelta(seconds=30)` to the `Worker` constructor. When SIGTERM arrives, the worker stops accepting new tasks and waits up to 30 seconds for in-flight activities to complete before cancelling them.

## Benefits

- Agent-runner pods no longer killed while idle
- In-flight activities survive SIGTERM for up to 30 seconds instead of immediate cancellation
- Net deletion of code and configuration — no new mechanisms added
- Temporal's built-in heartbeat timeout handles activity-level liveness detection

## Impact

- **Agent runner**: Pods remain stable regardless of execution load
- **Production reliability**: Deployment rollouts and node drains no longer interrupt activities mid-execution
- **Observability**: Diagnostic watchdog logging preserved for development/testing

## Files Changed

| File | Change |
|------|--------|
| `backend/services/agent-runner/_kustomize/overlays/prod/service.yaml` | Delete `livenessProbe` block |
| `backend/services/agent-runner/worker/activities/graphton/streaming.py` | Remove heartbeat file touching from watchdog |
| `backend/services/agent-runner/worker/worker.py` | Add `graceful_shutdown_timeout=timedelta(seconds=30)` |

## Related Work

- [Fix Event Loop Blocking in Agent Runner](./2026-03-30-102416-fix-event-loop-blocking-in-agent-runner.md) — the changeset that introduced the (now deleted) liveness probe

---

**Status**: ✅ Production Ready
**Timeline**: Single session
