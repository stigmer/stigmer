# Workflow Execution History and Operations Dashboard (T13)

**Date**: May 24, 2026

## Summary

Built a complete execution history and operations dashboard that replaces the minimal 3-column Executions tab with a rich, filterable execution table, health metrics strip, filter bar, and failure analysis panel. The implementation spans the full stack: proto definitions, Go backend, Java backend, React SDK components, and E2E tests.

## Problem Statement

The workflow execution list was a bare table showing only Name, Phase, and Started columns. Users had no way to filter executions, see cost/duration/token data, identify patterns in failures, or get an at-a-glance health overview of their workflow runs.

### Pain Points

- No visibility into execution cost, duration, or token usage in the list view
- No filtering capability (status, cost range, duration range, failed task)
- No health metrics summary (success rate, active count, total cost)
- No failure analysis grouping (which tasks fail most often?)
- Execution data was fetched but never displayed

## Solution

Implemented a layered architecture following the SDK-first, headless-first patterns:
1. Pure derivation layer that transforms `WorkflowExecution` proto into UI-ready `ExecutionRow` objects
2. Server-side filter/sort proto contract with implementations in both Go and Java backends
3. Composed SDK component that assembles health metrics, filter bar, data table, and failure analysis

## Implementation Details

### Proto Layer
- Added `ExecutionFilterCriteria` message with 9 filter fields (phases, time range, duration range, cost range, failed task name, has retries)
- Added `ExecutionSortField` enum (started_at, duration, cost, status)
- Extended both `ListWorkflowExecutionsRequest` and `ListWorkflowExecutionsByWorkflowRequest` with filter, sort_field, sort_ascending fields
- Ran codegen in both OSS and Cloud repos

### Go Backend (OSS)
- Created `execution_filter.go` with `applyFilterCriteria()`, `applySortField()`, and `applyLegacyPhaseFilter()` for in-memory filtering and sorting
- Updated `list.go` and `list_by_workflow.go` to apply filters and sort (backward-compatible: unset filters return all results)
- 11 table-driven unit tests covering all filter fields, sort directions, and combined filters

### Java Backend (Cloud)
- Created `ExecutionFilterHelper.java` mirroring Go filter logic using Java streams and Comparators
- Updated `WorkflowExecutionListHandler` and `WorkflowExecutionListByWorkflowHandler` to apply filtering and sorting after IAM-scoped load

### SDK React Layer (9 new files)
- `derive-execution-row.ts`: Pure `WorkflowExecution` -> `ExecutionRow` derivation with computed duration, failed task, retry count, token totals
- `derive-failure-analysis.ts`: Groups failed executions by failing task name, sorted by frequency
- `useExecutionHistoryData.ts`: Behavior hook composing list fetch + derivation + client-side filters
- `ExecutionHistoryTable.tsx`: Data-dense table with 8 columns, sortable headers, keyboard navigation, loading/error/empty states
- `ExecutionFilterBar.tsx`: Phase chips, duration presets, cost presets, "has retries" toggle with progressive disclosure
- `HealthMetricsStrip.tsx`: Compact horizontal strip showing Total, Success Rate, Avg Duration, Cost, Active (live dot), Tokens
- `FailureAnalysisPanel.tsx`: Collapsible failure groups with expand-to-see-instances
- `WorkflowExecutionHistory.tsx`: Top-level composed component assembling all pieces
- Extended `useWorkflowExecutionList` with `filter`, `sortField`, `sortAscending` options

### Client App Integration
- Replaced old 3-column `ExecutionsTab` in `WorkflowDetailView` with `WorkflowExecutionHistory`
- Removed dead `ExecutionsTab` function

### Tests
- 36 TypeScript unit tests (derivation, sorting, filtering)
- 11 Go unit tests (filter criteria, sort, combined filters)
- 6 Playwright E2E test cases (table rendering, filter bar, phase toggle, column headers, row click)

## Benefits

- Execution list now shows Duration, Cost, Tokens, Task Progress, Failed/Current Task — all derived from existing data
- Phase filter chips provide instant client-side filtering with one click
- Health metrics strip gives at-a-glance operational health (success rate, active count, cost)
- Failure analysis panel identifies which tasks fail most frequently
- Server-side filter contract ready for when client-side filtering reaches scale limits
- All components are SDK-first: embeddable by platform builders with zero Console dependencies

## Impact

- **Users**: Can now understand execution patterns, filter to failed runs, see cost/duration at a glance
- **Platform builders**: New `WorkflowExecutionHistory` component available as a drop-in embeddable
- **Backend**: Both Go and Java backends support structured filter/sort queries (backward-compatible)

## Related Work

- T05 Runtime Inspector — provided `format-utils.ts` formatters reused by the table
- T12 Overview Page — provided `useWorkflowDashboardSummary` hook reused by health strip
- T07 Waterfall Timeline — established the pure derivation pattern followed here
- Deferred: Run comparison (side-by-side diff), p50/p95 percentiles, trigger type/version columns

---

**Status**: ✅ Production Ready
**Timeline**: Single session
