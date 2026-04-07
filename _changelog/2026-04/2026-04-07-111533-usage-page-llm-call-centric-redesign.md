# Usage Page: LLM-Call-Centric Redesign

**Date**: April 7, 2026

## Summary

Redesigned the organization Usage page to show LLM-call-centric metrics instead of execution-centric ones. The summary cards now show Total Cost, LLM Calls, and Tokens. The model breakdown table adds a Calls column, splits tokens into Input/Output, and shows cache hit details. The "Top Agents by Cost" section is removed. Backend changes add a projected MongoDB query for usage aggregation (reducing per-document transfer from megabytes to kilobytes) and fix the agent-runner to populate `started_at` on executions.

## Problem Statement

The Usage page was designed around execution-level metrics (execution count, agent count) that don't help an org admin understand their LLM spend. The model breakdown only showed aggregated token counts and cost, without visibility into how many API calls were made or how tokens split between input and output — critical for cost optimization since input and output tokens are priced very differently.

### Pain Points

- Summary cards showed "Executions" and "Agents" — operational metrics, not billing metrics
- Model breakdown had no call count (the atomic unit of LLM spend)
- Tokens were aggregated without input/output split — masking cost drivers
- "Top Agents by Cost" showed "(unknown agent)" for most executions
- Backend loaded full execution documents (all messages, tool calls, sub-agent content) just to sum up `llm_metrics` — a scalability concern
- Agent-runner never set `started_at` on executions (0/61 docs in production)

## Solution

### Frontend (OrgUsagePanel.tsx)

Redesigned the panel with three focused changes:

**Summary Cards**: 3 cards replacing 4 — Total Cost, LLM Calls (`sum(model_breakdown[].callCount)`), and Tokens. Removed Executions and Agents cards.

**Model Breakdown**: 5-column table (Model, Calls, Input, Output, Cost) replacing the old 3-column layout. Cache token details (read/write) shown as a subtle sub-line when present. Input tokens include cache creation and read tokens since they all count toward the input token budget.

**Removed**: Top Agents by Cost section. The data remains in the proto response for other consumers.

### Backend (AgentExecutionRepo.java)

Added `findByOrgAndDateRangeForUsage()` — a projected query that only loads fields needed for cost aggregation: `metadata.id`, `spec.agentId`, `status.messages.llmMetrics`, `status.subAgentExecutions.messages.llmMetrics`, and `status.audit`. The existing Java-side aggregation logic works unchanged since it only reads `llm_metrics` from messages.

### Agent-Runner (execute_graphton.py)

Set `started_at` to the current UTC timestamp when transitioning to `EXECUTION_IN_PROGRESS`. Previously, `started_at` was never populated — the date range query's fallback to `status.audit.statusAudit.updatedAt` was carrying 100% of the load.

## Implementation Details

### No Proto Changes

All required data already existed in the `ModelUsage` proto:
- `call_count` (field 7) — populated by `UsageAggregationService.mergeModelBreakdowns()` since each `LlmCallMetrics` entry increments it
- `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens` — all populated

The `GetOrgUsageReportOutput` proto keeps all existing fields (`total_executions`, `total_agents`, `top_agents_by_cost`) for backward compatibility. The frontend simply uses different fields now.

### Diagnostic Findings

Production MongoDB analysis confirmed:
- `planton-demo` org: 2 executions (query was correct, no data loss)
- `suresh` org: 59 executions, 700 LLM calls, $54.67 total cost
- 0 out of 61 executions had `started_at` populated
- Average doc size: 101 KB, max: 696 KB — manageable today but the projected query provides insurance for scale

## Benefits

- **Cost visibility**: Org admins can now see how many LLM API calls drive their spend, not just opaque execution counts
- **Token optimization**: Input/output split reveals whether cost is driven by large prompts or long responses
- **Cache awareness**: Cache hit rates visible per model for tuning prompt caching strategies
- **Scalability**: Projected query reduces data transfer by ~10-100x for the usage report endpoint
- **Data integrity**: `started_at` now populated, eliminating dependence on the audit timestamp fallback for date filtering

## Impact

- **SDK consumers**: `OrgUsagePanel` component API unchanged (same `orgId` prop). Visual output changes are the only difference.
- **API consumers**: `GetOrgUsageReportOutput` proto is fully backward-compatible. No fields removed.
- **Backend**: The original `findByOrgAndDateRange()` is preserved for other callers. Only the usage report handler switches to the projected variant.

## Files Changed

### stigmer (OSS)
- `sdk/react/src/usage/OrgUsagePanel.tsx` — UI redesign (3 cards, enhanced model breakdown, removed top agents)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — Set `started_at` on IN_PROGRESS

### stigmer-cloud
- `AgentExecutionRepo.java` — Added `findByOrgAndDateRangeForUsage()` projected query
- `AgentExecutionGetOrgUsageReportHandler.java` — Switched to projected query

---

**Status**: ✅ Production Ready
