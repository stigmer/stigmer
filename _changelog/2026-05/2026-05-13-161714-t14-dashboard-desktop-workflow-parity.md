# T14: Dashboard Integration + Desktop Workflow Parity

**Date**: May 13, 2026

## Summary

Brought all workflow UI surfaces to the desktop app (previously web-only), designed and implemented new aggregation proto APIs for dashboard data, built SDK dashboard components following the three-layer headless-first pattern, and integrated the dashboard into both web console and desktop app. This completes the last Phase 1 task for the "Bring Workflows to the Foreground" initiative.

## Problem Statement

Workflows were invisible in the desktop app — zero routes, zero sidebar navigation, zero pages. Users could only interact with workflows via the web console. Additionally, there was no dashboard or summary view for workflow health — no execution KPIs, no pending approval queue, no failure tracking.

### Pain Points

- Desktop app had complete parity for agents, skills, MCP servers, and sessions — but zero workflow surfaces
- No aggregated dashboard data: users had to browse individual executions to understand workflow health
- No backend APIs for execution statistics or pending approvals — only paginated list and single-get RPCs existed
- DD-016 (client app parity) was violated for all workflow components

## Solution

Four-phase implementation strictly ordered to build on each layer:

1. **Desktop Parity (Phase A)**: Wire existing SDK workflow components into the desktop app following established patterns from agents/skills/MCP servers
2. **Proto APIs (Phase B)**: Design new `getExecutionSummary` and `listPendingApprovals` RPCs with aggregation messages, implement in both Go (OSS) and Java (Cloud)
3. **SDK Dashboard (Phase C)**: Build data hooks and styled components following DD-001 (SDK-first), DD-003 (headless-first)
4. **Integration (Phase D)**: Wire `WorkflowDashboard` into both web and desktop `/workflows` pages with identical props (DD-016)

## Implementation Details

### Phase A: Desktop Workflow Parity (7 new files, 2 modified)

- Added "Workflows" nav item to desktop sidebar with `Workflow` icon from lucide-react
- 4-route tree: `/workflows`, `/workflows/:org/:slug`, `/workflows/executions`, `/workflows/executions/:id`
- 4 thin page shells mirroring web patterns but using React Router (`useNavigate`/`useParams`) instead of Next.js
- `WorkflowLayout` + `WorkflowBreadcrumb` following the existing `LibraryLayout` pattern
- Scope persistence for workflow list view mode

### Phase B: Proto APIs (2 proto files, 2 Go handlers, 2 Java handlers, codegen in both repos)

- `SummaryTimeWindow` enum: LAST_24H, LAST_7D, LAST_30D, ALL_TIME
- `getExecutionSummary` RPC: phase counts, active count, total cost, average duration, top failing workflows (top 10), per-workflow cost breakdown (top 10)
- `listPendingApprovals` RPC: executions with active human_input tasks in WAITING_APPROVAL status
- Go (OSS): In-memory aggregation over all executions from SQLite store — appropriate for single-user local environments
- Java (Cloud): IAM-scoped aggregation using `IamPolicyGrpcRepo.listAuthorizedResourceIds` + `WorkflowExecutionRepo.findByIds`, then in-process aggregation

### Phase C: SDK Dashboard Components (6 new files, 2 modified barrel exports)

- `useWorkflowDashboardSummary` — data hook calling `getExecutionSummary` with configurable refetch interval
- `usePendingApprovals` — data hook calling `listPendingApprovals` with 30s default refetch
- `ExecutionSummaryWidget` — stat cards (active/completed/failed/cost) + phase breakdown bar
- `PendingApprovalsWidget` — compact approval list with workflow name, task name, time waiting, review action
- `FailedRunsWidget` — recent failures from existing `list(phase=FAILED)` API — no new backend needed
- `WorkflowDashboard` — composed container orchestrating all three widgets with responsive grid layout

### Phase D: Web + Desktop Integration (2 modified files)

- Both `WorkflowListPage` pages render `WorkflowDashboard` above `ResourceWorkbench` with identical callback props for execution navigation

## Benefits

- **Desktop users get full workflow access**: List, detail (with editor tab), run dialog, execution viewer, execution list — all accessible from the desktop sidebar
- **At-a-glance workflow health**: Dashboard shows KPIs, pending approvals, and failures without browsing individual executions
- **Embeddable dashboard**: Platform builders can drop `<WorkflowDashboard org="acme" />` into their own applications
- **Proper aggregation APIs**: Server-side computation instead of client-side pagination hacks
- **DD-016 compliance**: Both client apps wire SDK components identically

## Impact

- **Desktop app**: Gains 7 new files + 2 modified for complete workflow parity
- **Proto contract**: 2 new RPCs + 10 new message types in workflowexecution service
- **SDK surface**: 6 new public exports (2 hooks, 4 components) added to `@stigmer/react`
- **Both backends**: Go and Java implementations for the new dashboard RPCs
- **Both client apps**: Dashboard widget visible on `/workflows` page

## Related Work

- T08 (Workflow List & Detail Pages), T09 (Execution Viewer), T10 (YAML Editor), T11 (Run Workflow) — the SDK components this task wires into desktop
- T05 (Budget Primitives) — cost data model used by the dashboard
- T06 (Execution Event Stream) — event log infrastructure
- T13/T13b (Backend Task Types) — task execution that generates the data the dashboard aggregates

---

**Status**: ✅ Production Ready
**Timeline**: Single session
