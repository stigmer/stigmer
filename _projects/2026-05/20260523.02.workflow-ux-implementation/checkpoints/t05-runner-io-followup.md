# Follow-Up Task: Runner Must Populate Full I/O on WorkflowTask Status Entries

**Created:** 2026-05-23 (during T05 — Runtime Inspector Panel)
**Type:** Backend (Go/TypeScript runner)
**Priority:** High — the inspector, timeline, and any future execution analytics depend on this data

---

## Problem

The `WorkflowTask` proto defines rich per-task fields:
- `input` (`google.protobuf.Struct`) — full resolved task input
- `output` (`google.protobuf.Struct`) — full task output
- `metadata` (`google.protobuf.Struct`) — retry count, agent exec ID, etc.
- `artifact_ids` (`repeated string`) — artifact references
- `cost_micros` (`int64`) — per-task cost
- `input_tokens` / `output_tokens` (`int64`) — per-task token counts

But the current OSS runner only writes **5 fields** to `execution.status.tasks[]`:
- `taskName`
- `status`
- `startedAt`
- `completedAt`
- `error`

The T05 Runtime Inspector reads `WorkflowTask.input` and `WorkflowTask.output` for the Input/Output tabs, but they are always empty today. The inspector handles this gracefully with "Input data not available for this execution" empty states, but the intended UX requires full data.

## Files to Modify

- `backend/services/runner/src/workflow-engine/task-status-accumulator.ts` — must track input Struct (from task config resolution) and output Struct (from activity result) per task
- `backend/services/runner/src/activities/workflow-event-activities.ts` — must include input/output/metadata/cost/tokens in the `WorkflowTask` entries sent via `updateStatus` RPC

## What Must Be Populated

| Field | Source |
|-------|--------|
| `input` | Resolved task config after expression evaluation |
| `output` | Activity result (Struct) on completion |
| `metadata` | Retry count, child agent execution ID, headers |
| `artifact_ids` | From artifact store promotion (auto or explicit) |
| `cost_micros` | From agent/LLM call cost tracking |
| `input_tokens` / `output_tokens` | From agent/LLM call token tracking |

## Testing

Integration test verifying input/output appear on `execution.status.tasks[]` after a completed `set_vars` / `http_call` / `agent_call` workflow. The existing `test/integration/harness/` infrastructure supports this.

## Impact

Without this data:
- Inspector Input/Output tabs show empty states
- Per-task cost/token attribution is incomplete
- Artifact linking to specific tasks is unavailable
- The execution viewer's detailed debugging capability is limited
