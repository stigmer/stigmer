# Fix Recovery Proto and SDK Documentation

**Date**: June 1, 2026

## Summary

Corrected stale and contradictory documentation across three proto files and the React SDK that misrepresented workflow execution recovery semantics. The protos now accurately describe the task-level resume behavior implemented in T01-T06: terminate + fresh workflow with recoveryMode + skip completed tasks via event log replay.

## Problem Statement

After implementing task-level resume (T01-T06), the proto documentation told two contradictory stories — neither of which matched reality:

### Pain Points

- `io.proto` claimed checkpoint/reset resume via Temporal Reset (never implemented)
- `command.proto` stated "there is no task-level checkpoint resume" and "all tasks re-executed from the beginning" (now wrong — completed tasks are skipped)
- `event.proto` documented `task_skipped` as conditional-logic-only (now also used for recovery)
- React SDK JSDoc used vague "last checkpoint" terminology with no `@param` documentation

## Solution

Pure documentation fixes across four files — no logic, no generated code, no semantic changes. Updated all recovery-related comments to accurately describe the implemented behavior: terminate old workflows, start fresh with recoveryMode, skip completed tasks (restoring outputs from event log), resume from the failure point.

## Implementation Details

### `io.proto` — RecoverWorkflowExecutionInput

- Moved public description above `@internal` to clarify user-facing vs implementation semantics
- Replaced "engine's reset functionality" (never existed) with accurate description of terminate + recoveryMode + event log replay
- Added detail about event sequence continuation from high-water mark

### `command.proto` — recover RPC (89-line doc block)

- Rewrote summary paragraph: removed "no task-level checkpoint resume", added task-level resume description
- Updated Behavior steps: added child workflow termination (step 2), rewrote step 4 for recoveryMode + skip semantics, added event sequence step (new step 5)
- Fixed State Transitions: "All tasks: Re-executed" → "Completed tasks: Skipped" / "Failed/pending tasks: Re-executed"
- Expanded Recovery vs Restart table with three new rows (completed tasks, failed task, event history)

### `event.proto` — TaskSkippedPayload + enum

- Broadened enum comment from "conditional logic" to "conditional logic or recovery"
- Restructured payload doc with numbered scenarios: (1) conditional logic, (2) recovery
- Updated `reason` field example to include "completed in prior run (recovery)"

### `useWorkflowExecutionActions.ts` — recover JSDoc

- Replaced one-liner with multi-line JSDoc describing task-level resume semantics
- Added `@param reason` documentation
- Described environment re-resolution behavior

## Benefits

- Proto documentation now matches implemented behavior — no contradictions between io.proto and command.proto
- New engineers reading the proto can understand recovery semantics without reading implementation code
- SDK consumers get actionable JSDoc explaining what `recover()` actually does
- Prevents future confusion about whether recovery re-runs all tasks or skips completed ones

## Impact

- **Proto consumers**: Anyone reading the generated docs (Go, Java, Python, TS stubs) now sees correct recovery semantics
- **SDK consumers**: React developers using `useWorkflowExecutionActions` get proper `recover()` documentation
- **No breaking changes**: Pure comment/doc edits — no field additions, no enum changes, no generated code differences

## Related Work

- T01: Event Sequence Continuation (`dd1a4e8cb`)
- T02: Task-Level Resume in TS Engine (`97a6d1911`)
- T03: Recovery Flag Propagation (`42bce319f`, `39377761`)
- T04: Cursor Error Classification (`a38509ca3`)
- T05: React Event Store Reset (`392ce77d0`)
- T06: Child Workflow Termination (`ca65a92d9`, `7061f539`)

---

**Status**: ✅ Production Ready
**Timeline**: 30 minutes
