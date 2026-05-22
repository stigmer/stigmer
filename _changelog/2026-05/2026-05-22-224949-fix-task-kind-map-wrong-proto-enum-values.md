# Fix Incorrect Task Kind Display in Workflow Execution UI

**Date**: May 22, 2026

## Summary

Fixed a bug where `agent_call` workflow tasks were displayed as `http_call` in the execution timeline UI. The root cause was a `TASK_KIND_MAP` in the runner's event emitter that used sequential numbering instead of matching the proto `WorkflowTaskKind` enum values. Also added fine-grained kind reporting for `call:function` sub-types (llm_call, eval, emit_event, etc.).

## Problem Statement

When viewing workflow executions in the Stigmer dashboard, the task kind badge for `agent_call` tasks incorrectly showed "http_call". This affected all workflow executions containing agent_call tasks.

### Pain Points

- Users couldn't identify task types at a glance in the execution timeline
- Every task kind except `set_vars`, `listen`, and `human_input` was displaying the wrong label
- `call:function` sub-types (llm, eval, emit_event, etc.) all showed as "activity_call" with no differentiation

## Solution

1. Replaced the hardcoded sequential `TASK_KIND_MAP` with one that imports and uses the `WorkflowTaskKind` proto enum directly, preventing future drift.
2. Added composite `call:function:<sub>` entries for specific function sub-types so the event system reports the precise proto kind (llm_call, eval, etc.).
3. Added an `eventTaskKind()` helper in the do-executor that emits specific sub-kind strings for call:function tasks.

## Implementation Details

### Files Changed

- `backend/services/runner/src/activities/workflow-event-activities.ts` — Imported `WorkflowTaskKind` enum; replaced incorrect TASK_KIND_MAP with enum-referenced values; added call:function sub-type entries.
- `backend/services/runner/src/workflow-engine/do-executor.ts` — Added `eventTaskKind()` helper that resolves call:function tasks to composite kind strings (e.g., `"call:function:llm"`); updated all event emission sites to use the helper.
- `backend/services/runner/src/activities/__tests__/workflow-event-activities.test.ts` — Added 6 regression tests asserting correct proto enum values for key mappings.

### Key Mapping Corrections

| DSL Kind | Before (wrong) | After (correct) |
|---|---|---|
| `call:agent` | 2 (http_call) | 13 (agent_call) |
| `call:http` | 3 (grpc_call) | 2 (http_call) |
| `call:grpc` | 4 (activity_call) | 3 (grpc_call) |
| `switch` | 10 (wait) | 5 (switch_case) |
| `for` | 7 (fork) | 6 (for_each) |
| `fork` | 8 (try_catch) | 7 (fork) |

### Verification

Queried production MongoDB (`workflow_execution_events` collection) and confirmed stored events show `taskKind: 'http_call'` for agent_call tasks, proving the bug was in the writer.

## Benefits

- Task kinds display correctly in the execution timeline UI
- Using the proto enum import prevents future mapping drift
- Fine-grained call:function sub-types provide better observability for LLM, eval, and event tasks
- 6 new regression tests guard against reintroduction of this class of bug

## Impact

- **All workflow executions** with non-trivial task types were affected by incorrect kind display
- Fix applies to both OSS (SQLite storage) and Cloud (MongoDB storage) deployments
- Existing stored events retain incorrect kinds — a backfill migration would be needed for historical data

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes investigation + fix
