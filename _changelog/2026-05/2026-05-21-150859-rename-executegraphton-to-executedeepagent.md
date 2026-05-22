# Rename ExecuteGraphton Activity to ExecuteDeepAgent

**Date**: May 21, 2026

## Summary

Renamed the `ExecuteGraphton` Temporal activity to `ExecuteDeepAgent` across both Go (OSS) and Java (Cloud) workflow orchestrators to align with the unified TypeScript runner's registered activity name. This resolves the name mismatch that blocked native harness execution in per-session routing mode.

## Problem Statement

The unified TypeScript runner (the replacement for the legacy Python agent-runner) registers `ExecuteDeepAgent` as its native harness activity name. However, both Go and Java workflows still dispatched `ExecuteGraphton` (the legacy Python activity name). In per-session routing mode (`STIGMER_ACTIVITY_ROUTING=session`), only the unified TypeScript runner polls session queues — dispatching `ExecuteGraphton` found no handler, causing ScheduleToStart timeouts.

### Pain Points

- Native harness sessions failed in per-session routing mode (desktop embedded runner, cloud sandboxes)
- The name `Graphton` referred to a deprecated Python wrapper library, not the actual execution engine
- Comments and documentation still referenced Python-era terminology

## Solution

Rename the activity name constant from `"ExecuteGraphton"` to `"ExecuteDeepAgent"` in both workflow orchestrators, aligning with the TypeScript runner. The Python agent-runner (scheduled for deletion) was intentionally left untouched.

## Implementation Details

### Go OSS (`stigmer`)

- **Renamed file**: `execute_graphton.go` → `execute_deep_agent.go`
- **Interface**: `ExecuteGraphtonActivity` → `ExecuteDeepAgentActivity`
- **Constant**: `ExecuteGraphtonActivityName = "ExecuteGraphton"` → `ExecuteDeepAgentActivityName = "ExecuteDeepAgent"`
- **Workflow methods**: `executeGraphtonFlow` → `executeDeepAgentFlow`, `executeGraphtonWithHitl` → `executeDeepAgentWithHitl`
- **Tests**: Updated `invoke_workflow_pause_test.go` stub registrations and mock assertions
- **Proto comment**: Updated `spec.proto` harness→activity mapping documentation

### Java Cloud (`stigmer-cloud`)

- **Renamed file**: `ExecuteGraphtonActivity.java` → `ExecuteDeepAgentActivity.java`
- **Annotation**: `@ActivityMethod(name = "ExecuteGraphton")` → `@ActivityMethod(name = "ExecuteDeepAgent")`
- **Workflow**: Renamed flow methods, activity stub type, and all invocation calls
- **Config/Docs**: Updated worker config comments, workflow type docs, README
- **Tests**: Updated signal test and cursor test mock declarations

### Not Touched (scheduled for deletion)

- Python `agent-runner` (`execute_graphton.py`)
- Go `workflow-runner`
- TypeScript `cursor-runner` (already deleted)

## Benefits

- Native harness per-session routing now works with the unified runner
- Activity naming aligns with the execution engine (`deepagents` library) rather than the deprecated wrapper
- Documentation reflects current architecture (TypeScript unified runner, not Python)

## Impact

- **Go workflows**: Dispatch `ExecuteDeepAgent` for NATIVE/UNSPECIFIED harness sessions
- **Java workflows**: Same dispatch change
- **In-flight workflows**: Any workflows currently dispatching `ExecuteGraphton` will fail if the Python worker is removed — acceptable as part of the migration
- **Unified runner**: No changes needed (already registered `ExecuteDeepAgent`)

## Verification

- Go build: clean
- Go temporal package tests: all pass
- Java Bazel tests: all 61 pass

## Related Work

- Part of `20260520.01.runner-architecture-simplification` project
- Follows T02 (Runner API deletion), T04 (per-session routing), T06c (desktop embedded runner)
- Unblocks native harness execution in per-session routing mode

---

**Status**: ✅ Production Ready
