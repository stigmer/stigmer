# ExecutionState Reducer Refactor (T07)

**Date**: March 29, 2026

## Summary

Extracted ~24 mutable instance variables from StatusBuilder into a typed `ExecutionState` dataclass, unified the run_id alias mechanism into `ToolCallIdCapture`, eliminated all private API leakage from external callers, and added proto-based index reconstruction. This is the structural foundation that makes StatusBuilder's state visible, typed, and recoverable — preparing for handler extraction in T08.

## Problem Statement

StatusBuilder had grown to 3,500+ lines with 31 loosely-documented instance variables initialized across a 225-line `__init__`. State was opaque, untyped in practice (everything was `dict[str, Any]` in spirit), and not recoverable on pod restart beyond a basic tool call index rebuild.

### Pain Points

- **No explicit state model**: 24+ dicts/lists/sets scattered through `__init__` with no type-level documentation of their purpose or lifecycle
- **Duplicate identity resolution**: `_run_id_aliases` on StatusBuilder duplicated functionality already in `ToolCallIdCapture`, creating two places to maintain the same logic
- **Private API leakage**: Three external callers (`streaming.py`, `hitl.py`, `post_stream.py`) accessed private `_` members directly, coupling them to internal implementation details
- **No typed reconstruction**: On resume, only tool call indexes were rebuilt; sub-agent completion state and artifacts were lost

## Solution

A 6-step structural refactor that preserves all behavior while making state explicit:

1. **Fold `_run_id_aliases`** into `ToolCallIdCapture` as the single authority for run_id → tool_call_id resolution
2. **Fix private API leakage** with public methods/properties
3. **Define `ExecutionState`** dataclass with 3 sub-groups for tightly-coupled fields
4. **Mechanical migration** of all `self._<state>` → `self.state.<field>` references
5. **`rebuild_from_proto()`** classmethod for proto-based index reconstruction
6. **Test updates** including 8 new `rebuild_from_proto` tests

## Implementation Details

### New `ExecutionState` dataclass (`execution_state.py`)

21 top-level fields organized into semantic groups:

- **Proto indexes** (4): `tool_calls`, `messages_by_run`, `current_ai_message`, `last_llm_run_id`
- **Sub-agent routing** (5): `active_sub_agents`, `completed_sub_agents`, `run_id_to_tool_call_id`, `namespace_to_sub_agent`, `subject_counts`
- **Streaming buffers** (3): `thinking` (sub-group), `tool_input` (sub-group), `early_tool_call_queue`
- **Timing / observability** (4): `tool_start_times`, `message_start_times`, `sub_agent_message_start_times`, `pending_completion_flush`
- **Approval** (1): `approval` (sub-group)
- **Other** (3): `warned_namespaces`, `context_info`, `artifacts`

Three sub-groups extract tightly-coupled fields that share a lifecycle:

- `ThinkingStreamState`: 3 dicts all keyed by namespace, always mutated together
- `ToolInputStreamState`: active tool tracking + partial JSON buffers, always used together
- `ApprovalTrackingState`: set together on WAITING_FOR_APPROVAL entry, cleared together on exit

### ToolCallIdCapture unification

Added two methods to the existing `ToolCallIdCapture` callback handler:

- `register_alias(new_run_id, tool_call_id)`: records resume-path aliases
- `resolve(run_id)`: checks aliases → callback mapping → fallback to input

This eliminated `_run_id_aliases` and `_resolve_run_id()` from StatusBuilder entirely.

### StatusBuilder `__init__` simplification

Before: ~225 lines of individual field initialization with block comments.
After: ~15 lines — config/collaborators + `self.state = ExecutionState(proto=initial_status)`.

`current_status` became a property delegating to `self.state.proto` for backward compatibility.

### `rebuild_from_proto()` classmethod

Reconstructs proto-derivable indexes from a persisted `AgentExecutionStatus`:
- Tool call indexes from main agent + sub-agent messages
- Completed sub-agents (terminal status)
- Artifacts

Ephemeral runtime state (run_id maps, streaming buffers, timing) starts fresh — streaming resumes from checkpoint.

## Benefits

- **Type safety**: Every state field is documented with its purpose, key type, and lifecycle
- **Single source of truth**: Run_id resolution unified in `ToolCallIdCapture` — one place to understand, one place to debug
- **Clean boundaries**: Zero private API access from external callers
- **Recovery**: `rebuild_from_proto()` reconstructs all proto-derivable state, not just tool calls
- **Handler extraction ready**: Sub-grouped state (`ThinkingStreamState`, `ToolInputStreamState`, `ApprovalTrackingState`) serves as natural parameter boundaries for T08

## Impact

- **StatusBuilder**: Internal state is now explicit, typed, and documented — no more "what does `_llm_run_id_to_message` do?" guesswork
- **Callers** (`streaming.py`, `hitl.py`, `post_stream.py`): Use public API only — safe from internal restructuring
- **Tests**: 1,382 pass (8 new, 0 regressions) — all behavioral tests unchanged, only reference paths updated
- **Future work (T08)**: Handler extraction can proceed with `ExecutionState` as a first-class parameter to focused collaborator modules

## Related Work

- T04: Identity-based lookup via `ToolCallIdCapture` (foundation for alias unification)
- T05: Deterministic namespace routing via `parent_ids` (simplified sub-agent state)
- T06: End-to-end pause/resume (motivation for `rebuild_from_proto`)
- T08 (next): Extract event handlers to shrink StatusBuilder below 500 lines

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
