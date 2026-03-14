# Phase 5: Server Usage Report RPCs

**Date**: March 14, 2026

## Summary

Implemented three Usage Report RPCs (`GetSessionUsageReport`, `GetAgentUsageReport`, `GetOrgUsageReport`) in the stigmer OSS Go server. These RPCs aggregate cost, token consumption, and model usage data across executions at session, agent, and organization levels — enabling cost visibility and budget monitoring for the platform.

## Problem Statement

With usage metrics collection complete (Phases 1–4), there was no way to query aggregated cost/token data. Individual execution records contain per-execution usage, but users and administrators need rolled-up views to understand spending patterns, identify expensive agents, and track daily cost trends.

### Pain Points

- No session-level cost summary (total cost of a conversation across multiple executions)
- No agent-level usage view (how much does a specific agent cost over time?)
- No org-level dashboard data (total spend, top agents by cost, daily cost trend)
- Model breakdown scattered across individual executions with no merged view

## Solution

Three new RPCs on `AgentExecutionQueryController`, each following the established pipeline pattern with shared aggregation logic extracted into reusable helper functions.

## Implementation Details

### Shared Aggregation Library (`usage_aggregation.go`)

20+ pure functions covering the full aggregation surface:

- **Cost rollup**: `executionTotalCost` sums main agent + all sub-agent `estimated_cost_usd`
- **Token aggregation**: `aggregateUsageMetrics` sums all token fields (prompt, completion, cache) across executions including sub-agents
- **Model breakdown merge**: `mergeModelBreakdowns` deduplicates by `(model, provider)` key, sums token/cost fields, preserves pricing rates from first entry, sorted by cost descending
- **Date filtering**: ISO 8601 string comparison for `from_date`/`to_date` bounds
- **Grouping**: By session ID, agent ID, and date (YYYY-MM-DD extraction)
- **Summary builders**: Lightweight projection types for execution, session, and agent summaries
- **Daily cost entries**: Chronologically sorted daily aggregates for trend visualization
- **Top-N selection**: Top agents by cost with configurable limit (default 10)

### GetSessionUsageReport

3-step pipeline: Validate → LoadSessionExecutions → BuildReport

Returns: session-level totals, per-execution breakdown (chronological), merged model breakdown, summarization cost, first/last execution timestamps.

### GetAgentUsageReport

3-step pipeline: Validate → LoadAgentExecutions (with date range filter) → BuildReport

Returns: agent-level totals, per-session breakdown, total sessions/executions/cost, agent name resolved from store. Supports optional `from_date`/`to_date` for time-windowed reporting.

### GetOrgUsageReport

3-step pipeline: Validate → LoadOrgExecutions (org + required date range) → BuildReport

Returns: org-wide totals (agents, sessions, executions, cost), merged model breakdown, top 10 agents by cost, daily cost trend. Date range is required (validated).

### BUILD.bazel

Added 4 new source files and 1 test file to the controller build target.

### Unit Tests

15 tests covering all aggregation functions:
- Sub-agent cost inclusion, nil usage handling, empty input edge cases
- Model breakdown deduplication and cost-descending sort
- Date range filtering (both bounds, single bound, no bounds)
- Session/date grouping, daily cost entries, top-N selection
- Org filtering (case-insensitive), earliest/latest timestamp extraction

## Benefits

- **Cost visibility**: Users can see total cost per session, per agent, or across their organization
- **Budget monitoring**: Org-level daily cost trend enables capacity planning
- **Agent optimization**: Top-agents-by-cost identifies which agents consume the most resources
- **Model insights**: Merged model breakdown shows exactly which models drive cost

## Impact

- **Users**: Can query cost data through the API (CLI integration in Phase 6)
- **Administrators**: Org-level reporting enables cost governance and chargeback
- **Platform**: Foundation for billing, alerts, and cost optimization recommendations
- **Codebase**: Reusable aggregation library can be extended for future report dimensions

## Related Work

- Phase 1: Proto schema (`UsageMetrics`, `ModelUsage`, `LlmCallMetrics`, report I/O types)
- Phase 2: Usage metrics collection in agent-runner
- Phase 3: Tool truncation and cost cap middleware
- Phase 4: Prompt caching (reduces the costs these reports track)
- Phase 6 (next): CLI commands to consume these RPCs
- stigmer-cloud: Java production implementation completed in parallel

---

**Status**: ✅ Production Ready (Go/OSS)
**Timeline**: Single session
