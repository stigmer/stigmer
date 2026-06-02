# Task-Level Resume on Workflow Recovery

**Date**: June 1, 2026

## Summary

Implemented task-level resume in the TS workflow engine so that recovering a failed workflow execution skips previously completed tasks, restores their outputs to `$context` and `$output`, and resumes execution from the first incomplete task. This preserves completed work and avoids redundant re-execution of expensive tasks (LLM calls, HTTP calls, agent invocations).

## Problem Statement

When a user clicked "Recover" on a failed workflow execution, the engine re-executed all tasks from scratch — discarding completed work and wasting compute, tokens, and time. A 10-task workflow that failed on task 8 would re-run tasks 1–7 unnecessarily.

### Pain Points

- Completed tasks re-executed on recovery (wasteful, expensive for LLM/agent calls)
- `$context` not restored — downstream tasks lost access to prior task exports
- `$output` rolling chain broken — implicit input chaining between tasks failed
- No visibility into which tasks were skipped vs re-executed on recovery

## Solution

Added a recovery mode to the workflow engine that loads the previous run's completed task data from the execution status snapshot, builds a recovery context, and uses it to skip already-completed tasks during the executor loop. Skipped tasks emit `task_skipped` events with a recovery-specific reason and restore their outputs to workflow state via the existing `processTaskOutput` and `processTaskExport` code paths.

## Implementation Details

### New module: `recovery.ts` (sandbox-safe)

- `RecoveryTaskData` — plain-object type for crossing the Temporal serialization boundary
- `RecoveredTask` — holds cached output and truncation detection flag
- `RecoveryContext` — `ReadonlyMap<string, RecoveredTask>` keyed by task name
- `buildRecoveryContext()` — filters status.tasks[] to completed tasks, detects 64KB truncation markers

### New activity: `LoadRecoveryContext`

- Registered in `createWorkflowEventActivities()` alongside `EmitWorkflowEvents` and `ResetEventSequence`
- Fetches the execution via `getWorkflowExecution`, converts proto `WorkflowTask[]` to plain serializable objects
- Proto `WorkflowTaskStatus` enum mapped to string via `PROTO_STATUS_TO_STRING`
- Propagates errors (unlike best-effort event emission, recovery data is required for correctness)

### Engine wiring

- `ExecuteFromExecutionInput.recovery_mode` — new optional field on the Temporal wire contract (T03 will set this from the Java/Go RecoverHandler)
- `RunWorkflowEngineOptions.recoveryMode` — engine-level flag (keeps recovery concern out of `ExecuteServerlessWorkflowInput`)
- `engine-core.ts` — loads recovery context via local activity when `recoveryMode` is true, passes to executor

### Executor skip logic

- Added optional 7th parameter `recoveryContext` to `executeDoTasks` — recursive callers (for, fork, try, nested do) naturally pass `undefined`, ensuring recovery applies only to top-level tasks
- Skip block runs after `state.addData` and before condition check — recovery skipping takes precedence over `if` conditions
- Calls `processTaskOutput` and `processTaskExport` with cached output to restore `$output` chain and `$context` exports
- Respects both static (`then`) and dynamic (`__flow_directive__`) flow directives from skipped tasks
- Deactivates recovery context after first non-skipped task to prevent accidental late skipping

### Key design decisions

- **Data source: `status.tasks[]`** — event log doesn't carry task outputs (output_summary defined in proto but never populated). Status snapshot has outputs with 64KB truncation, which is acceptable for >99% of workflows.
- **Top-level only** — composite tasks (for, fork, try) that partially completed are re-executed entirely. Sub-task recovery deferred.
- **T06 interaction** — identified a data race if T06 clears `status.tasks[]` before the engine reads it. Recommendation: T06 should NOT clear tasks (engine's own event emission naturally replaces stale entries).

## Benefits

- Failed workflows resume from where they stopped instead of re-running from scratch
- Completed LLM calls, HTTP calls, and agent invocations are not repeated
- `$context` and `$output` state correctly restored for downstream tasks
- Clear observability: recovery skips emit `task_skipped` events with reason `"completed in prior run (recovery)"`
- Zero behavior change for non-recovery executions (optional parameter, backward compatible)

## Impact

- **Workflow execution recovery** — Core improvement to the recovery flow, enabling the "continue from failure" user experience
- **TS runner** — 5 files modified, 3 new files created, all within `backend/services/runner/`
- **Depends on** — T01 (event sequence continuation, already merged)
- **Enables** — T03 (flag propagation from Java/Go), T07 (integration tests), T08 (proto documentation)

## Related Work

- [Fix Event Sequence Reset on Recovery](_changelog/2026-06/2026-06-01-151042-fix-event-sequence-reset-on-recovery.md) — T01, prerequisite
- T03 (Recovery Flag Propagation) — wires `recovery_mode` from Java/Go RecoverHandler
- T05 (React Event Store Reset) — UI-side recovery handling
- T07 (Integration Tests) — end-to-end recovery test suite

---

**Status**: ✅ Production Ready (pending T03 for end-to-end activation)
**Timeline**: T02 of 9-task recovery project
