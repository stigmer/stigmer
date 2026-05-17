# Cost Data Pipeline: Real Cost and Token Tracking for Workflow Executions

**Date**: May 14, 2026

## Summary

Wired real cost and token usage data from the Go workflow-runner through both backend control planes (Go OSS and Java Cloud) into the SDK dashboard components. The workflow dashboard now displays actual execution costs, input/output token counts, and per-workflow cost breakdowns instead of empty placeholder values. This completes the cost observability loop that was identified as a gap after the Phase 1/2 dashboard deliverables.

## Problem Statement

The cost data pipeline had all the infrastructure pieces built across multiple prior sessions (T05 Budget Primitives, T13 Backend Task Types, T14 Dashboard Integration), but three critical links were missing, creating a gap where cost data produced by the workflow-runner never reached the dashboard UI.

### Pain Points

- `WorkflowExecutionStatus` had no cost fields — cost data accumulated in the budget tracker but never reached the persisted status snapshot
- The OSS Go `UpdateExecutionStatus` activity ignored the events field entirely, so cost events never persisted
- Both `getExecutionSummary` handlers returned empty `WorkflowCostSummary{}` — the dashboard showed "$0.00" for all executions
- `CostByWorkflowChart` sorted by execution count, not cost — it was a "runs by workflow" chart, not a cost chart
- Budget tracker only tracked combined tokens — no input/output split for accurate cost attribution

## Solution

Added cost summary fields directly to `WorkflowExecutionStatus` (Option A from the design analysis). This routes cost data through the existing status update flow that both backends already persist, avoiding a dependency on OSS event persistence (which doesn't exist yet). The event log remains the detailed audit trail for per-task cost breakdown.

## Implementation Details

### Proto Layer
- Added `total_cost_micros`, `total_input_tokens`, `total_output_tokens` to `WorkflowExecutionStatus` (fields 10-12)
- Added `cost_micros`, `input_tokens`, `output_tokens` to `WorkflowTask` (fields 12-14)
- All cost values in micro-USD (1 USD = 1,000,000 micros), consistent with the billing domain
- Codegen regenerated across Go, Java, TypeScript, Python, Dart stubs in both repos

### Go Workflow Runner
- Split `budget.Tracker.TotalTokens` into `InputTokens` + `OutputTokens` for accurate per-provider cost analysis
- Updated `extractCostFromOutput` to read split token metadata (`__stigmer_input_tokens`, `__stigmer_output_tokens`)
- Backward compatible: falls back to `__stigmer_tokens` for in-flight executions
- LLM activity now emits split token counts from OpenAI/Anthropic provider responses

### Backend Persistence (Dual Edition)
- Go OSS: `update_status_impl.go` merges cost fields alongside existing phase/timestamp merge logic
- Java Cloud: `WorkflowExecutionUpdateStatusHandler.java` — identical three-field cost merge

### Aggregation Handlers (Dual Edition)
- Go OSS: `get_execution_summary.go` accumulates cost/tokens from each execution, converts micros to USD for `WorkflowCostSummary`, populates per-workflow `WorkflowCostBreakdown.totalCostUsd`
- Java Cloud: `GetExecutionSummaryHandler.java` — identical aggregation, sorts `costByWorkflow` by cost descending

### SDK/UI
- `CostByWorkflowChart`: now sorts by `totalCostUsd`, displays formatted dollar amounts as primary metric with execution count as secondary label, title changed to "Cost by Workflow"
- `ExecutionSummaryWidget`: already displayed `totalCost.totalCostUsd` — no changes needed, it just shows real data now

## Benefits

- Dashboard "Total Cost" card shows actual dollar amounts instead of "$0.00"
- Per-workflow cost breakdown enables identifying expensive workflows for optimization
- Input/output token split captured from day one — enables accurate cost analysis (input tokens are cheaper than output tokens)
- Both OSS and Cloud editions have identical cost aggregation behavior
- No new infrastructure dependencies — cost flows through existing status update pipeline

## Impact

- **Direct Users**: Workflow operators can now monitor actual execution costs on the dashboard
- **Platform Builders**: `useWorkflowDashboardSummary` hook returns real `totalCost` data that embedded dashboards can display
- **Budget Enforcement**: The existing budget tracker benefits from input/output token split for more accurate budget checks
- **Future Work**: Per-task cost fields (`WorkflowTask.cost_micros`) enable future execution viewer cost breakdown without changes

## Related Work

- T05 (Budget Primitives) — defined `WorkflowBudget` and `max_cost_micros`
- T06 (Event Stream Model) — defined `BudgetCheckpointPayload` and `TaskCompletedPayload.cost_micros`
- T13 (Backend Task Types) — built `budget.Tracker` and `events.Emitter`
- T14 (Dashboard Integration) — built `getExecutionSummary` RPC, `ExecutionSummaryWidget`, `CostByWorkflowChart`
- Go Event/Budget Wiring session — connected tracker to event emission pipeline

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
