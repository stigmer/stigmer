# Fix HITL Approval Identity Chain Failure & Stale `completed_at`

**Date**: March 30, 2026

## Summary

Fixed two interrelated production bugs causing tool approvals to reappear in the UI after being approved. The root cause was a `tool_call_id` identity chain break in the agent-runner's `StatusBuilder`, compounded by a one-way merge bug in the Go server that prevented clearing `completed_at` on non-terminal phases.

## Problem Statement

Users approving tool calls (e.g., `cat workspace/ops/...solr.yaml`) observed the approval prompt reappearing indefinitely. Despite clicking "Approve," the execution remained in `EXECUTION_WAITING_FOR_APPROVAL` phase. Production logs showed 50 out of 51 `[RESUME_UNMATCHED]` errors — approval decisions stored in the database could not match LangGraph checkpoint interrupts.

### Pain Points

- Tool approval dialogs reappearing endlessly after user approval
- `completed_at` timestamp set while phase was `EXECUTION_WAITING_FOR_APPROVAL` — contradictory state
- 50 of 51 stored approval decisions failing to match checkpoint interrupts on resume
- Orphaned sub-agent state accumulating across failed resume cycles

## Solution

**Bug 1 — Identity chain break**: The `handle_tool_start` event handler in `tool_event.py` fell back to using LangGraph's internal `run_id` (UUIDv7 format) as the `ToolCall.id` when no "early tool call" could be reconciled. Since LangGraph checkpoint interrupts carry the model-assigned `toolu_...` ID, the DB-stored ID and checkpoint ID diverged, causing all subsequent resume matching to fail.

**Bug 2 — Stale `completed_at`**: The Go server's `UpdateStatus` merge logic only set `completed_at` from request payloads but never cleared it. When a previous failed cycle set `completed_at`, subsequent status updates with `completed_at = ""` could not propagate the clear, leaving a contradictory state.

## Implementation Details

### Fix 1: `tool_event.py` — Resolve `run_id` through `ToolCallIdCapture`

In both the "task" tool (sub-agent invocation) and regular tool fallback paths of `handle_tool_start`, replaced `ToolCall(id=run_id, ...)` with `ToolCall(id=resolved_id, ...)` where `resolved_id` comes from `sb._tool_call_id_capture.resolve(run_id)`. When the capture has mapped the `run_id` to a model-assigned `toolu_...` ID (via the synchronous `on_tool_start` callback), the correct canonical ID is used. Aliases are registered for future lookups when the IDs differ.

### Fix 2: `update_status.go` — Clear `completed_at` on non-terminal phases

Added a defense-in-depth guard after the timestamp merge: when the merged phase is `IN_PROGRESS`, `WAITING_FOR_APPROVAL`, or `PENDING`, `completed_at` is unconditionally set to empty. This prevents the contradictory state regardless of what the request payload contains.

### Test Suite: `test_hitl_subagent_resume_identity.py`

Created 9 LangGraph integration tests verifying the HITL identity contract:

1. Sub-agent interrupt `tool_call_id` preservation across resume
2. Multiple sequential interrupts with distinct IDs
3. Partial resume behavior documentation
4. Multi-cycle resume (stale decisions don't interfere)
5. `intr.id` vs `intr.value["tool_call_id"]` two-layer identity model
6. Real LLM test with Anthropic (gated by `ANTHROPIC_API_KEY`)

All 9 integration tests + 48 existing `test_hitl_contracts.py` unit tests + 315 `test_status_builder.py` / `test_checkpoint_validator.py` tests pass.

## Benefits

- Tool approvals now clear correctly after user action — eliminates the infinite reapproval loop
- `completed_at` is never set in contradictory states, improving status consistency for downstream consumers (UI, API queries, billing)
- The test suite provides regression protection for the entire HITL identity chain, from LangGraph interrupts through `StatusBuilder` to DB persistence
- `ToolCallIdCapture.resolve()` is now the single source of truth for `tool_call_id` resolution in all code paths

## Impact

- **Agent Runner** (`tool_event.py`): All tool call creation paths now consistently use canonical model-assigned IDs
- **Stigmer Server** (`update_status.go`): Phase-aware timestamp management prevents stale state
- **End Users**: Tool approval dialogs work reliably — approve once, execution proceeds
- **Observability**: Debug logs now include both `run_id` and `resolved_id` for easier production tracing

## Related Work

- `test_hitl_contracts.py` — Existing comprehensive unit tests for HITL resume matching
- `test_native_subgraph_interrupt.py` — Phase 0 sub-graph interrupt propagation verification
- `test_tool_call_id_on_events.py` — ToolCallIdCapture research tests
- Previous fix: `fix(backend/agent-runner): correct concurrent sub-agent resume event routing`

---

**Status**: ✅ Production Ready
**Timeline**: Multi-session investigation and fix
