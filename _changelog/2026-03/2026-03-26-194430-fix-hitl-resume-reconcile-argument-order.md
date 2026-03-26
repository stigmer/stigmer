# Fix HITL Resume Reconcile Argument Order

**Date**: March 26, 2026

## Summary

Fixed a regression where the RESUME_RECONCILE code path crashed with `AttributeError: 'str' object has no attribute 'type'` immediately after approving a tool call. The root cause was swapped positional arguments in four calls to `_update_tool_call_on_ai_message`.

## Problem Statement

After approving a tool call in the HITL flow, the execution failed with:

```
AttributeError: 'str' object has no attribute 'type'
```

The resume path was activating correctly (`Batch resume from 1 approval(s)`) and tool call status transitions were succeeding (`WAITING_APPROVAL -> TOOL_CALL_RUNNING`), but the subsequent message-embedded copy sync crashed before the stream could begin.

### Pain Points

- Every approved tool call immediately failed the execution
- The error was non-obvious — the traceback pointed at `message.type` but the real issue was argument ordering

## Solution

The `_update_tool_call_on_ai_message` method signature is `(self, tool_call_id: str, messages_list: Any, ...)` — tool_call_id first, messages_list second. The RESUME_RECONCILE code introduced in the previous fix passed them in reverse order: `(messages_list, tool_call_id, ...)`.

When the method iterated `for message in messages_list:`, it was actually iterating over the characters of the string `tc_id`, and `'e'.type` raised the `AttributeError`.

## Implementation Details

Corrected the argument order in all four affected call sites in `execute_graphton.py`:

1. Top-level approval reconcile (line ~2877)
2. Sub-agent approval reconcile (line ~2887)
3. Top-level auto-skip sync (line ~2941)
4. Sub-agent auto-skip sync (line ~2949)

## Benefits

- HITL approval flow completes end-to-end without crashing
- Message-embedded tool call copies are properly synced after approval, ensuring correct UI rendering

## Impact

Unblocks local and production HITL approval flows that were broken by the previous commit's regression.

## Related Work

- `2026-03-26-193343-fix-hitl-resume-race-condition.md` — parent fix that introduced the regression

---

**Status**: ✅ Production Ready
