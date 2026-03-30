# T03: Eliminate HITL Bidirectional Fallback Matching

**Date**: March 30, 2026

## Summary

Deleted the bidirectional fallback matching block from the HITL resume path in `execute_graphton.py`, replacing 40 lines of compensating complexity with a 6-line observability warning. The identity chain now fails loud instead of silently pairing unmatched decisions with random interrupts. T02 research empirically confirmed the primary identity path works correctly, making the fallback unnecessary.

## Problem Statement

The resume-matching logic in Step 7.5 of `execute_graphton.py` had two stages:

1. **Primary matching**: joins approval decisions to checkpoint interrupts by `tool_call_id` -- a direct lookup.
2. **Bidirectional fallback**: when some decisions didn't match, it paired any unmatched decision with any unmatched interrupt regardless of whether their `tool_call_id`s matched.

### Pain Points

- The fallback was FIFO positional matching disguised as "defense-in-depth" -- it paired the first unmatched decision with the first unmatched interrupt, regardless of identity
- It masked identity chain failures by silently recovering, making root-cause analysis impossible
- The `[RESUME_ID_MISMATCH]` warning it logged was an admission that the system was broken, not a safety net
- It violated the "Direct Identity -- No Fuzzy Matching" architectural principle

## Solution

Deleted the fallback and replaced it with an `ERROR`-level log that surfaces unmatched decisions with their `tool_call_id`s, pointing directly at `ToolCallIdCapture` and `StatusBuilder` for investigation.

## Implementation Details

- **`execute_graphton.py`**: Deleted the 40-line `Defense-in-depth: bidirectional ID lookup` block (lines 1722-1761). Replaced with a 6-line observability warning logging `[RESUME_UNMATCHED]` at ERROR level.
- **`test_hitl_contracts.py`**: Deleted the `TestBidirectionalIdLookup` class (3 tests, ~120 lines) and updated the module docstring.

What was NOT changed:
- `ToolCallIdCapture` aliases and `register_alias()` (legitimate resume-path run_id re-mapping)
- `ResumeReconciler` (reconciles tool call statuses on resume)
- `tool_event.py` identity dedup (correct resume-path handling)
- Primary matching loop, zero-match error handling

## Benefits

- **-154 lines** of code removed (30 from execute_graphton.py, 123 from tests, 1 from docstring)
- Identity chain failures now surface as visible errors instead of being silently masked
- The resume path is simpler and easier to reason about
- Aligns with "Delete Over Refactor" and "Direct Identity" architectural principles

## Impact

- `execute_graphton.py`: 2,127 → 2,097 lines
- All 1,379 tests pass (1,382 - 3 deleted tests for deleted behavior)
- No behavioral change for the happy path -- primary matching was always the correct path
- Broken identity chains that previously silently recovered will now fail with a clear error log

## Related Work

- **T02: LangGraph v2 tool_call_id Research** -- empirically confirmed the primary identity path works, giving confidence to delete the fallback
- **T01: Quick Wins** -- error dedup, InlinePublisher extraction, recursion limit constant
- **T04: SetupOrchestrator Extraction** -- next task, now unblocked by T01 + T03

---

**Status**: Production Ready
**Timeline**: ~15 minutes
