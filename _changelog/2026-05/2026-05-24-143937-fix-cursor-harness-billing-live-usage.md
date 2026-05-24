# Fix Cursor Harness Billing Records + Live Usage Visibility

**Date**: May 24, 2026

## Summary

Fixed a production issue where Cursor harness agent executions showed $0.00 cost and zero tokens in the UsageWidget despite consuming 179K+ tokens of context. Root cause: two compounding failures — the runner lacked platform-operator auth for billing RPCs, and the frontend's merge logic permanently blocked live streaming data.

## Problem Statement

When using the Cursor harness, the session page showed a disconnect:
- **ContextGauge** (working): Showed "179K / 200K tokens, 88%" correctly
- **UsageWidget** (broken): Showed only "$0.0008 / 585 tokens" from the subject-generation side-call

Production MongoDB confirmed: **zero** cursor harness billing records (all 128 records were `harness=native`). The Cursor agent's actual token consumption was invisible in cost tracking.

### Pain Points

- Users couldn't see what their Cursor agent executions actually cost
- Org usage dashboards showed zero for cursor-harness sessions
- The `streaming_usage` field carried correct data live but was being ignored by the frontend
- Subject-generation calls (tiny haiku calls for session titles) were the only visible billing records

## Solution

Two-layer fix addressing both the backend privilege gap and the frontend merge logic:

1. **Server-side billing record creation** — After cursor execution completes, the Java Temporal workflow (which runs with operator privileges) reads `streaming_usage` from the execution status and creates billing records via the same in-process path the native proxy uses.

2. **Frontend merge logic** — Replaced the either/or preference (`billing report` vs `streaming fallback`) with a merge strategy that shows billing when authoritative and supplements with live streaming data for in-flight executions.

## Implementation Details

### Root Cause Analysis (Test-Driven)

Ran `TestAgentExecution_Usage_*/cursor` with a real Cursor API key. Results:
- `streaming_usage`: PASS (tokens + cost populated correctly)
- `GetExecutionUsageReport`: FAIL (`billable_cost_micros=0`, `provider_cost_micros=13778`)

Service logs revealed: `BillingPolicyNotFoundException: No active billing policy for harness=cursor, costTier=standard`

Further investigation of production MongoDB showed zero cursor records because the runner's `recordLlmCallUsage` gRPC call fails with `PERMISSION_DENIED` — it uses the initiating user's token which lacks `can_execute_billing_ops`.

The native proxy avoids this by using `inProcessChannelAsSystem` (machine-account auth, no gRPC interceptor).

### Backend — Server-Side Billing (stigmer-cloud, 3 files)

- `BillingActivities.java`: Added `recordCursorUsage(String executionId)` interface method
- `BillingActivitiesImpl.java`: Implementation reads `execution.status.streaming_usage`, builds `RecordLlmCallUsageInput`, calls `billingUsageGrpcRepo.recordUsage()` via in-process channel
- `InvokeAgentExecutionWorkflowImpl.java`: Calls `billingActivities.recordCursorUsage(executionId)` after cursor activity returns COMPLETED

Idempotent by design: shares the same `idempotency_key` as the runner's `emitBillingRecords`, so whichever succeeds first wins.

### Frontend — Merge Logic (stigmer OSS, 1 file)

- `useSessionUsage.ts`: Replaced `if (report.hasUsage) return report` with three-way merge:
  - Billing report has data (`llmCallCount > 0`) → merge with streaming for in-flight additions
  - No billing data → use streaming directly (live cost visibility)
  - Fixed `hasUsage` from "proto exists" to "llmCallCount > 0 || totalTokens > 0 || cost > 0"

### Test Infrastructure (stigmer OSS, 4 files)

- `mongo_seeder.go`: `SeedBillingPolicies()` + `EnsureBillingIndexes()` (Mongock is disabled in tests)
- `fixture.go`: `SeedBillingPolicies()` helper
- `suite_test.go`: Added policy seed to suite setup
- `agent_execution_cursor_usage_diagnostic_test.go`: Full-pipeline diagnostic test validating all 4 data sources

## Benefits

- Users see live token/cost accrual during Cursor execution (from `streaming_usage`)
- After execution: authoritative billing records appear in org dashboards and session reports
- Context window and usage data now tell a consistent story
- Native and Cursor harnesses both have billing records in production

## Impact

- **Session page users**: See real token consumption and estimated cost during and after Cursor executions
- **Org billing dashboards**: Cursor harness usage now appears in cost reports
- **Integration tests**: All cursor usage tests pass with correct `billable_cost_micros`
- **Both editions**: Frontend fix applies to OSS and Cloud; backend fix is Cloud-only (OSS uses different billing)

## Related Work

- Agent Call Live Experience (earlier today) — real-time agent visibility in workflow cockpit
- Cost Benchmark infrastructure — verified cursor vs native token parity
- Flat Markup Billing Policies (May 17) — the `cursor-v2` policy that this fix depends on

---

**Status**: Production Ready
**Timeline**: Single session — diagnosis through test-driven fix
