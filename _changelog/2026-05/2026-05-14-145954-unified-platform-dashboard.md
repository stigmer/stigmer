# Unified Platform Dashboard

**Date**: May 14, 2026

## Summary

Transformed the workflow-only operational dashboard into a unified platform dashboard that surfaces both agent and workflow execution metrics in a single view. The dashboard now shows combined active, completed, and failed execution counts across both domains, with total cost sourced from the billing pipeline to prevent double-counting. Full vertical slice: proto API, Go+Java backends, React SDK module, and console integration with web/desktop parity.

## Problem Statement

The existing `/dashboard` page was exclusively workflow-scoped — it only showed workflow execution statistics, pending approvals, and failed runs. Agent executions, which represent a significant portion of platform activity, were invisible from the operational overview. Users had to mentally piece together what was happening on their platform by checking separate pages.

### Pain Points

- Dashboard showed "Operational overview of workflow executions" — not representative of overall platform health
- No agent execution metrics (active, completed, failed counts) visible from the dashboard
- No unified view of recent failures across both agent and workflow domains
- Cost display was workflow-only, missing agent-related costs entirely
- No `getExecutionSummary` RPC existed for agent executions (only for workflows)

## Solution

Added a parallel `getExecutionSummary` RPC to the agent execution domain (mirroring the workflow pattern), then built a new React SDK dashboard module that composes data from three sources — agent execution summary, workflow execution summary, and org usage report — into a unified `DashboardSummary`. Console pages replaced the workflow-only `WorkflowDashboard` with the new `OperationalDashboard`.

## Implementation Details

### Proto API

Added to `agentexecution/v1/io.proto`:
- `AgentExecutionSummaryTimeWindow` enum (LAST_24H, LAST_7D, LAST_30D)
- `GetAgentExecutionSummaryRequest` message
- `AgentExecutionSummary` message (active_count, phase_counts, avg_duration, top_failing_agents — no cost field per AD-DASH-005)
- `AgentFailureRank` message

Added `getExecutionSummary` RPC to `AgentExecutionQueryController` in `query.proto`.

### Backend Handlers

**Go (stigmer-server)**: New `get_execution_summary.go` — SQLite-based aggregation of agent execution records. Computes active count, phase distribution, average duration, and top 5 failing agents by failure count.

**Java (stigmer-service)**: New `AgentExecutionGetExecutionSummaryHandler.java` — MongoDB aggregation with IAM-scoped access control. Same metrics, matching the workflow `GetExecutionSummaryHandler` pattern.

### SDK Dashboard Module (`sdk/react/src/dashboard/`)

| File | Layer | Purpose |
|------|-------|---------|
| `types.ts` | Types | `DashboardSummary`, `DashboardFailedRun` interfaces |
| `useAgentExecutionSummary.ts` | Data Hook | Calls agent `getExecutionSummary` RPC |
| `useDashboardSummary.ts` | Composition Hook | Merges agent + workflow + usage into `DashboardSummary` |
| `useDashboardFailedRuns.ts` | Composition Hook | Merges failed agent + workflow executions |
| `DashboardKPICards.tsx` | Styled Component | Active, Completed, Failed, Total Cost cards with breakdown tooltips |
| `DashboardFailedRuns.tsx` | Styled Component | Merged failure list with agent/workflow type badges |
| `OperationalDashboard.tsx` | Composed Widget | KPI cards + pending approvals + failed runs |
| `index.ts` | Barrel | Public API surface |

### Console Integration

Both web (`DashboardPage.tsx` via Next.js) and desktop (`DashboardPage.tsx` via React Router) now:
- Use `useOrg()` to get both org slug and org ID (needed for usage report)
- Render `OperationalDashboard` with unified agent+workflow metrics
- Keep workflow-specific charts (`CostByWorkflowChart`, `ExecutionTrendChart`) below
- Route failed run clicks through the unified `/executions/[id]` route (auto-detects type from ID prefix)

### Key Architectural Decision: Cost Attribution (AD-DASH-005)

Total platform cost comes from `getOrgUsageReport` (billing source of truth), NOT from summing agent + workflow costs. When a workflow delegates to an agent, the agent's LLM calls create billing records AND the workflow's `total_cost_micros` includes that cost — summing both would double-count.

## Benefits

- **Unified operational view**: One glance shows platform-wide health across both agent and workflow domains
- **Accurate cost reporting**: No double-counting thanks to billing source-of-truth approach
- **Familiar patterns**: Follows established `useRecentActivity` composition pattern for client-side data merging
- **Clean architecture**: No cross-domain backend coupling — each domain exposes its own summary RPC

## Impact

- **Users**: Dashboard now accurately represents all platform activity, not just workflows
- **SDK consumers**: New `useDashboardSummary` hook and `OperationalDashboard` component available for custom dashboards
- **Architecture**: Establishes the pattern for future cross-domain composition (Usage page unification will follow the same approach)

## Related Work

- Follows from T14 (Dashboard Integration + Desktop Workflow Parity) which created the original workflow-only dashboard
- Cost Data Pipeline (2026-05-14) which wired real cost/token data from workflow runner to dashboard
- `useRecentActivity` module which established the client-side composition pattern

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~3 hours)
