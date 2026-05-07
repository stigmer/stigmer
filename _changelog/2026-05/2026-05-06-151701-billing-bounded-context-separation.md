# Billing Bounded Context Separation + Runner Usage Cleanup

**Date**: May 6, 2026

## Summary

Restructured the billing metering pipeline to enforce clean bounded context separation. The proxy now calls billing directly via `recordLlmCallUsage` RPC — no agentic middleman. Removed all runner-side usage tracking code (UsageTracker, llm_metrics), the execution-level usage_summary denormalization, and the observability metrics placeholder. Billing owns all cost computation, usage recording, and credit debit. Usage reports query the `llm_call_usage_record` collection directly.

## Problem Statement

The proxy-side billing metering (T01-T07) was architecturally sound but had bounded context leaks:
- The agentic `updateUsage` handler imported three billing domain services (`ModelPricingService`, `LlmCallUsageRecordRepo`, `ExecutionBillingService`)
- The runner-side `UsageTracker` was dead code in cloud mode (proxy handles everything) but kept alive for OSS compatibility
- The `usage_summary` denormalization on the execution document duplicated data already in the `llm_call_usage_record` collection
- The `ExecutionObservabilityMetrics` type was defined but never implemented by any code

### Pain Points

- Agentic domain acting as billing orchestrator violated aggregate boundaries
- Runner-computed cost (`estimated_cost_usd`) was untrusted in cloud mode but maintained for OSS
- `usage_summary` $inc updates added write amplification on every LLM call
- Proto types existed with zero consumers (`ExecutionObservabilityMetrics`, `ExecutionUsageAggregate`)

## Solution

Three coordinated changes across stigmer (OSS) and stigmer-cloud:

### 1. Billing Bounded Context Separation
Created `recordLlmCallUsage` RPC on `BillingCommandController` that encapsulates all billing work (cost computation, record persistence, credit debit). The proxy calls it directly via in-process gRPC using the established `downstream/` pattern.

### 2. OSS Usage Path Removal  
Removed `UsageTracker` from both Python and TypeScript runners, `llm_metrics` from `AgentMessage`, and the `LlmCallMetrics` type. OSS mode no longer tracks or displays usage — users can see it directly on the provider.

### 3. Dead Proto Cleanup
Removed `ExecutionUsageAggregate`, `ModelUsageBreakdown`, `UsageAggregateStatus`, `ExecutionObservabilityMetrics`, `usage_summary` field, `updateUsage` RPC, and `can_update_usage` permission.

## Implementation Details

### Proto Changes (stigmer OSS)
- **New**: `recordLlmCallUsage` RPC + `RecordLlmCallUsageInput`/`Response` on `BillingCommandController`
- **Removed**: `reportLlmCallUsage` RPC + messages from billing proto
- **Removed**: `updateUsage` RPC + `UpdateUsageInput`/`Response` from agentic proto
- **Removed**: `llm_metrics` field from `AgentMessage`, `LlmCallMetrics` type
- **Removed**: `usage_summary` field from `AgentExecutionStatus`
- **Removed**: `ExecutionUsageAggregate`, `ModelUsageBreakdown`, `UsageAggregateStatus`, `ExecutionObservabilityMetrics` types
- **Removed**: `can_update_usage` IAM permission
- **Re-labeled**: `UsageMetrics` and `ModelUsage` comments (not deprecated — they're response types)

### Java Changes (stigmer-cloud)
- **New**: `RecordLlmCallUsageHandler` in billing domain
- **New**: `downstream/billing/BillingUsageGrpcRepo` + `Impl`
- **Deleted**: `AgentExecutionUpdateUsageHandler` + test
- **Deleted**: `ReportLlmCallUsageHandler`
- **Deleted**: `downstream/agentic/agentexecution/UsageReportingGrpcRepo*`
- **Refactored**: `ProxyUsageReporter` to call billing directly
- **Simplified**: `UsageAggregationService` — reads only from `LlmCallUsageRecord`
- **Config**: `require-scope-header` flipped to `true`

### Runner Changes (stigmer OSS)
- **Deleted**: `UsageTracker` (Python) + tests
- **Deleted**: `usage-tracker.ts` (cursor-runner) + tests
- **Removed**: `llm_metrics` stamping from `chat_model.py` and `execute-cursor.ts`
- **Deleted**: `billing_client.py` (orphaned gRPC wrapper)

### Frontend Changes
- **Simplified**: `useSessionUsage` returns empty (to be rewired to query endpoint)
- **Updated**: `UsageWidget` and CLI `computeExecutionUsage` — no usage data on execution doc

## Benefits

- Clean bounded context separation — billing owns all cost/usage/debit
- Proxy → Billing is a single gRPC call (microservice-ready when extracted)
- Zero runner code involved in billing or usage tracking
- 18,000+ lines of dead/duplicate code removed
- Proto surface area reduced — no speculative types without consumers

## Impact

- **Cloud mode**: Billing pipeline unchanged functionally; cleaner architecture
- **OSS mode**: Usage reports return zeroes (no proxy → no usage data). This is by design.
- **Real-time UsageWidget**: Shows empty until rewired to query a usage endpoint (follow-up)
- **CLI usage display**: Returns nil until wired to usage report RPC (follow-up)

## Related Work

- Parent: 20260503.03.stripe-billing-integration (Phases 1-4)
- Sub-project: 20260504.01.sp.proxy-side-billing-metering (T01-T07 + T08)

---

**Status**: Production Ready
**Timeline**: Single session (T08 cleanup + bounded context separation)
