# Fix Cursor Billing: Runner-Side Usage Emission and Credit Enforcement

**Date**: May 30, 2026

## Summary

Cursor agent executions were completing without creating billing records, leaving the usage section empty for all Cursor-proxied runs. The root cause was that the `@cursor/sdk` uses `connect-node` (Node.js native HTTP) for its main agent stream, bypassing `globalThis.fetch` and the proxy's metering pipeline entirely. Fixed by adding runner-side billing emission and correcting a test org mismatch that masked the credit enforcement guard.

## Problem Statement

After the proxy-authoritative billing architecture was implemented (sessions 2–4), Cursor executions showed zero cost in the UI. The streaming usage widget displayed tokens (from SDK callbacks), but the billing records, credit ledger, and usage reports were all empty.

### Pain Points

- Cursor executions showed $0.00 cost despite consuming LLM tokens
- Credit balance never decreased after Cursor runs (no usage_debit entries)
- Session and execution usage reports returned all zeros for Cursor harness
- The `NoCreditsBlocked` integration test was passing for the wrong reason (wrong org)

## Solution

Two fixes applied:

1. **Runner-side billing emission**: After a Cursor execution completes, the runner calls `recordLlmCallUsage` for each turn using token data already collected by the `UsageAccumulator` from the SDK's `onDelta` → `turn-ended` callbacks. This bypasses the proxy entirely — the runner reports directly to the billing service.

2. **Credit enforcement test fix**: The `NoCreditsBlocked` test was creating a billing account for `test-org-no-credits` but running executions under `test-org` (which had $100). Added `WithAgentOrg`, `WithSessionOrg`, `WithExecutionOrg` harness options and wired the test to use the correct org.

## Implementation Details

### Runner-side billing (execute-cursor/index.ts)

After Phase 13 (result mapping) and before Phase 14 (session memory), the runner now emits billing records:

- Iterates `usageAccumulator.turns()` (per-turn token records)
- Calls `client.recordLlmCallUsage()` with `TokenUsage` proto for each turn
- Sets `provider: "cursor"`, `harness: "cursor"`, `usageStatus: COMPLETE`
- Non-blocking: errors logged as warnings, never fail the execution
- Deduplicated server-side by `(execution_id, sequence, metering_source)`

### Harness org override options

Added `WithAgentOrg(org)`, `WithSessionOrg(org)`, `WithExecutionOrg(org)` to the integration test harness. These override the default `TestOrg` on resource metadata, enabling tests that exercise billing for different orgs.

### Compilation fixes (pre-existing)

- `MessageType_MESSAGE_ASSISTANT` → `MESSAGE_AI` (proto enum rename from earlier session)
- Removed duplicate `truncate` function across two test files
- Aligned `mustStruct` signature conflict (one file used `(t, map)`, another used `(map)`)

## Benefits

- All 9 billing/cost integration tests now pass (previously 7 failures)
- Cursor executions correctly record per-turn token usage and costs
- Credit balance decreases after Cursor runs (usage_debit entries created)
- Zero-credit orgs are correctly blocked from starting executions
- Harness org override enables future billing tests for multi-org scenarios

## Impact

- **Frontend**: Usage section in the execution inspector now shows real cost data for Cursor executions
- **Billing**: Credit ledger correctly reflects Cursor LLM consumption
- **Testing**: All billing integration tests green; new harness options for org-scoped testing

## Related Work

- Cursor billing reconciliation project (sessions 1–5)
- Connect RPC metering pipeline (ConnectCursorUsageExtractor — still useful for auxiliary calls)
- Proxy-authoritative billing architecture design

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (investigation + fix + verification)
