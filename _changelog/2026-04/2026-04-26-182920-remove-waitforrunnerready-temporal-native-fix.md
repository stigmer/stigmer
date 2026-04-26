# Remove WaitForRunnerReady Gate — Let Temporal Do Its Job

**Date**: April 26, 2026

## Summary

Removed the `WaitForRunnerReady` local activity from the agent execution workflow and replaced it with Temporal's native `ScheduleToStartTimeout` mechanism. This eliminates a production outage caused by a phase-transition gap in the custom readiness gate, while reducing code surface area by ~180 lines across 6 files (2 deleted, 4 modified).

## Problem Statement

Ephemeral runner provisioning via Daytona sandboxes was broken in production. Agent executions would hang for 5 minutes and then fail with `TIMEOUT_TYPE_START_TO_CLOSE` on the `WaitForRunnerReady` local activity.

### Pain Points

- The `WaitForRunnerReady` local activity polled MongoDB every 5 seconds in a `Thread.sleep` loop, waiting for the runner's phase to transition from `RUNNER_PHASE_PENDING` to `RUNNER_PHASE_READY`
- The `DaytonaSandboxRunnerLauncher` never set `RUNNER_PHASE_READY` after starting the worker process — a phase-transition gap that went undetected
- The Python `main.py` inside Daytona sandboxes crashed at startup due to stale `Config` attribute references (`sandbox_type`, `sandbox_root_dir`, `redis_host`, `redis_port`), so the worker never connected to Temporal — compounding the readiness gap
- The custom gate reimplemented Temporal's native queue-waiting guarantee with worse failure modes

## Solution

Removed the custom readiness gate entirely and relied on Temporal's built-in `ScheduleToStartTimeout`, which provides the exact same guarantee: an activity scheduled on a queue waits for a worker to connect, then executes.

Increased `ScheduleToStartTimeout` from 1 minute to 5 minutes on all Python activity stubs to cover ephemeral sandbox boot time (image pull + Python startup typically takes 30-90 seconds).

## Implementation Details

### stigmer-cloud repo

**Removed:**
- `WaitForRunnerReadyActivity.java` — activity interface (deleted)
- `WaitForRunnerReadyActivityImpl.java` — MongoDB polling implementation (deleted)
- Step 0 gate block from `InvokeAgentExecutionWorkflowImpl.executeGraphtonFlow()`
- Activity registration from `AgentExecutionTemporalWorkerConfig`

**Modified:**
- `EnsureThreadActivity` stub: `ScheduleToStartTimeout` 1min → 5min
- `ExecuteGraphtonActivity` stub: `ScheduleToStartTimeout` 1min → 5min
- `GenerateSessionSubjectActivity` stub: `ScheduleToStartTimeout` 1min → 5min

### stigmer repo

**Fixed:**
- `backend/services/agent-runner/main.py` — replaced stale `config.sandbox_type`, `config.sandbox_root_dir`, `config.redis_host`, `config.redis_port` with valid fields (`config.execution_mode`, `config.workspace_root_dir`, `config.stigmer_proxy_endpoint`)

## Benefits

- **Eliminates production outage**: The phase-transition gap that caused the failure no longer exists
- **Simpler architecture**: Removes 6 files of surface area (activity interface, impl, registration, workflow wiring) for something Temporal provides natively
- **Better failure signals**: `SCHEDULE_TO_START` timeout gives a clear error ("no worker on this queue") vs the opaque "Local Activity task timed out" from the polling loop
- **No MongoDB polling**: Removes `Thread.sleep` loops inside local activities that blocked workflow task threads

## Impact

- **Agent executions on ephemeral runners**: Now work correctly — the workflow schedules activities on the runner's queue, Temporal holds them until the worker connects
- **CLI/Desktop runners**: Unaffected — the `RUNNER_PHASE_READY` lifecycle via the bidi gRPC stream is unchanged
- **RunnerDispatchService**: Unaffected — still checks for active phases when routing to persistent runners

## Related Work

- Reverts the architectural approach from `2026-04-26-171652-wait-for-runner-ready-ephemeral-race-fix.md`
- Builds on the Daytona sandbox provisioning introduced in `2026-04-21-103215-agentrunner-aggregate-handlers.md`

---

**Status**: Production Ready
**Timeline**: Same-day fix (outage investigation → root cause → architectural correction)
