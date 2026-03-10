# Sub-Agent Subject Simplification and Approval Dual-Surfacing

**Date**: March 10, 2026

## Summary

Eliminated the redundant economy-tier LLM call that generated sub-agent subjects, replacing it with direct population from the task tool's `description` arg. Added pending_approvals dual-surfacing so sub-agent-originated approvals appear on both the parent `AgentExecutionStatus` and the owning `SubAgentExecution`, enabling entity-level isolation for future consumers.

## Problem Statement

Two gaps in the agent-runner's sub-agent handling:

### Pain Points

- **Wasted LLM call**: Every sub-agent spawn triggered `_generate_sub_agent_subject()` — an economy-tier LLM call that summarized what the invoking LLM had already summarized via the task tool's `description` arg. This added latency, cost, and non-determinism for zero value.
- **Opaque approval ownership**: When a sub-agent's tool needed approval, the `PendingApproval` only appeared on the parent `AgentExecutionStatus.pending_approvals`. The `SubAgentExecution` entity itself had no record it was blocked, making it impossible for downstream consumers (future web UI, API clients) to query a single sub-agent's approval state without scanning the parent.

## Solution

**Subject simplification (DD-02)**: Set `subject = tool_args.get("description", "")` directly in `_handle_sub_agent_start`. Delete `_generate_sub_agent_subject()`, its constants (`_SUBJECT_SYSTEM_PROMPT`, `_MAX_SUBJECT_LENGTH`), and four now-unused imports (`ModelRegistry`, `parse_model_string`, `SystemMessage`/`HumanMessage`, `Config`). The method becomes synchronous.

**Approval dual-surfacing**: Add `sync_sub_agent_pending_approvals()` to `StatusBuilder` — called from `execute_graphton.py` after interrupt capture. It matches each sub-agent-originated `PendingApproval` to its owning `SubAgentExecution` via `tool_call_id` correlation against the sub-agent's `tool_calls`, sets `child_agent_execution_id` before the protobuf copy, and appends to `SubAgentExecution.pending_approvals`. Clearing and single-approval removal propagate to sub-agents, resolving through `_run_id_aliases` for the reconciliation path.

## Implementation Details

### status_builder.py

- Deleted ~95 lines: `_generate_sub_agent_subject()`, `_SUBJECT_SYSTEM_PROMPT`, `_MAX_SUBJECT_LENGTH`, and the section header comment
- Removed 4 imports only used by the deleted function
- `_handle_sub_agent_start`: now sync, sets `subject` from `description`, no metadata `Struct`
- `sync_sub_agent_pending_approvals()`: idempotent dual-surfacing with `child_agent_execution_id` set before protobuf `append` (copy semantics)
- `clear_pending_approval()`: also clears all `SubAgentExecution.pending_approvals`
- `_remove_from_pending()`: resolves `_run_id_aliases` to find the correct `PendingApproval.tool_call_id` when the reconciliation path assigned a temp_id

### execute_graphton.py

- 1-line addition: call `status_builder.sync_sub_agent_pending_approvals()` after setting parent-level `pending_approvals`

### test_status_builder.py

- 6 new tests covering subject from description, empty subject, no metadata struct, dual-surfacing, main-agent skip, and clear propagation

## Benefits

- **Eliminated per-spawn LLM cost and latency** — subject appears instantly from the invoking LLM's own label
- **Entity-level approval isolation** — `SubAgentExecution` now reflects its own blocked state
- **`child_agent_execution_id` populated** — consumers can correlate approvals to sub-agents without rescanning
- **Net code reduction** — ~95 lines of LLM infrastructure deleted, ~60 lines of dual-surfacing added

## Impact

- **Agent Runner**: Every sub-agent spawn is faster (no LLM round-trip). Approval state is fully consistent across parent and sub-agent entities.
- **CLI**: No immediate changes needed — CLI already reads parent-level approvals. PR4 will leverage the sub-agent-level approvals for contextual display.
- **Future consumers**: Web UI or API clients can query `SubAgentExecution.pending_approvals` directly for entity-level approval state.

## Related Work

- Follows PR1 (`ab9244b0`) which added `pending_approvals` field 14 and `SUB_AGENT_CANCELLED = 5` to the proto model
- Implements design decisions DD-02 (subject from description) and DD-04 (no fallback for empty subject)
- Part of project `20260309.01.sub-agent-execution-streamline`

---

**Status**: Production Ready
**Timeline**: PR2 of 5 in the sub-agent execution streamline project
