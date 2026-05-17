# Workflow Dashboard Separation + Chart Visualizations

**Date**: May 14, 2026

## Summary

Extracted operational metrics (execution stats, pending approvals, failed runs) from the Workflow List Page into a dedicated top-level Dashboard page at `/dashboard`. Added two chart visualization components to the SDK. The Workflow List Page now matches the Agent List Page pattern — clean blueprint management only.

## Problem Statement

The Workflow List Page mixed two concerns: blueprint management (listing, searching, deleting workflows) and operational metrics (execution counts, pending approvals, failed runs, cost). The Agent List Page had no such widgets — workflows should match that pattern. Operational metrics belong on a dedicated Dashboard screen accessible from the sidebar.

### Pain Points

- Workflow List Page was cluttered with dashboard widgets above the resource list
- No way to view operational metrics without navigating to the workflow list
- Agent vs Workflow list page patterns were inconsistent
- Chart visualizations for execution trends and cost breakdown had no home

## Solution

Created a dedicated `/dashboard` route (top-level, same level as `/library` and `/runners`) with a new "Dashboard" sidebar nav item. Moved the existing `WorkflowDashboard` component to this new page and added two new chart widgets. Cleaned the Workflow List Page to match the Agent List Page pattern.

## Implementation Details

### New SDK Chart Components

- **`CostByWorkflowChart`** — Horizontal bar chart showing execution counts by workflow. Pure CSS bars (no recharts dependency needed for this visualization), sorted by count, themed with `--stgm-*` tokens.
- **`ExecutionTrendChart`** — Phase distribution chart with stacked horizontal bar and per-phase legend. Renders from `ExecutionSummary.phaseCounts`.

Both components follow the existing SDK widget patterns: `memo`-wrapped, loading skeletons, empty states, `className` prop for composition.

### Dashboard Page (Web + Desktop)

Thin page shells that compose existing SDK components:
- `WorkflowDashboard` (execution stats, pending approvals, failed runs)
- `CostByWorkflowChart` + `ExecutionTrendChart` in a 2-column card grid

Web uses Next.js routing (`/dashboard/page.tsx`), desktop uses React Router (`/dashboard` in `routes.tsx`).

### Sidebar Navigation

Added "Dashboard" nav item with `LayoutDashboard` icon between "New Session" and "Library" in both web and desktop sidebars. Active state highlights follow existing patterns.

### Workflow List Page Cleanup

Removed `WorkflowDashboard` import and rendering from both web and desktop `WorkflowListPage`. Removed unused `useRouter`/`handleExecutionNav` callback from the web version. Pages now show only header + `ResourceWorkbench`, matching `AgentListPage`.

### Package Changes

Added `recharts ^2.15.0` as optional peer dependency to `@stigmer/react` (same pattern as `@xyflow/react` and CodeMirror packages).

## Benefits

- Clean separation of concerns: blueprints vs operations
- Consistent UI patterns across Agent and Workflow list pages
- Dashboard provides a centralized operational overview
- Chart components ready for real data once cost pipeline is wired
- Both web and desktop have full parity (DD-016)

## Impact

- **Users**: New Dashboard sidebar item provides centralized workflow operations view
- **SDK consumers**: Two new chart components available for custom dashboards
- **Developers**: Workflow List Page is simpler and follows established patterns

## Related Work

- T14: Dashboard Integration + Desktop Workflow Parity (created the original `WorkflowDashboard` component)
- T15: Visual Builder (Phase 2 completion)
- Cost data pipeline (future): Will make dashboard charts show real cost data

---

**Status**: ✅ Production Ready
