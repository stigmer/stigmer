# Proxy-Side Usage Metering: Layered Data Model

**Date**: May 4, 2026

## Summary

Designed and implemented a research-driven, layered usage metering system for proxy-side LLM billing. Per-call usage records are stored as immutable, billing-authoritative events in a dedicated MongoDB collection, with a lightweight aggregate materialized on the execution document for fast reads. This replaces the original approach of embedding usage data inside the hot execution document.

## Problem Statement

Stigmer's LLM proxy routes all cloud-mode API calls and needs to capture token usage for billing. The existing `UsageMetrics` proto was designed for runner-reported data (untrusted) and mixed billing-relevant fields with observability-only data (duration, tool truncation). There was no clear trust boundary, no separate storage for per-call billing facts, and the planned embedded-in-execution approach would create race conditions with the concurrent `updateStatus` handler.

### Pain Points

- No field on `AgentExecutionStatus` for proxy-written usage (the `usage` comment in proto was aspirational, never implemented)
- `UsageMetrics` mixed billing data (tokens, cost) with observability (duration, truncation)
- `estimated_cost_usd` as a float is not audit-grade for billing
- Embedding per-call records in the execution document creates write conflicts with `updateStatus`
- No trust-level distinction between proxy-observed and runner-reported data

## Solution

Implemented a layered model based on deep research across 10 platforms (OpenAI, Anthropic, AWS Bedrock, Azure, Vertex AI, Cursor, Vercel, LiteLLM, Helicone, Portkey):

1. **Immutable per-call `LlmCallUsageRecord`** in dedicated collection — billing source of truth
2. **Derived `ExecutionUsageAggregate`** on execution status — for dashboards and UI
3. **Separate `ExecutionObservabilityMetrics`** — runner-reported timing, display-only

## Implementation Details

### Proto Layer (stigmer OSS)

Complete overhaul of `usage.proto` (509 lines):
- `LlmCallUsageRecord` — 80+ fields covering identity, trust/source, provider metadata, token usage, cost stamp, proxy timing, billing link
- `ExecutionUsageAggregate` — derived counts, token totals, cost totals, model breakdown
- `ExecutionObservabilityMetrics` — runner timing, context utilization
- Supporting: `TokenUsage`, `CostStamp`, `PricingSnapshot`, `ProxyTiming`, `BillingLink`
- 6 enums: `UsageMeteringSource`, `UsageTrustLevel`, `UsageCompletionStatus`, `BillingDebitStatus`, `CostCalculationStatus`, `UsageAggregateStatus`

### Java Layer (stigmer-cloud)

- `ModelPricingService` — loads model-registry.json at startup, computes `providerCostMicros` using `BillingMicros.tokenCost()`
- `LlmCallUsageRecordRepo` — insert-only with idempotency, billing status mutations only
- `AgentExecutionUpdateUsageHandler` — 3-step pipeline:
  1. Compute cost + insert immutable record (critical)
  2. Debit billing via `ExecutionBillingService` (non-critical)
  3. Update execution aggregate via atomic `$inc` (non-critical)
- `U20260504_LlmCallUsageRecordCollection` — Mongock migration with 5 indexes
- `can_update_usage` FGA permission — operator-only access

## Benefits

- **Tamper-proof billing**: Only proxy-observed, provider-reported usage creates billing debits
- **No race conditions**: Per-call records in separate collection, no conflict with `updateStatus`
- **Audit-grade**: Integer micros, pricing snapshot stamped at write time, billing link to ledger
- **Handles edge cases**: `STREAM_INTERRUPTED` = not billable, explicit conflict detection
- **OSS-compatible**: Same schema with `RUNNER_PROVIDER_REPORTED_OSS` source marker
- **Future-proof**: Token fields for reasoning, audio, tool-use, provider-specific details

## Impact

- Billing system now has a dedicated metering layer between proxy observation and credit debit
- Execution UI will show trusted aggregate usage from `status.usage_summary`
- Runner-reported timing/context goes to `status.observability` (never billing)
- Old `UsageMetrics`/`ModelUsage`/`LlmCallMetrics` deprecated but kept for wire compat

## Related Work

- Parent project: `20260503.03.stripe-billing-integration` (Phase 2 billing lifecycle)
- Sub-project: `20260504.01.sp.proxy-side-billing-metering` (T01 SSE parsers, T02 this work)
- Research: `research.llm-usage-capture-model/04.report.gpt.md`

---

**Status**: In Progress (T02 complete, T03-T08 pending)
**Timeline**: Part of 2-month billing integration project
