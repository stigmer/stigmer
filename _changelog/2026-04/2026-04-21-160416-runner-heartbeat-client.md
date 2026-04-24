# Runner Heartbeat Client

**Date**: April 21, 2026

## Summary

Implemented the Python-side heartbeat client for the AgentRunner resource (Phase 1 item 13). The runner process now sends a heartbeat RPC every 30 seconds, reporting its operational phase (READY/BUSY), active execution count, and host machine information. This completes the runner's self-reporting loop — the server can now distinguish live runners from stale ones and make informed dispatch decisions.

## Problem Statement

After Sessions 5–10 established the AgentRunner resource, server-side handlers, dispatch integration, and auth migration, the runner process had no way to report its liveness or operational state back to the server.

### Pain Points

- The server could not distinguish between a runner that crashed and one that is healthy but idle — both look the same (no heartbeat data).
- Dispatch routing (Session 8) sends work to per-runner queues, but without heartbeat phase data, the server cannot avoid routing to runners that are at capacity.
- The `DaytonaSandboxRunnerLauncher` passes `STIGMER_TASK_QUEUE` to the sandbox, but the Python `Config` reads `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` — per-runner queues were silently ignored.
- The launcher did not pass the runner's resource ID (`STIGMER_AGENT_RUNNER_ID`), so the runner process had no way to identify itself for heartbeating.

## Solution

Three new modules in the agent-runner, plus config fixes and activity instrumentation:

1. **`HeartbeatEmitter`** — asyncio task running alongside the Temporal worker, sending heartbeat RPCs every 30s via a long-lived gRPC channel.
2. **`AgentRunnerClient`** — gRPC client wrapping `AgentRunnerCommandControllerStub.heartbeat()`.
3. **`execution_tracker`** — process-wide counter for active Temporal activities, used to derive phase (READY vs BUSY).

## Implementation Details

### HeartbeatEmitter (`worker/heartbeat.py`)

- Runs as an `asyncio.Task` on the same event loop as the Temporal worker.
- Determines phase: `READY` when `execution_tracker.get_count() < max_concurrency`, `BUSY` otherwise.
- Gathers connection info once at init (hostname, OS, arch, runner version via `importlib.metadata`).
- Sends a final `STOPPED` heartbeat during graceful shutdown for immediate dispatch feedback.
- Error handling per gRPC status code:
  - `NOT_FOUND`: stops heartbeat loop (runner resource deleted)
  - `FAILED_PRECONDITION`: logs warning (runner in FAILED phase)
  - Transient errors: logs warning, retries next interval

### Execution Tracker (`worker/execution_tracker.py`)

- Module-level counter with `increment()`, `decrement()`, `get_count()`.
- All 7 registered activities instrumented with `increment()` at entry and `decrement()` in a `finally` block.

### Config Fixes (`worker/config.py`)

- Added `agent_runner_id: str | None` field, read from `STIGMER_AGENT_RUNNER_ID`.
- Fixed task queue resolution cascade: `STIGMER_TASK_QUEUE` > `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` > `"agent_execution_runner"`.

### Worker Integration (`worker/worker.py`)

- `HeartbeatEmitter` created in `__init__` (only when `agent_runner_id` is set), started in `start()`, stopped in `shutdown()`.
- Shutdown order: heartbeat emitter first (sends STOPPED), then Temporal worker drains activities.

### Launcher Fix (stigmer-cloud)

- `DaytonaSandboxRunnerLauncher.buildEnvVars()` now passes `STIGMER_AGENT_RUNNER_ID` so the runner process knows its resource identity.

## Benefits

- **Live runner visibility**: Server sees heartbeats within 30s of runner startup; dispatch can make informed routing decisions.
- **Capacity awareness**: READY/BUSY phase enables the dispatch logic to avoid sending work to runners that are at capacity.
- **Fast offline detection**: Final STOPPED heartbeat on shutdown means the server knows immediately (vs 90s timeout for crashes).
- **Per-runner queues work**: The task queue env var fix means `DaytonaSandboxRunnerLauncher` queue names are actually read by the Python worker.
- **Backward compatible**: No `STIGMER_AGENT_RUNNER_ID` = no heartbeat loop. Existing deployments are unaffected.

## Impact

- **Agent-runner (Python)**: 3 new files, 9 modified files. All 7 activities instrumented with execution tracking.
- **stigmer-cloud (Java)**: 1 file modified (`DaytonaSandboxRunnerLauncher`). Signature change to `buildEnvVars()` is internal.
- **No proto changes**: Heartbeat RPC and all types were defined in Session 5.
- **No behavioral changes to existing deployments**: Heartbeat is opt-in via env var.

## Related Work

- Session 5: AgentRunner proto definition (heartbeat RPC, `AgentRunnerHeartbeatInput`, phase enum)
- Session 7: Go heartbeat handler (`applyHeartbeat` with phase transition rules)
- Session 6: Java heartbeat handler (`AgentRunnerHeartbeatHandler` with FGA ownership check)
- Session 8: Dispatch integration (reads runner phase for routing decisions)
- Session 9: `DaytonaSandboxRunnerLauncher` (passes `STIGMER_TASK_QUEUE` to sandbox)
- Session 10: Auth migration (`STIGMER_TOKEN`, single-channel `ChannelProvider`)

---

**Status**: Production Ready
**Timeline**: Session 11 (single session)
