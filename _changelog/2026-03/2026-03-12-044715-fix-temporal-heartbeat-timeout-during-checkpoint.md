# Fix Temporal Heartbeat Timeout During LangGraph Checkpoint I/O

**Date**: March 12, 2026

## Summary

Fixed a critical issue where the `ExecuteGraphton` Temporal activity was killed by a heartbeat timeout during LangGraph's post-interrupt checkpoint processing. The root cause was a combination of a tight 30-second heartbeat timeout, aggressive SDK-side heartbeat throttling (80% of timeout = 24 seconds), and asyncio event loop starvation during synchronous checkpoint operations. The fix increases the timeout to 2 minutes, reduces SDK throttle intervals, and hardens the background heartbeat task.

## Problem Statement

After approving sub-agent tool calls, the execution would fail with:

> Activity stopped sending heartbeat (worker may have crashed). Check agent-runner logs for errors. Original error: activity Heartbeat timeout

### Pain Points

- Agent executions failed permanently after tool approval (no retries — `MaximumAttempts: 1`)
- The error message suggested a worker crash, but the worker was healthy — just unable to send heartbeats in time
- The failure occurred reliably when multiple sub-agents hit interrupts simultaneously
- No diagnostic visibility: heartbeat failures were logged at DEBUG level, invisible in production logs

## Solution

Three-layer fix addressing the root cause at each level of the stack:

1. **Server-side timeout**: Increase `HeartbeatTimeout` from 30s to 2 minutes across Go (stigmer) and Java (stigmer-cloud) workflow configurations
2. **SDK-side throttle**: Reduce `max_heartbeat_throttle_interval` from the default 60s to 10s on the Python Worker, ensuring heartbeats reach the Temporal server promptly
3. **Background heartbeat hardening**: Fix silent task death from uncaught `CancelledError` and add INFO-level diagnostic logging

## Implementation Details

### Root Cause Analysis

The Temporal Python SDK's Rust core throttles `record_activity_heartbeat()` calls to at most once per `heartbeat_timeout × 0.8`. With a 30-second timeout, this meant heartbeats were forwarded to the server only every **24 seconds**, leaving a margin of just **6 seconds**.

LangGraph's `Pregel.astream()` calls `after_tick()` synchronously between BSP steps. This method runs `apply_writes()`, `create_checkpoint()`, and `copy_checkpoint()` — all CPU-bound, in-memory operations that block the asyncio event loop. When graph state is large (4+ concurrent sub-agents with full message histories), this blocks the background heartbeat task from executing, consuming the 6-second margin and triggering the timeout.

Additionally, the background heartbeat task caught only `Exception`, not `BaseException`. In Python 3.13, `asyncio.CancelledError` is a `BaseException` — if the activity was cancelled mid-heartbeat, the exception silently killed the background task.

### Changes

**Go workflow** (`backend/services/stigmer-server/.../execute_graphton.go`):
- `HeartbeatTimeout: 30 * time.Second` → `HeartbeatTimeout: 2 * time.Minute`

**Python Worker** (`backend/services/agent-runner/worker/worker.py`):
- Added `max_heartbeat_throttle_interval=timedelta(seconds=10)` — forces the Rust core to forward heartbeats every 10s instead of every 96s (120s × 0.8)

**Python activity** (`backend/services/agent-runner/worker/activities/execute_graphton.py`):
- Background heartbeat catches `BaseException` instead of `Exception`
- Re-raises `CancelledError` and `KeyboardInterrupt` after logging (these should propagate, not be swallowed)
- Heartbeat success/failure logged at INFO level with sequence counter for production diagnostics

**Java workflows** (stigmer-cloud):
- `InvokeAgentExecutionWorkflowImpl.java`: `setHeartbeatTimeout(Duration.ofMinutes(2))`
- `InvokeWorkflowExecutionWorkflowImpl.java`: `setHeartbeatTimeout(Duration.ofMinutes(2))`

## Benefits

- **Heartbeat margin**: 6 seconds → 110 seconds (120s timeout minus 10s throttle)
- **Diagnostic visibility**: Every background heartbeat is now logged at INFO level with a sequence counter — immediately shows when heartbeats stop flowing
- **Resilience**: `CancelledError` can no longer silently kill the background heartbeat task
- **Consistent configuration**: Go and Java workflow definitions use the same 2-minute timeout

## Impact

- All agent executions with sub-agent approvals (the most common failure scenario)
- Workflow executions (stigmer-cloud `ExecuteWorkflow` activity also updated)
- No behavioral changes for healthy executions — heartbeats are still sent every 10 seconds

## Related Work

- `2026-03-11-171855-fix-sub-agent-approval-deadlock.md` — the sub-agent approval deadlock fix that preceded this heartbeat investigation

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (deep investigation of Temporal SDK internals + cross-stack fix)
