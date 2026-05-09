# Resource Workbench: Headless-First Collection Architecture (Phase 1)

**Date**: May 9, 2026

## Summary

Built the `ResourceWorkbench` — a complete headless-first resource collection system in `@stigmer/react` that replaces the monolithic `ResourceListView` with a proper composition architecture: headless hooks for data/filter/selection state, focused view components (table/cards/list), and a drop-in shell that composes them all. All three Console list pages (Agents, Skills, MCP Servers) have been migrated.

## Problem Statement

The existing `ResourceListView` was a 940-line monolithic component that violated the SDK's own DD-003 (headless-first) architecture mandate. It mixed search debouncing, scope toggling, two layout renderers, keyboard navigation, skeleton states, pagination, error handling, and inline SVG icons in a single component with 20+ props. This was not decomposable for platform builders, not extensible to table view or advanced features, and architecturally inconsistent with the rest of the SDK.

### Pain Points

- No table view for operational resource management (agents, MCP servers, runners)
- No column sorting — server returned results in a fixed order
- No item selection or bulk actions
- No split-panel inspector for quick previews
- No filter chips or advanced filter UI
- Monolithic component prevented adoption at different abstraction levels (hooks vs components)
- Card and list views were not independently importable

## Solution

Built a three-tier headless-first architecture following Cloudscape patterns, TanStack philosophy, and the SDK's DD-003 mandate:

1. **Hooks layer** — `useResourceCollection` (TanStack Table + useFetch), `useResourceFilters` (filter/sort/query state with URL-sync callbacks), `useResourceSelection` (toggle, range-select, select-all)
2. **View components layer** — `ResourceTable`, `ResourceCards`, `ResourceList` (each independently importable)
3. **Shell layer** — `ResourceWorkbench` (composes everything into a drop-in browsing experience)

## Implementation Details

**14 new files** in `sdk/react/src/resource-workbench/`:

- `types.ts` — Shared types: `ViewMode`, `StatusPhase`, `WorkbenchColumnDef`, `FilterDef`, `FilterValue`, `SortDef`, `SortValue`, `ResourceAction`, `BulkAction`, `WorkbenchState`
- `hooks/useResourceCollection.ts` — Wraps TanStack Table instance + `useFetch` for data fetching, sorting bridge, and selection state
- `hooks/useResourceFilters.ts` — Filter/sort/query state with debounced search and `onStateChange` callback for URL sync (zero router dependency)
- `hooks/useResourceSelection.ts` — Selection state with single toggle, shift-click range select, select-all, and automatic clear on page/filter change
- `hooks/useViewPreference.ts` — Persisted view mode (table/cards/list) in localStorage
- `components/StatusBadge.tsx` — Accessible status indicator using `--stgm-status-*` tokens (dot + text, never color alone)
- `components/ResourceTable.tsx` — Table view built on TanStack Table's `flexRender`
- `components/ColumnHeader.tsx` — Sortable column header with `aria-sort`
- `components/SelectionCheckbox.tsx` — Native checkbox with indeterminate support
- `components/ResourceCards.tsx` — Responsive card grid with selection and action slots
- `components/ResourceList.tsx` — Compact list view with selection and action slots
- `components/FilterBar.tsx` — Active filter chips with remove/clear-all
- `components/ViewSwitcher.tsx` — Table/cards/list toggle with radio group semantics
- `components/BulkActionBar.tsx` — Floating selection bar with `aria-live`
- `components/ResourceInspector.tsx` — Split-panel preview with `role="complementary"`
- `components/ResourceWorkbench.tsx` — The composed shell: toolbar + views + filters + selection + pagination + inspector

**Dependencies**: `@tanstack/react-table` added as optional peer dependency (MIT, DD-012 compliant).

**Console migration**: All three list pages (`AgentListPage`, `SkillListPage`, `McpServerListPage`) migrated from `ResourceListView` to `ResourceWorkbench`. Pages are now thinner — they pass a `listFn`, column definitions, and action menus. The workbench handles search, pagination, view switching, and empty/error states internally.

## Benefits

- **Three adoption tiers** — Platform builders choose hooks-only (full control), view components (Stigmer rendering, custom layout), or full workbench (drop-in)
- **Table view** — Sortable columns, row actions, selection checkboxes — the primary operational view for resource management
- **Filter architecture** — Property-filter model with chips, ready for advanced filters in future phases
- **Selection + bulk actions** — Checkbox selection with shift-click range select, floating action bar
- **Split inspector** — Optional preview panel without leaving the list
- **View persistence** — User's preferred view mode (table/cards/list) persisted in localStorage
- **Zero framework coupling** — URL sync via callbacks, no `next/*` imports (DD-004)
- **Accessible** — `aria-sort` on table headers, `role="checkbox"` on selection, `aria-live` on bulk bar, `role="complementary"` on inspector

## Impact

- **SDK public API surface**: 22 new exports (hooks, components, types) added to `@stigmer/react`
- **Console list pages**: All three migrated — no longer depend on the deprecated `ResourceListView`
- **Old `ResourceListView`**: Marked `@deprecated`, not deleted — backward compatible for any external consumers
- **New dependency**: `@tanstack/react-table` as optional peer dep

## Related Work

- Phase 0 UX Foundations (previous session): Status tokens, EmptyState, ActionMenu, toast system
- Research report: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`
- Next: Phase 2 — Detail Pages as Operational Hubs

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes implementation)
