# Workflow Runner: Full Task I/O, Cost, and Token Status Population

**Date**: May 23, 2026

## Summary

Populated the 9 previously-empty `WorkflowTask` proto fields (`input`, `output`, `task_type`, `metadata`, `cost_micros`, `input_tokens`, `output_tokens`) in the TypeScript workflow runner, fixed execution-level terminal state emission, and fixed a server-side merge gap — unblocking the T05 Runtime Inspector from showing real per-task execution data.

## Problem Statement

The T05 Runtime Inspector (implemented earlier today) reads `WorkflowTask` fields for its Input, Output, Summary, and Agent Call tabs. But the runner only populated 5 of 14 proto fields: `task_name`, `status`, `started_at`, `completed_at`, `error`. All other tabs showed graceful empty states.

### Pain Points

- Inspector Input/Output tabs always showed "Input data not available for this execution"
- Per-task cost and token attribution was impossible (always 0)
- No `task_type` mapping meant the inspector couldn't show task-type-specific UI
- Execution-level totals (`total_cost_micros`, `total_input_tokens`, `total_output_tokens`) were hardcoded to 0 in the runner AND ignored by the server's merge logic
- `execution_completed` event never set terminal phase or `completed_at` on the status
- `execution_failed` event never identified which task failed

## Solution

End-to-end enrichment across three layers:
1. **Go Server** — Fixed gRPC `updateStatus` merge logic to accept cost/token totals
2. **TypeScript Runner** — Extended accumulator, wired capture at task boundaries, mapped to full proto
3. **Integration Tests** — Offline test verifying per-task fields round-trip through the system

## Implementation Details

### Go Server (1 file)
- `update_status.go`: Added conditional merge for `total_cost_micros`, `total_input_tokens`, `total_output_tokens` — previously these fields were preserved from existing (always 0), now they merge when non-zero

### TypeScript Runner (7 files)
- **`task-status-accumulator.ts`**: Extended `TaskStatusEntry` with `input`, `output`, `metadata`, `costMicros`, `inputTokens`, `outputTokens`; added `taskStartedWithInput()`, `taskCompletedWithResult()`, `setTaskMetadata()` methods; added sandbox-safe `truncatePayload()` utility (64KB cap with summary marker)
- **`do-executor.ts`**: Captures pipeline input at task start, extracts cost/tokens from output via `extractCostFromOutput`, populates real values in `task_completed` events, sets agent metadata (`agent_execution_id`, `tool_call_count`)
- **`call-agent.ts`**: Enriches `AgentCallResult` with `__stigmer_cost_micros` and `input_tokens` from `usage_summary` so budget extraction picks them up
- **`call-eval.ts`**: Surfaces `input_tokens`/`output_tokens` from internal LLM call in `EvalResult` (previously stripped)
- **`workflow-event-activities.ts`**: Full `TaskStatusEntry` → `WorkflowTask` proto mapping with `task_type`, `input`/`output`/`metadata` as JsonObject Structs, `cost_micros`/`input_tokens`/`output_tokens`; emits terminal phase/completedAt/totals on completion/failure
- **`engine-core.ts`**: Aggregates cost/tokens from accumulator for `execution_completed` event; populates `failedTaskName` from accumulator on failure
- **`types.ts`**: Added `totalInputTokens`/`totalOutputTokens` to `ExecutionCompletedEvent`

### Tests
- **19 unit tests**: Accumulator methods, `truncatePayload` edge cases (large objects, circular refs, null)
- **Integration test**: `set_vars` → `llm_call` workflow with mock LLM (150/20 tokens) → asserts per-task input/output/tokens, task_type, execution totals

### Task Kind → Proto Type Mapping
- `call:agent` → `AGENT_INVOCATION`
- `call:function:llm` / `call:http` / `call:grpc` → `API_CALL`
- `human_input` → `APPROVAL`
- `switch` → `CONDITIONAL`
- `fork` / `for` → `PARALLEL`
- `set` / `call:function:transform` / `call:function:validate` → `TRANSFORM`
- `try` / `listen` / `wait` / `raise` / `run` → `CUSTOM`

## Benefits

- T05 Runtime Inspector now shows real data without any frontend changes
- Per-task cost/token attribution enables workflow cost optimization
- `task_type` mapping enables type-specific inspector UI
- Execution-level totals enable dashboard cost summaries
- `failedTaskName` enables auto-selection of failed node in execution graph

## Impact

- **Frontend**: T05 Inspector Input/Output/Summary tabs immediately show data
- **Backend**: Zero breaking changes — additive enrichment only
- **Testing**: 540 existing workflow engine tests pass, 190 activity tests pass, zero regressions

## Related Work

- T05 Runtime Inspector (earlier today): Built the UI that reads these fields
- `checkpoints/runner-task-io-followups.md`: 8 deferred items documented (pending_approvals race, budget enforcement, resolved-config capture, agent live status, LLM pricing, artifact refs, task_id)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours implementation
