# Session Notes: 2026-05-24 — T13 Execution History and Operations Dashboard

## Accomplishments

- Built complete execution history module (9 new files in `sdk/react/src/workflow/execution-history/`)
- Added `ExecutionFilterCriteria` proto message and `ExecutionSortField` enum
- Implemented server-side filter/sort in Go backend with 11 unit tests
- Implemented server-side filter/sort in Java backend (ExecutionFilterHelper)
- Extended `useWorkflowExecutionList` hook with filter/sort support
- Replaced old 3-column `ExecutionsTab` with composed `WorkflowExecutionHistory`
- Created 6 Playwright E2E tests
- All exports wired through barrel files to SDK public surface

## Decisions Made

- **Domain-specific table over TanStack reuse**: Evaluated `resource-workbench/ResourceTable` (TanStack Table-based) but chose a focused domain table because execution-history has computed columns from a derivation pipeline, which doesn't map cleanly to TanStack's accessor pattern. Followed the same visual conventions (borders, header styles, sort indicators).
- **Client-side + server-side filtering**: Phase 1 uses client-side filtering on loaded data (instant). Server-side filters are wired into the proto and hooks but the `WorkflowExecutionHistory` component currently uses client-side filtering. Server-side can be activated by passing `filter` prop to `useWorkflowExecutionList`.
- **ExecutionFilterBar progressive disclosure**: "More filters" button hides duration/cost/retry filters by default to avoid overwhelming new users. Phase chips are always visible since they're the most common filter.
- **HealthMetricsStrip as compact strip (not cards)**: Differentiated from `WorkflowOverviewSummary` (4 stat cards in the Overview tab) by using a single-row horizontal strip with dividers — optimized for the table header context where vertical space is at a premium.
- **sort_ascending (not sort_descending)**: Proto uses `bool sort_ascending` defaulting to `false` (descending) rather than the plan's `sort_descending`. This aligns with the convention where the default zero-value gives the most common behavior (newest first).

## Key Code Changes

- `apis/.../workflowexecution/v1/io.proto`: Added `ExecutionFilterCriteria`, `ExecutionSortField`, filter/sort fields on both list requests
- `backend/.../controller/execution_filter.go`: In-memory filter + sort logic shared by both list handlers
- `sdk/react/src/workflow/execution-history/`: 9 new files (derivation, hooks, components)
- `sdk/react/src/workflow/WorkflowDetailView.tsx`: Replaced `ExecutionsTab` with `WorkflowExecutionHistory`
- `sdk/react/src/workflow/useWorkflowExecutionList.ts`: Extended with filter/sortField/sortAscending options

## Deferred Items

- **Run comparison** — separate task, needs UX design for side-by-side diff
- **p50/p95 percentiles** — requires proto + backend extension
- **Trigger type and Version columns** — not tracked in current proto
- **Top expensive tasks** — server-side aggregation needed
- **Java unit tests for ExecutionFilterHelper** — helper is tested indirectly through handler but lacks dedicated unit tests

## Next Session Plan

- T13 is complete as scoped. Next task from the project plan is T14 (AI-Assisted Workflow Creation) or tackling deferred items.
- The deferred run comparison could be a good T13b follow-up.
