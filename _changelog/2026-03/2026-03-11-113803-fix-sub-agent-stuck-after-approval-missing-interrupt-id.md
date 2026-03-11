# Fix Sub-Agent Stuck After Approval Due to Missing `interrupt_id`

**Date**: March 11, 2026

## Summary

Fixed a critical bug where sub-agent tool calls (particularly `execute`) would get stuck in "Working..." after the user approved them. The root cause was a `from_sub_agent` mismatch between the interrupt payload (`False`) and the Phase 1 `PendingApproval` entry (`True`), which caused Phase 2 enrichment to fail, leaving `interrupt_id` empty. Without `interrupt_id`, the resume path fell through to fresh execution instead of `Command(resume=decision)`, causing the graph to loop or stall.

## Problem Statement

After the non-destructive merge/enrich strategy was introduced (previous changelog), sub-agent approvals still got stuck — but at a different stage. The approval prompt now appeared correctly (Phase 1 was working), but after the user approved, the agent remained in "Working..." and never resumed execution.

### Pain Points

- Sub-agent `execute` / `write` / `edit` approvals get stuck after the user approves
- The agent-runner logs showed `pending_approvals entry ... has no interrupt_id. Falling back to single resume.` followed by a fresh execution that re-hit the same interrupt
- The status builder logged `could not match sub-agent PendingApproval ... to any active sub-agent` during `sync_sub_agent_pending_approvals`

## Solution

Three layered changes, ordered by criticality:

1. **Source fix**: Thread `sub_agent_name` through platform tool and MCP tool wrapper creation so interrupt payloads carry `from_sub_agent=True` for sub-agent tools
2. **Phase 2 defense-in-depth**: Broaden name-based matching to search sub-agent tool calls when `from_sub_agent=False` matching fails, and relax `_try_enrich_phase1_entry` to ignore `from_sub_agent` as a last resort
3. **Resume defense-in-depth**: When `interrupt_id` is missing during resume dict construction, query the graph checkpoint to discover the actual interrupt ID rather than giving up

## Implementation Details

### Change 1: Thread `sub_agent_name` through tool wrappers (Primary Fix)

**Files**: `tool_wrappers.py`, `subagent_transformer.py`

Platform tool factories (`_create_execute_tool`, `_create_write_tool`, `_create_edit_tool`, `_create_read_tool`) called `_check_and_handle_approval` without sub-agent context, so the interrupt payload always said `from_sub_agent=False`. Phase 1 correctly set `from_sub_agent=True` via namespace routing, creating a mismatch that broke Phase 2 matching.

- Added `sub_agent_name: str = ""` parameter to all four dangerous-tool factories, `_register_alias`, and `create_platform_tool_wrappers`
- Each factory captures `_is_sub_agent` and `_sub_agent_name` in its closure and passes them to `_check_and_handle_approval`
- Changed `subagent_transformer.py` from creating shared platform tools once to creating per-subagent wrappers with the correct `sub_agent_name` (the sandbox backend is still shared; only closures differ)
- Added `sub_agent_name` to `_create_subagent_mcp_tools` → `create_approval_aware_tool_wrapper`

### Change 2: Broaden Phase 2 matching scope (Defense-in-depth)

**File**: `execute_graphton.py`

Two sub-changes:

1. In the `from_sub_agent=False` name-based matching branch, added a fallback that searches `sub_agent_executions[].tool_calls` when top-level matching fails
2. Changed `_try_enrich_phase1_entry` from a single-pass strict match (tool_name + from_sub_agent) to a two-pass strategy: strict first, then relaxed (tool_name only, ignoring `from_sub_agent`)

### Change 3: Resume fallback for missing `interrupt_id` (Defense-in-depth)

**File**: `execute_graphton.py`

When `pa.interrupt_id` is empty during resume dict construction, instead of clearing `resume_dict` and breaking:

1. Collects entries needing discovery in a separate list
2. After the loop, queries `agent_graph.aget_state()` to get the graph checkpoint's interrupts
3. Matches by `tool_name`, with a single-interrupt/single-approval fast path
4. Falls back gracefully if discovery fails (clears `resume_dict`, activity retries)

### Testing

- **6 new tests** in `test_tool_wrappers.py`: `from_sub_agent=True` in interrupt payloads for execute/write/edit/read, parent-agent `False` baseline, alias tool inheritance
- **9 new tests** in `test_approval_resume.py`: strict matching, relaxed matching with `from_sub_agent` mismatch, precedence, edge cases (empty list, multiple entries, wrong tool_name)

## Benefits

- Sub-agent tool approvals now resume correctly after user approval
- The interrupt payload carries correct `from_sub_agent` metadata, enabling Phase 2 to enrich properly
- Two defense-in-depth layers ensure resilience even if the source fix is bypassed (legacy wrappers, third-party tools)
- Structured `[RESUME_FALLBACK]` logging enables rapid triage when interrupt discovery is needed

## Impact

- **Agent execution reliability**: Eliminates the post-approval stuck state for sub-agent tools
- **CLI users**: Sub-agent tool calls resume immediately after approval instead of hanging indefinitely
- **No breaking changes**: `create_platform_tool_wrappers` defaults to `sub_agent_name=""` (backward compatible), and the defense-in-depth changes are strictly additive

## Related Work

- `2026-03-11-104340-fix-sub-agent-stuck-pending-approvals-clobbering.md` — fixed Phase 2 clobbering Phase 1 entries (approval prompt not appearing)
- `2026-03-11-081756-fix-approval-validation-tool-call-id-mismatch.md` — introduced Phase 2 interrupt capture and `interrupt_id`

---

**Status**: ✅ Production Ready
