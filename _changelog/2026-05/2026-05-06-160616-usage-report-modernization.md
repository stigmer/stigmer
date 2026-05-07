# Usage Report Modernization and Cost Visibility

**Date**: May 6, 2026

## Summary

Modernized all usage report proto types from int32/double legacy patterns to int64/micro-USD, deleted the `UsageMetrics` type, added `org_id` and `session_id` denormalization to `LlmCallUsageRecord` for direct queries, introduced a new `getExecutionUsageReport` RPC, rewired the `UsageWidget` to call a real endpoint, and implemented the `getBillingUsageReport` handler. All clients (CLI, React SDK, Ink SDK, web console) updated to new types.

## Problem Statement

After the proxy-side billing metering work (T01-T08), usage data was correctly sourced from the `llm_call_usage_record` collection, but the server-side aggregation code silently truncated int64 values to int32 before returning them to clients. Cost was represented as `double estimated_cost_usd` (lossy, semantically wrong with markup) instead of `int64 billable_cost_micros` (precise, correct).

### Pain Points

- `UsageAggregationService` cast every token count with `(int)` -- silent truncation, overflow risk on org-level reports (2.1B tokens = ~$6,300)
- `UsageMetrics` mixed concerns: tokens, cost, durations, model info in one grab-bag type
- `ModelUsage` used `double estimated_cost_usd` and `double` price-per-million fields (float precision loss)
- `UsageWidget` in the web sidebar was permanently empty (stub returning zeros)
- CLI post-execution display showed no cost (`computeExecutionUsage` returned nil)
- `getBillingUsageReport` RPC was defined in proto but had no handler implementation
- `LlmCallUsageRecord` had no `org_id` or `session_id`, forcing expensive two-step joins for session/org queries

## Solution

Clean break: delete old types, create new ones with proper int64/micro-USD fields, update all consumers across both repos in one pass.

## Implementation Details

### Proto Redesign (stigmer OSS)

- **Deleted** `UsageMetrics` from `usage.proto`
- **Created** `UsageReportAggregate`: int64 token fields (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `reasoning_tokens`, `total_tokens`), int64 `billable_cost_micros` / `provider_cost_micros`, int32 `llm_call_count`, string `primary_model` / `primary_provider`
- **Redesigned** `ModelUsage` with int64 tokens and int64 cost fields (removed legacy `double` price-per-million fields)
- **Upgraded** all summary types (`ExecutionUsageSummary`, `SessionUsageSummary`, `AgentUsageSummary`, `DailyCostEntry`) to int64 tokens + int64 `billable_cost_micros`
- **Added** `org_id` (field 7) and `session_id` (field 8) to `LlmCallUsageRecord`
- **Added** `getExecutionUsageReport` RPC on `AgentExecutionQueryController` with `GetExecutionUsageReportInput`/`Output`
- Regenerated stubs in all 5 languages (Go, Java, Python, TypeScript, Dart)

### Server Updates (stigmer-cloud)

- **Mongock migration** (order 027): indexes `(org_id, observed_at desc)` and `(session_id, sequence)` on `llm_call_usage_record`
- **Write path**: `RecordLlmCallUsageHandler.ComputeAndInsertStep` now populates `org_id` (from reservation) and `session_id` (from execution doc) at insert time
- **New repo methods**: `LlmCallUsageRecordRepo.findBySessionId()`, `findByOrgIdAndDateRange()`
- **Rewritten** `UsageAggregationService`: eliminated all `(int)` casts, uses `customer_billable_amount_micros` as primary cost, new `aggregateRecords()` and `mergeModelBreakdownsFromRecords()` methods
- **New handler**: `AgentExecutionGetExecutionUsageReportHandler` -- per-execution usage query
- **New handler**: `GetBillingUsageReportHandler` -- org-scoped billing report with provider vs customer cost breakdown

### CLI Updates (stigmer OSS)

- `formatCost()` now accepts int64 micros, converts internally
- `formatTokenCount()` accepts int64
- `formatShare()` accepts int64
- All three `stigmer usage` commands (`session`, `agent`, `org`) updated to new field names
- `computeExecutionUsage()` return type changed to `*UsageReportAggregate` (still returns nil -- wiring to RPC requires SDK client plumbing)

### React/Ink SDK Updates (stigmer OSS)

- `useSessionUsage` rewired from hardcoded zeros to calling `getSessionUsageReport` RPC
- `OrgUsagePanel` updated to read from `billableCostMicros` fields with micro-USD to USD conversion
- `UsageWidget` now shows real session cost data in the web sidebar

## Benefits

- **Correctness**: No more int32 truncation on large org reports
- **Precision**: int64 micro-USD eliminates floating-point cost drift
- **Semantics**: `billable_cost_micros` shows what the customer pays (not raw provider cost)
- **Query performance**: Direct `session_id` and `org_id` queries on usage records (no two-step join through executions)
- **Visibility**: UsageWidget in web sidebar now shows real session cost; CLI usage commands show accurate data
- **Completeness**: `getBillingUsageReport` handler implemented (was proto-only)

## Impact

- **All usage report consumers updated**: CLI (Go), React SDK, Ink SDK, web console
- **68 files changed** in stigmer OSS, **51 files changed** in stigmer-cloud
- **Breaking change**: `UsageMetrics` type deleted, all consumers migrated
- **New RPC**: `getExecutionUsageReport` available for per-execution cost queries
- **Migration required**: Mongock migration adds two indexes on existing collection (non-destructive, background)

## Related Work

- Predecessor: [Billing Bounded Context Separation](2026-05-06-151701-billing-bounded-context-separation.md)
- Parent project: `20260503.03.stripe-billing-integration`
- Sub-project: `20260504.01.sp.proxy-side-billing-metering` (completed T01-T08)

---

**Status**: Production Ready
**Timeline**: Single session
