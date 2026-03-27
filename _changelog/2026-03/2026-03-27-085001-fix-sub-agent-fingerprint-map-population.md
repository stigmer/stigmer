# Fix Sub-Agent Fingerprint Map Population

**Date**: March 27, 2026

## Summary

Fixed a missing fingerprint-to-tool-call-id mapping for sub-agent tool calls in `populate_fingerprints_from_existing_tool_calls()`. This bug caused Priority 2 fingerprint matching to silently fail for sub-agent HITL approvals and prevented run-ID alias creation on the resume-after-approval path.

## Problem Statement

`populate_fingerprints_from_existing_tool_calls()` in `StatusBuilder` had an asymmetry between its top-level and sub-agent tool call handling loops. Both loops added fingerprints to the `tool_call_fingerprints` dedup set, but only the top-level loop populated `_fingerprint_to_tool_call_id`.

### Pain Points

- **Priority 2 fingerprint matching always missed sub-agent tools**: `InterruptCapture._match_interrupt` uses `_fingerprint_to_tool_call_id` for fingerprint-based matching. For sub-agent tool calls, the map was always empty, forcing a fallthrough to Priority 3 (name-based matching), which is order-dependent and fragile when multiple tools share the same name.
- **Resume-path alias creation failed silently**: When LangGraph re-fires `on_tool_start` for a resumed sub-agent tool with a new `run_id`, the fingerprint dedup check succeeded but `_fingerprint_to_tool_call_id.get(fingerprint)` returned `None`. No run-ID alias was created, so `on_tool_end` could not find and update the original `ToolCall` to COMPLETED.

## Solution

Added 2 lines in the sub-agent loop of `populate_fingerprints_from_existing_tool_calls()` to populate `_fingerprint_to_tool_call_id`, mirroring the identical pattern already used for top-level tool calls.

## Implementation Details

**Production code** (`status_builder.py`): 2 lines added in the sub-agent loop after `self.tool_call_fingerprints.add(fingerprint)`:

```python
if tc.id:
    self._fingerprint_to_tool_call_id[fingerprint] = tc.id
```

**Contract tests** (`test_hitl_contracts.py`): Added Contract 7 (`TestSubAgentFingerprintMapPopulation`) with 3 tests:
- `test_sub_agent_tool_call_fingerprint_in_map` — core case: sub-agent tool call fingerprint appears in the map
- `test_top_level_and_sub_agent_both_populated` — both top-level and sub-agent coexist correctly
- `test_sub_agent_tool_call_without_id_skipped` — edge case: empty-id tool calls don't pollute the map

## Benefits

- Sub-agent HITL approval matching now uses fingerprint-based Priority 2 matching instead of falling through to fragile name-based Priority 3
- Resume-after-approval for sub-agent tool calls correctly creates run-ID aliases, enabling `on_tool_end` to find and update the original tool call
- All 22 HITL contract tests pass, all 279 status builder tests pass — zero regressions

## Impact

- **Agent Runner (Python)**: Sub-agent tool calls with HITL approval gates now match correctly via fingerprints on the resume path
- **End users**: Sub-agent tool calls that required approval will now reliably transition to COMPLETED after the user approves, instead of silently failing to update

## Related Work

- Part of the `20260326.02.hitl-approval-flow-hardening` project (Task 2 of 6)
- Builds on Task 1 (ApprovalStateManager lifecycle enforcement) completed in the previous session
- Related changelogs: `2026-03-26-211525-enforce-approval-lifecycle-state-manager.md`, `2026-03-26-201753-hitl-approval-flow-hardening.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
