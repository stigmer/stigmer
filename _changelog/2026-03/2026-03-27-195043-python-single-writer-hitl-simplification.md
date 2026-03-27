# Python Single Writer to Messages — HITL Simplification (T03)

**Date**: March 27, 2026

## Summary

Refactored the Python agent-runner to make `messages[].tool_calls` the single source of truth for tool call state, eliminating the flat `tool_calls` list from `AgentExecutionStatus` and removing Python-managed `pending_approvals`. This is the largest task in the HITL approval cleanup project, deleting three entire classes and replacing ~140 lines of complex resume logic with ~40 lines of direct checkpoint queries. Net result: -2,110 lines across 7 files with all 276 tests passing.

## Problem Statement

After T02 removed the flat `tool_calls` field from the `AgentExecutionStatus` and `SubAgentExecution` protos, the Python agent-runner had multiple broken code paths that still referenced these fields. More fundamentally, the codebase had accumulated significant complexity from maintaining multiple sources of truth:

### Pain Points

- `StatusBuilder` maintained a flat `current_status.tool_calls` list that had to be kept in sync with tool calls embedded in `AgentMessage`s — any sync failure meant silent data divergence
- `hitl.py` contained four classes (`ApprovalStateManager`, `InterruptCapture`, `ResumeReconciler`, `CheckpointFallback`) totaling ~700 lines for HITL approval flow — most of this complexity existed to work around the multiple-source-of-truth problem
- `_populate_pending_approval` and `sync_sub_agent_pending_approvals` duplicated approval state across parent and sub-agent execution contexts
- The resume path in `execute_graphton.py` was ~140 lines of complex join logic correlating `PendingApproval` entries with `SubmitApprovalInput` decisions and falling back to checkpoint queries
- `_update_tool_call_on_ai_message` existed solely to propagate changes from the flat list back into message-embedded copies

## Solution

Introduced an in-memory tool call index (`_tool_call_index: dict[str, ToolCall]`) in `StatusBuilder` that stores direct protobuf references to `ToolCall` objects embedded within `AgentMessage`s. This leverages Python protobuf reference semantics: when a protobuf object is appended to a repeated field, a copy is made, but `repeated_field[-1]` returns a reference to that copy. Mutations via this reference propagate directly to the serialized status without explicit sync.

## Implementation Details

### Phase 1: StatusBuilder — Single Source of Truth

- Added `_tool_call_index` dict and three public helpers (`get_tool_call`, `iter_all_tool_calls`, `tool_call_count`)
- Replaced 6 flat-list write sites with message append + index registration
- Replaced ~10 flat-list read sites with index lookups
- Deleted `_populate_pending_approval`, `clear_pending_approval`, `sync_sub_agent_pending_approvals`; extracted `_set_waiting_for_approval_phase` for phase management
- Rewrote `populate_fingerprints_from_existing_tool_calls` to scan messages and rebuild the index on resume
- Deleted `_update_tool_call_on_ai_message` (redundant with direct references)
- Added `args_preview` population at ToolCall creation time

### Phase 2: hitl.py — Drastic Simplification

- Deleted `ApprovalStateManager` (lifecycle state management — now server-side)
- Deleted `InterruptCapture` (interrupt-to-approval matching — now uses `tool_call_id` directly)
- Deleted `CheckpointFallback` (fallback checkpoint querying for resume)
- Simplified `ResumeReconciler` from ~200 lines to ~120 lines: iterates `approval_decisions`, looks up tool calls via index, updates status directly

### Phase 3: execute_graphton.py — Simplified Resume Path

- Replaced ~140 lines of complex resume logic with ~40 lines
- Directly queries `agent_graph.aget_state()` for interrupts
- Matches by `tool_call_id` to build `resume_dict`
- No more reliance on `pending_approvals` from persisted status or `CheckpointFallback`

### Phase 4: post_stream.py

- Removed `InterruptCapture` instantiation block
- Updated `auto_publish_fn` to use `iter_all_tool_calls()`
- Simplified function signature (removed 5 now-unused parameters)

### Phase 5: streaming.py

- Replaced 3 occurrences of flat-list counting with `tool_call_count()`
- Replaced tool-call lookup loop with `get_tool_call()` call

### Phase 6: Tests

- `test_hitl_contracts.py`: Complete rewrite — 10 focused tests covering `ResumeReconciler`, fingerprint dedup, and index rebuild on resume
- `test_status_builder.py`: Comprehensive adaptation — updated 266 tests for the message-embedded model, deleted tests for removed classes/methods, fixed sub-agent tool_calls references

## Benefits

- **-2,110 net lines**: 562 insertions vs 2,672 deletions across 7 files
- **3 classes deleted**: `ApprovalStateManager`, `InterruptCapture`, `CheckpointFallback` — entire categories of bugs eliminated
- **Single source of truth**: Tool call state lives exclusively in `messages[].tool_calls`, indexed by `_tool_call_index` for O(1) access
- **Resume path 3.5x simpler**: 40 lines vs 140 lines, direct checkpoint query instead of multi-step correlation
- **No sync bugs possible**: With the index holding direct protobuf references, mutations are inherently consistent — no explicit sync code needed
- **276 tests pass**: Full green across both test files

## Impact

- **agent-runner service**: All tool call reads and writes now go through the index → message path. Developers working on tool call handling only need to understand one data flow.
- **HITL approval flow**: Dramatically simpler to reason about. `pending_approvals` is now a server-side concern — Python doesn't manage it at all.
- **Unblocks T05 (Java/Go)**: The server-side can now safely compute `pending_approvals` from message-embedded tool calls, knowing Python won't fight it.

## Related Work

- [T01 Research](2026-03-27-094233-hitl-tool-call-id-research.md): Confirmed `tool_call_id` availability at interrupt time
- [T02 Proto cleanup](2026-03-27-155012-hitl-proto-data-model-cleanup.md): Removed flat `tool_calls` from protos
- [T04 Interrupt payload](2026-03-27-094233-hitl-frontend-approval-resilience.md): Added `tool_call_id` to interrupt payload

---

**Status**: ✅ Production Ready
**Timeline**: Session 4 (continuing from Sessions 1-3)
