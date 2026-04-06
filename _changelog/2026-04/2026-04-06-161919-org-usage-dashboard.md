# Organization Usage Dashboard

**Date**: April 6, 2026

## Summary

Replaced the "Coming Soon" placeholder on the `/settings/usage` page with a fully functional organization-level usage dashboard. The new page displays aggregated cost, token consumption, and execution activity sourced from the existing `getOrgUsageReport` gRPC RPC. The entire backend pipeline — protobuf definitions, Java handlers, and TypeScript SDK client methods — already existed; this change adds the React SDK data hook, styled dashboard component, and Console wiring.

## Problem Statement

The Settings sidebar listed a "Usage" item that rendered a static "This feature is coming soon" placeholder, despite the full backend pipeline being operational: `GetOrgUsageReportInput/Output` protos, `UsageAggregationService`, and `AgentExecutionClient.getOrgUsageReport()` were all in place.

### Pain Points

- Platform builders had no visibility into organization-level LLM cost and token consumption
- The backend investment in aggregation RPCs (daily cost trend, model breakdown, top agents by cost) was going unused
- The "Coming Soon" page undermined confidence in platform maturity

## Solution

Built the usage dashboard following the SDK-first layered architecture:

1. **`@stigmer/react` data hook** (`useOrgUsageReport`) — fetches aggregated usage with date range support
2. **`@stigmer/react` styled component** (`OrgUsagePanel`) — self-contained dashboard with summary cards, CSS-only daily cost chart, model breakdown table, and top agents table
3. **Console wiring** (`UsageSection`) — thin wrapper providing org context and deployment-mode guard

## Implementation Details

### New Module: `sdk/react/src/usage/`

- **`date-range.ts`** — Pure utility: `DateRange` type, `DateRangePreset` ("7d" | "14d" | "30d"), `dateRangeFromPreset()`, `formatDateRange()`, `presetLabel()`
- **`useOrgUsageReport.ts`** — Data-fetching hook following the established pattern: `useState` + `useEffect` + `useStigmer()`, cancel-on-unmount flag, `fetchKey`-based refetch. Accepts null-safe `orgId` and `DateRange`
- **`OrgUsagePanel.tsx`** — Dashboard panel with five internal sub-components:
  - `DateRangeSelector` — preset buttons with `aria-pressed` state
  - `SummaryCards` — four metric cards (Total Cost, Executions, Tokens, Agents) in a responsive grid
  - `DailyCostChart` — CSS-only bar chart using `--stgm-chart-1` token, hover tooltips, proportional-height divs
  - `ModelBreakdownList` — per-model rows with provider, token count, and cost
  - `TopAgentsList` — top agents by cost with execution count and tokens
- **`index.ts`** — Barrel exports for hook, component, types, and utilities

### Console Layer

- **`UsageSection.tsx`** — Follows the `MembersSection` pattern: gets `orgId` from `useOrg()`, guards with `useDeploymentMode()` for cloud-only, renders `OrgUsagePanel`
- **`page.tsx`** — Replaced `ComingSoon` import with `UsageSection`

### Design Decisions

- **CSS-only chart** — No charting library dependency. The daily cost chart uses flexbox with proportional-height `<div>` bars. This avoids adding `recharts` or `chart.js` to `@stigmer/react`, keeps the component embeddable with zero additional bundle cost, and uses the already-defined `--stgm-chart-*` theme tokens
- **Aggregated dashboard over execution log** — The `getOrgUsageReport` API returns aggregated data (daily trends, model breakdowns, top agents), not per-request rows. The dashboard matches the API shape and provides more actionable insight than a flat log
- **Reused existing utilities** — `formatCost` and `formatTokenCount` from the existing `UsageWidget` component, avoiding duplication

## Benefits

- Organization-level cost visibility with zero additional backend work
- Date range selection (7d, 14d, 30d) for flexible time windows
- Per-model cost breakdown enables informed model selection decisions
- Top agents by cost highlights optimization opportunities
- Platform builders can embed `<OrgUsagePanel>` or use `useOrgUsageReport` independently

## Impact

- **Users**: Organization owners and admins can now monitor LLM spending and usage patterns
- **Platform builders**: Can embed the hook (`useOrgUsageReport`) or the full panel (`OrgUsagePanel`) in their own dashboards
- **SDK surface**: 8 new exports from `@stigmer/react` (1 hook, 1 component, 4 utilities, 2 types)
- **Console**: `/settings/usage` is now a functional page instead of a placeholder

## Related Work

- `useSessionUsage` hook and `UsageWidget` (existing session-level usage, in `sdk/react/src/execution/`)
- `getOrgUsageReport` RPC and `UsageAggregationService` (backend, in `stigmer-cloud`)
- `UsageMetrics`, `ModelUsage`, `DailyCostEntry`, `AgentUsageSummary` proto types (in `apis/.../agentexecution/v1/`)

---

**Status**: Production Ready
**Timeline**: Single session
