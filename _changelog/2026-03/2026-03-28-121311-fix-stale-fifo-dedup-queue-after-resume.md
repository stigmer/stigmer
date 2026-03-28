# Fix Stale FIFO Dedup Queue After Resume

**Date**: March 28, 2026

## Summary

Fixed a bug where the FIFO dedup queue (`_reconciled_resume_tool_calls`) retained stale entries after fingerprint dedup handled resumed tool calls. When the LLM generated a genuinely new tool call with the same tool name after resume, the stale FIFO entry captured it incorrectly, aliasing it to an old completed tool call. This prevented the phase from transitioning to `WAITING_FOR_APPROVAL`, causing checkpoint validation failure (`EXECUTION_FAILED`).

## Problem Statement

After approving and resuming 3 `execute` tool calls, the LLM produced a 4th `execute` tool call that required approval. The execution failed with: "Graph has pending nodes ['tools'] but stream ended without WAITING_FOR_APPROVAL or PAUSED phase".

### Pain Points

- `ResumeReconciler` populated the FIFO queue with 3 entries for the 3 approved tools
- Fingerprint dedup caught all 3 resumed `on_tool_start` events and returned early -- the FIFO queue was never consumed
- The 4th (genuinely new) tool call had different args, so fingerprint dedup missed it, but the stale FIFO queue matched by tool name and aliased it to an old completed tool
- `_handle_tool_start_event` returned early without creating a new ToolCall, checking approval, or calling `_set_waiting_for_approval_phase`

## Solution

When fingerprint dedup succeeds in `_handle_tool_start_event`, remove the matched `original_tc_id` from the FIFO queue for that tool name. This keeps the two dedup mechanisms in sync and prevents stale entries from capturing genuinely new tool calls.

## Implementation Details

**`status_builder.py`**: Added 5 lines to the fingerprint dedup block in `_handle_tool_start_event`. After recording the run-ID alias, `deque.remove(original_tc_id)` drains the corresponding FIFO entry. The `ValueError` is caught defensively for entries not present in the queue.

**`test_hitl_contracts.py`**: Added 2 tests verifying (1) the FIFO queue is drained when fingerprint dedup matches, and (2) a genuinely new same-name tool call is not incorrectly aliased after 3 resumed tools are deduped by fingerprint.

## Benefits

- Fixes execution failures when new tool calls follow batch-approved tools with the same name
- No new mechanisms -- just a `remove()` call keeping existing dedup mechanisms in sync

## Impact

- **Users**: New tool calls after batch resume no longer fail when they share a tool name with the resumed tools
- **Architecture**: Consistent invariant that FIFO queue only contains entries for tools not yet deduped by fingerprint

## Related Work

- Previous fix in this session: [HITL batch approval race condition](2026-03-28-114453-fix-hitl-batch-approval-race-condition.md) -- fixed the Temporal signal counting; this fix addresses a separate dedup bug exposed by the same batch approval scenario

---

**Status**: Production Ready
