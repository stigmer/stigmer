# Fix Cursor Billing Pipeline — Phase 1: Restore Cloud-Side Billing

**Date**: May 31, 2026

## Summary

Restored cloud-side billing for Cursor harness executions by re-implementing the `recordCursorUsage` Temporal activity with correct provider resolution. The runner-side billing emission (which failed with `permission_denied`) has been removed. Billing is now authoritative from the Java workflow using operator credentials.

## Problem Statement

Cursor billing had been completely broken since May 28, resulting in zero billing records for all Cursor executions.

### Pain Points

- `recordCursorUsage` was removed from the Java service in commit `81d81ed4` under the assumption that proxy metering would handle billing — but the proxy cannot handle BiDi streaming (Tomcat limitation)
- The runner-side fallback (`recordLlmCallUsage`) fails with `permission_denied` because the runner authenticates with the user's token (lacks `can_execute_billing_ops`)
- All 44 existing Cursor records in MongoDB had `PRICE_NOT_FOUND` because provider was hardcoded as `"cursor"` instead of resolving to `"anthropic"`/`"openai"`
- The `CURSOR_BACKEND_URL` env var change was an exploratory fix that doesn't work for BiDi streaming

## Solution

Two-pronged fix:
1. **Cloud-side (stigmer-cloud)**: Restore the billing activity with correct provider resolution
2. **Runner-side (stigmer)**: Remove the broken billing code path and revert the exploratory proxy routing change

## Implementation Details

### stigmer-cloud

- **`CursorModelResolver.java`** (new): Shared utility extracting `inferProviderFromModel()` from `CursorProxyController`. Maps `claude-*` → `anthropic`, `gpt-*/o1-*/o3-*/o4-*` → `openai`.
- **`BillingActivities.java`**: Added `recordCursorUsage(String executionId)` back to the interface.
- **`BillingActivitiesImpl.java`**: Restored implementation that reads `streaming_usage`, resolves provider from model name (the key fix), and calls `RecordLlmCallUsageHandler`.
- **`InvokeAgentExecutionWorkflowImpl.java`**: Re-wired `billingActivities.recordCursorUsage(executionId)` at `EXECUTION_COMPLETED` in `executeCursorFlow`. Added `usage_summary` to `buildCallbackResultJson()` for workflow task cost tracking.
- **`CursorProxyController.java`**: Delegated `inferProviderFromModel` to the shared `CursorModelResolver`.

### stigmer (OSS)

- **`execute-cursor/index.ts`**: Removed broken Phase 13b runner-side billing emission (called `recordLlmCallUsage` which failed with `permission_denied`). Cleaned up unused imports.
- **`main.ts`**: Reverted `CURSOR_BACKEND_URL` addition (doesn't help without Phase 2's Netty BiDi proxy).
- **`usage-accumulator.ts`**: Updated header comment — `streaming_usage` now feeds cloud-side billing, no longer "DISPLAY_ONLY".

## Benefits

- Cursor executions are billed correctly again with proper pricing lookup
- Provider resolution (`claude-sonnet-4` → `anthropic`) ensures the model registry returns correct prices
- Workflow tasks show non-zero `costMicros` via `usage_summary` in the callback result
- Cleaner separation: runner reports usage data, cloud records billing with operator credentials

## Impact

- **All Cursor executions** will now generate billing records with correct cost calculations
- **Workflow events** will emit per-task costs for Cursor agent calls
- **Credit ledger** debits will resume for Cursor usage

## Related Work

- Phase 2 (Netty BiDi proxy for proxy-authoritative billing) is planned for a follow-up session
- Builds on: `35a07aff` (Connect RPC metering pipeline), `b548e2ef` (BILLING_AUTHORITY labels)
- Fixes regression from: `81d81ed4` (premature removal of `recordCursorUsage`)

---

**Status**: ✅ Production Ready
**Timeline**: Phase 1 of 2 — Phase 2 (Netty BiDi proxy) pending
