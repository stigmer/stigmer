# Checkpoint: Cost Data Pipeline

**Date**: 2026-05-14
**Task**: Cost Data Pipeline (post-Phase 2, pre-T16)
**Status**: COMPLETE
**Scope**: Proto APIs, Go workflow-runner, Go stigmer-server, Java stigmer-service, React SDK

## Accomplishments

Wired real cost and token data from the Go workflow-runner through both backend
control planes (Go OSS + Java Cloud) into the SDK dashboard components. The
dashboard charts now show actual execution cost and token usage instead of
empty/zero values. This closes the gap identified in the Phase 1/2 deliverables
where the dashboard shipped with charts but no data.

## Proto Changes (1 file, codegen across 6 languages)

- `WorkflowExecutionStatus`: `total_cost_micros` (10), `total_input_tokens` (11), `total_output_tokens` (12)
- `WorkflowTask`: `cost_micros` (12), `input_tokens` (13), `output_tokens` (14)
- All values in micro-USD (1 USD = 1,000,000 micros), consistent with `WorkflowBudget.max_cost_micros`

## Go Workflow Runner (3 files modified)

- `budget.Tracker`: split `TotalTokens int64` into `InputTokens int64` + `OutputTokens int64`
  - `Record()` now accepts `(costMicros, inputTokens, outputTokens int64)`
  - `TotalTokens()` method returns combined total for budget enforcement
  - `Check()` and `TokensRemaining()` use combined total
- `extractCostFromOutput`: reads `__stigmer_input_tokens` / `__stigmer_output_tokens` separately
  - Backward compatible: falls back to `__stigmer_tokens` if present
- `buildLlmOutput`: emits split token counts from LLM provider responses
- `temporal_workflow.go`: updated field reference to method call

## Go OSS Backend (2 files modified)

- `update_status_impl.go`: merges `TotalCostMicros`, `TotalInputTokens`, `TotalOutputTokens`
- `get_execution_summary.go`: accumulates cost/tokens per execution, populates `WorkflowCostSummary` with real data, populates `WorkflowCostBreakdown.TotalCostUsd` per workflow

## Java Cloud Backend (2 files modified)

- `WorkflowExecutionUpdateStatusHandler.java`: same three-field cost merge
- `WorkflowExecutionGetExecutionSummaryHandler.java`: identical aggregation logic, sorts `costByWorkflow` by cost descending (was execution count)

## SDK/UI (1 file modified)

- `CostByWorkflowChart.tsx`: sorts by `totalCostUsd` (was `executionCount`), shows formatted dollar amounts as primary metric, execution count as secondary, title "Cost by Workflow"

## Key Design Decisions

### DD: Cost on status snapshot, not derived from events
Cost data lives on `WorkflowExecutionStatus` (same pattern as phase, timestamps).
Both backends persist it as part of the normal status update flow. The event log
remains the detailed audit trail for per-task cost breakdown, but the dashboard
aggregation reads from the status snapshot for fast queries. This avoids a dependency
on OSS event persistence (which doesn't exist yet).

### DD: Input/output token split captured from day one
The budget tracker tracks `InputTokens` and `OutputTokens` separately (not combined).
Budget enforcement uses the combined total. This future-proofs cost analysis (input
tokens are cheaper than output tokens for most providers).

### DD: Backward-compatible token extraction
`extractCostFromOutput` falls back to `__stigmer_tokens` if the new split keys
aren't present, maintaining compatibility with any in-flight executions using
the old convention.

## Verification

- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- `go build` + `go vet` — clean: stigmer-server, workflow-runner
- Zero linter errors on all modified files
- `buf lint` — clean

## Scope Boundaries (NOT done)

- OSS event persistence (events field on UpdateStatusInput still ignored in Go)
- Agent cost attribution (agent_call records 0 cost in budget tracker)
- Historical data backfill (existing executions show $0.00)
- `CheckBudgetWarnings()` wiring into `ValidateWorkflow()`
