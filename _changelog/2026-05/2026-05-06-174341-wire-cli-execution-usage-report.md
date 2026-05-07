# Wire CLI Execution Usage Report

**Date**: May 6, 2026

## Summary

Wire the CLI's post-execution summary panel to display model, token, and cost data by calling the `getExecutionUsageReport` RPC. Fix the broken OSS Go server build caused by deleted `UsageMetrics`/`LlmCallMetrics` proto types, and add a `GetExecutionUsageReport` handler to the OSS server.

## Problem Statement

The billing bounded context separation (commit `97dbdfe60`) removed `UsageMetrics`, `LlmCallMetrics`, and `llm_metrics` from proto definitions. The usage report modernization (commit `85f337f7c`) replaced them with `UsageReportAggregate` (int64/micro-USD). However, the OSS Go server was not updated, producing 11 compilation errors. The CLI's `computeExecutionUsage()` function was a stub returning `nil`, so execution summary panels never showed model, tokens, or cost.

### Pain Points

- OSS `stigmer-server` could not compile (11 errors referencing deleted `UsageMetrics` and `LlmCallMetrics` types)
- CLI never displayed model, token count, or cost in the execution summary panel
- No `GetExecutionUsageReport` handler in the OSS server (only session, agent, and org report handlers existed)

## Solution

Three-part fix, all in the `stigmer` OSS repo:

1. **Fix OSS server build** -- Rewrote `usage_aggregation.go` to return zero-valued `UsageReportAggregate` results (OSS has no usage data source since runners no longer stamp `llm_metrics`). Fixed deleted field names in three report handlers.
2. **Add `GetExecutionUsageReport` handler** -- New pipeline-based handler following the existing session/agent/org report pattern. Returns a structurally valid response with zero tokens and zero cost in OSS; the cloud edition returns real data from its billing domain.
3. **Wire CLI** -- Replaced the `computeExecutionUsage` stub with `fetchExecutionUsage`, which calls the `GetExecutionUsageReport` RPC via the Go SDK client. Updated `streamAgentEpilogue` to fetch usage and pass it to display functions. Graceful degradation: returns `nil` on any error, so the summary panel still works without usage data.

## Implementation Details

### OSS Server (`backend/services/stigmer-server/`)

- `usage_aggregation.go` -- Removed all functions referencing `UsageMetrics`, `LlmCallMetrics`, `msg.GetLlmMetrics()`. Replaced with zero-returning `aggregateUsageReport()`, `mergeModelBreakdowns()`, and updated `buildExecutionSummary()`, `buildSessionSummary()`, `buildAgentSummary()`, `buildDailyCostEntries()` to use new proto field names.
- `get_session_usage_report.go` -- Removed `TotalSummarizationCostUsd` (field deleted from proto).
- `get_agent_usage_report.go` -- Removed `TotalCostUsd` (replaced by `TotalBillableCostMicros`).
- `get_org_usage_report.go` -- Same treatment.
- `get_execution_usage_report.go` (new) -- Pipeline: validate -> load execution from store -> return zero aggregate.
- `usage_aggregation_test.go` -- Removed `makeAIMessage` helper and usage-data-dependent assertions. Preserved all structural tests (filtering, grouping, sorting, date extraction).

### CLI (`client-apps/cli/cmd/stigmer/root/`)

- `usage_format.go` -- Replaced `computeExecutionUsage` with `fetchExecutionUsage(ctx, client, executionID)` that calls `GetExecutionUsageReport` RPC.
- `run_stream.go` -- `streamAgentEpilogue` now fetches usage after loading the final execution and passes it to display functions.
- `run_display_summary.go` -- `displayAgentExecutionComplete` and `displaySessionExitLine` accept a `*UsageReportAggregate` parameter instead of computing it internally.
- `resume_session.go` -- Updated model-name extraction to use `fetchExecutionUsage`.

## Benefits

- OSS `stigmer-server` compiles again (was broken by proto type deletions)
- CLI execution summary panels now display model, tokens, and cost when connected to the cloud backend
- Consistent `GetExecutionUsageReport` contract across both editions (OSS returns zeroes, cloud returns real data)
- Graceful degradation: if the RPC fails, the summary panel still shows duration, messages, and tool calls

## Impact

- **CLI users (cloud)**: Will see model, token count, and cost in execution summary panels
- **CLI users (OSS)**: No visible change (usage lines not shown when all values are zero)
- **OSS developers**: Server builds and tests pass again

## Related Work

- Billing bounded context separation (`97dbdfe60`) -- removed `UsageMetrics`/`LlmCallMetrics` from protos
- Usage report modernization (`85f337f7c`) -- introduced `UsageReportAggregate` with int64/micro-USD fields
- Phase 5 dashboard enrichment -- `UsageAggregationService` in cloud reads from `LlmCallUsageRecord`

---

**Status**: Production Ready
**Timeline**: Single session
