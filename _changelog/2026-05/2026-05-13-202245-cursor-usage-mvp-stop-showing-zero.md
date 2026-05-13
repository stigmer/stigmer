# Cursor Usage MVP: Stop Showing $0.00

**Date**: May 13, 2026

## Summary

Fixed three root causes behind Cursor harness sessions showing $0.00 in the usage dashboard. Cursor sessions now capture real token usage (~10K input tokens per turn) and compute estimated cost (~$0.013 per simple query) instead of displaying zero. All 47 existing usage records in production were backfilled with correct billable amounts.

## Problem Statement

Every Cursor harness session on the Stigmer platform displayed $0.00 in the usage dashboard, despite real LLM usage happening. This is a user trust issue — early adopters see agents doing work but the platform reports zero cost.

### Pain Points

- UsageWidget in session sidebar showed nothing for Cursor sessions
- OrgUsagePanel reported $0.00 total cost across all usage
- HarnessSplitCard never showed a "Cursor" segment (all records labeled "native")
- Users could not understand the cost of their Cursor agent workloads

## Solution

Traced the full pipeline with empirical evidence (real Cursor SDK calls, MongoDB queries) and found three distinct root causes, each requiring a different fix:

1. **Cursor SDK streams bypass fetch**: The SDK uses an internal transport (not `globalThis.fetch`) for main agent turns. Our server-side proxy never sees this traffic. Fixed by capturing usage from the SDK's `onDelta` callback in the cursor-runner, accumulated per-turn and streamed to execution status.

2. **Harness mislabeled**: Usage records derived their harness from the model pricing registry instead of the proxy controller that handled the request. Added a `harness` field to `RecordLlmCallUsageInput` so each proxy controller identifies itself.

3. **Billable amount not persisted**: `customer_billable_amount_micros` was computed during billing debit but never written back to MongoDB. All usage report queries aggregate this field, so all reports showed $0.00 even when records existed with real provider costs.

## Implementation Details

### Proto Changes
- `RunnerUsageSummary` message added to `usage.proto` (9 fields: token buckets, turn count, estimated cost, model, timestamp)
- `runner_usage` field 20 added to `AgentExecutionStatus` in `api.proto`
- `harness` field 14 added to `RecordLlmCallUsageInput` in `billing/v1/io.proto`
- Full codegen: Go, Java, Python, TypeScript, Dart stubs regenerated in both repos

### Runner-Side Usage Capture (TypeScript)
- New `UsageAccumulator` class: accumulates `turn-ended` usage events, computes provisional cost via existing `model-pricing.ts` rate card
- Filled the previously empty `onDelta` handler in `execute-cursor.ts`
- Usage snapshot written to `status.runnerUsage` on every heartbeat and at stream end

### Harness Labeling Fix (Java)
- `CursorProxyController` passes `"cursor"` to `ProxyUsageReporter`
- `LlmProxyController` and `LlmCallService` pass `"native"`
- `RecordLlmCallUsageHandler` prefers caller-provided harness, falls back to pricing registry

### Billable Persistence Fix (Java + MongoDB)
- Added `updateCostBillableAmount()` to `LlmCallUsageRecordRepo`
- `DebitBillingStep` writes computed billable amount back to document after successful debit
- Backfilled all 47 existing production records (set `customer_billable_amount_micros` = `provider_cost_micros`)

### UI Fallback (React)
- `useSessionUsage` hook now falls back to `runner_usage` from execution status when the server-side session usage report returns empty

## Benefits

- Cursor sessions show estimated cost immediately during streaming (instead of $0.00)
- Org usage dashboard displays real cost data for all 47 existing records
- HarnessSplitCard can now distinguish "Native" vs "Cursor" cost distribution
- Trust model explicitly documented: runner usage = DISPLAY_ONLY, proxy usage = BILLING_AUTHORITY

## Impact

- **Users**: See estimated cost for Cursor sessions instead of $0.00
- **Billing**: 47 existing records now show correct billable amounts in reports
- **Architecture**: Established `RunnerUsageSummary` as the pattern for client-reported usage with explicit trust labeling
- **Future work**: Foundation for Admin API reconciliation (Phase 1 from research report) and eventual Cursor-signed receipts

## Related Work

- Deep Research report: `research.runner-usage-tamper-resistance/04.report.gpt.md`
- Previous sessions: Server-reported deployment mode (`e090a92b7`), web-desktop feature parity (`2ba7abaf9`)
- T01 plan: `_projects/2026-05/20260513.01.cursor-experience-parity/tasks/T01_0_plan.md`

---

**Status**: Implemented, pending commit and deployment verification
**Timeline**: 1 session (~4 hours of investigation + implementation)
