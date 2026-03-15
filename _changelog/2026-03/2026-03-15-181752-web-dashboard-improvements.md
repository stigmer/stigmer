# Web Dashboard: Resource Overview, Quick Actions, and Enhanced Sessions

**Date**: March 15, 2026

## Summary

Transformed the dashboard from a static quick-actions page into an organizational overview. Resource overview cards show live agent/skill/MCP server counts, quick actions are trimmed to essential entry points, and RecentSessions uses the standardized error handling framework. This completes Phase 6 (Layout & View Completeness) of the web architecture alignment project.

## Problem Statement

The dashboard served as a landing page with quick action cards but provided no system state information. Users had no at-a-glance visibility into their organization's resource inventory.

### Pain Points

- Dashboard showed only action links — no counts, no status, no organizational context
- Quick actions included "Browse Agents" which was redundant with sidebar navigation and the new resource cards
- RecentSessions used an inline error div instead of the standardized `ErrorMessage` component (introduced in T09)
- RecentSessions empty state lacked onboarding guidance for new users
- `useSessionList` hook returned errors as `string | null`, inconsistent with the `Error | null` contract used by other hooks and the `ErrorMessage` component

## Solution

Three new components, one enhanced component, and a dashboard-specific data hook restructure the page into: ResourceOverview (stat cards) -> QuickActions (2 essential actions) -> RecentSessions (with error handling consistency).

## Implementation Details

### New: Dashboard Counts Hook (`useDashboardCounts`)

Layer 3 hook composing three Layer 2 domain service hooks (`useAgentQueryService`, `useSkillQueryService`, `useMcpServerQueryService`). Each fires a parallel `useQuery` with `page: { num: 1, size: 1 }` and a `select` function extracting only `totalCount`. Returns per-resource `count`, `isLoading`, and `error` — independent failure isolation means one failed count doesn't block the others.

Dashboard query keys (`dashboardKeys`) are isolated from domain-specific keys. Cache invalidation relies on TanStack Query defaults (30s stale time + `refetchOnWindowFocus`).

### New: Resource Overview Component

Grid of 3 compact stat cards using the existing `Card` primitive (`size="sm"`). Each card displays an icon (matching sidebar navigation icons), the resource label, and the live count. Loading state shows a pulse skeleton; error state shows a dash. Each card links to the corresponding resource list page.

### New: Quick Actions Component

Extracted from `page.tsx` and trimmed to two essential actions: "Run Agent" (primary workflow entry) and "Draft Resource" (unique dashboard-only entry point). "Browse Agents" was removed — it was triple-redundant with the sidebar navigation link and the new resource overview stat card.

### Enhanced: RecentSessions

- Replaced ad-hoc error `div` with `<ErrorMessage error={error} retry={refresh} />` for consistency with T09 error handling framework
- Improved empty state: descriptive hint ("Run an agent to start your first session") with a `Run Agent` link
- `useSessionList` hook updated to return raw `Error` object instead of error message string

### Dashboard Page Restructure

`app/page.tsx` simplified to compose three dashboard components with `space-y-8` spacing. TopBar description updated from "Welcome to Stigmer" to "Your organization at a glance." All inline `QUICK_ACTIONS` code removed.

## Benefits

- **Organizational awareness**: Users see resource counts on landing — no navigation needed to understand inventory
- **Onboarding guidance**: Empty dashboard state guides new users toward their first agent run
- **Error handling consistency**: RecentSessions aligns with every other data component in using the classified `ErrorMessage` system
- **Reduced redundancy**: Quick actions trimmed to actions that aren't reachable via sidebar or stat cards
- **Maintainability**: Dashboard page is a thin composition of focused components, each testable independently

## Impact

- **Users**: Dashboard is now informative on first visit — shows resource counts, recent activity, and two primary actions
- **Developers**: Dashboard follows the same three-layer hook pattern as every other feature, with dashboard-specific query key isolation
- **Architecture**: Phase 6 (Layout & View Completeness) is now complete — all six phases of foundational web work are done

## Related Work

- [Web Sessions Page](2026-03-15-180157-web-sessions-page-data-table.md) — T12, preceding task in Phase 6
- [Web Layout Overhaul](2026-03-15-174034-web-layout-overhaul-header-sidebar-breadcrumbs.md) — T11, first task in Phase 6
- [Web Error Handling Framework](2026-03-15-172120-web-error-handling-framework.md) — T09, `ErrorMessage` component adopted by RecentSessions
- [Web Three-Layer Service Architecture](2026-03-15-165841-web-phase4-three-layer-service-architecture.md) — T07/T08, hook pattern used by `useDashboardCounts`

---

**Status**: ✅ Production Ready
**Phase**: Phase 6 — Layout & View Completeness (COMPLETED)
