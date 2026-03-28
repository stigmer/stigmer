# Fix HITL Reconciler Tool Call Index Ordering

**Date**: March 28, 2026

## Summary

Fixed tool call duplication after HITL approval caused by a method call ordering bug in `ResumeReconciler.reconcile()`. The `_tool_call_index` was empty when the reconciler tried to look up persisted tool calls, causing the entire dedup chain to fail and a duplicate tool call to appear in the UI.

## Problem Statement

After approving a tool call (e.g., `apply_mcp_server`), the UI showed two separate entries: one with the approved status and arguments, and a second with the result. These should have been a single unified entry.

### Pain Points

- **Duplicate tool call in UI**: After approval, `apply_mcp_server` appeared twice — once as `WAITING_APPROVAL` and once as `COMPLETED` with a new ID
- **All three dedup mechanisms defeated**: Fingerprint dedup, reconciled fallback queue, and index lookup all failed due to a single ordering bug
- **Previous fix was incomplete**: The `_reconciled_resume_tool_calls` fallback added in the prior session was correct in design but never executed because its prerequisite (the reconciler finding the tool call) was broken

## Solution

Moved `populate_fingerprints_from_existing_tool_calls()` from the end of `reconcile()` to the beginning, before the approval-decision loop. This ensures `_tool_call_index` is populated before `get_tool_call()` is called.

## Implementation Details

### Root Cause

The log line `[RESUME_RECONCILE] tool_call_id=toolu_01QqqBMC9bmSN9UYB4GXxUt3 not found in index — skipping` revealed the exact failure point. In `reconcile()`:

1. `get_tool_call()` was called at line 68 — but `_tool_call_index` was empty
2. `populate_fingerprints_from_existing_tool_calls()` was called at line 127 — after the loop

This caused a triple failure cascade:
1. Reconciler skipped the tool call (never transitioned it to `RUNNING`)
2. Reconciled fallback queue stayed empty (tool call never registered in `_reconciled_resume_tool_calls`)
3. Fingerprint dedup failed independently (humanized vs raw args produce different SHA-256 hashes)

### Files Changed (stigmer)

| File | Change |
|------|--------|
| `worker/activities/graphton/hitl.py` | Move `populate_fingerprints_from_existing_tool_calls()` to top of `reconcile()`, remove redundant call at end |

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
