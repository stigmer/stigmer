# Library Card Grid Layout for MCP Servers and Agents

**Date**: April 13, 2026

## Summary

Transformed the MCP Server and Agent library pages from a vertical single-column list into a responsive multi-column card grid layout. Added a `layout` prop to the shared `ResourceListView` SDK component, a new `DefaultResourceCard` with icon containers that adapt to dark/light mode, per-item action button support, and grid-aware keyboard navigation — all built SDK-first in `@stigmer/react`.

## Problem Statement

The library pages for MCP Servers and Agents displayed resources as flat, single-column rows — visually sparse and missing the density and visual appeal that marketplace-style browsing demands. Compared to competitor platforms (Claude Code directory, Vercel integrations), the listing felt utilitarian rather than inviting. Additionally, per-resource icons (`icon_url`) existed in the data model but were unused in listing views.

### Pain Points

- Single-column list wastes horizontal real estate on wide screens
- No visual hierarchy — every resource row looks identical with a tiny generic kind icon
- No quick-action affordance (like a "connect" or "open" button) on individual items
- `icon_url` fields on `McpServerSpec` and `AgentSpec` are ignored in list views
- No card-style layout option in the shared `ResourceListView` component

## Solution

Extended the existing `ResourceListView` component with a `layout` prop (`"list" | "grid"`) that switches between the original vertical list and a responsive card grid. The grid layout uses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` for 1/2/3 columns depending on viewport width. A new `renderItemAction` prop allows consumers to inject per-card action buttons.

## Implementation Details

### New Props on `ResourceListView`

- **`layout?: "list" | "grid"`** — Controls the visual layout. Defaults to `"list"` for backward compatibility. When `"grid"`, the item container switches from `flex flex-col` to a CSS grid, and the default renderer becomes `DefaultResourceCard` instead of `DefaultResourceRow`.
- **`renderItemAction?: (item: SearchResult) => ReactNode`** — Renders an action element per item. In grid mode it sits in the card's top-right corner; in list mode it trails the row.

### `DefaultResourceCard` Component

Each card has:
- A `size-10 rounded-lg bg-muted` icon container (`ResourceIcon`) with the `KindIcon` SVG centered inside — the neutral `bg-muted` background adapts to dark/light mode automatically via `--stgm-muted` tokens
- Name (semibold, truncated), "Public" visibility badge, org slug
- 2-line-clamped description
- Optional action slot in the top-right corner

### Grid Card Styling

Interactive cards use `border border-border bg-card rounded-lg p-4` with `hover:border-primary/40 hover:bg-accent/30` — all token-driven, consistent with `ResourceCountCard` and the `ProviderPicker` pattern.

### Grid Keyboard Navigation

Extended the roving tabindex pattern to support four-direction arrow key navigation. The component auto-detects the number of rendered columns via `getBoundingClientRect()` so ArrowUp/Down jump by the correct column count.

### Skeleton Loading State

Added `SkeletonCards` — 6 card-shaped pulse-animated placeholders matching the grid layout, used when `layout="grid"` and data is loading.

### Console Integration

- **`McpServerListPage`** — Now passes `layout="grid"` with a `renderItemAction` that renders a Plus button navigating to the MCP server detail view.
- **`AgentListPage`** — Now passes `layout="grid"` (no action button — agents don't have a connect flow).
- **`SkillListPage`** — Unchanged; remains `layout="list"` (skills have no `icon_url` in the proto).

### Exported Types

`ResourceListLayout` type exported from `@stigmer/react` for platform builders who want to control layout dynamically.

## Benefits

- Visually richer marketplace-style browsing for MCP Servers and Agents
- Better use of horizontal space — 2-3 cards per row instead of 1
- Icon containers ready for per-resource `icon_url` images (Phase 2 — add `icon_url` to `SearchResult` proto)
- Dark/light mode icons handled via neutral `bg-muted` container — no schema changes needed
- Quick-action button on MCP server cards improves discoverability of the connect flow
- Fully backward compatible — `layout="list"` is the default; existing consumers unchanged
- SDK-first: all new components and props live in `@stigmer/react`, consumable by platform builders

## Impact

- **MCP Server library page**: Cards with icon containers, name, org, description, Plus action button
- **Agent library page**: Cards with icon containers, name, org, description
- **Skill library page**: No change (remains list)
- **Platform builders**: Can now use `layout="grid"` and `renderItemAction` in their own resource browsers
- **Phase 2 readiness**: When `icon_url` is added to `SearchResult` proto, cards will automatically show real icons

## Related Work

- `ProviderPicker` (`sdk/react/src/identity-provider/ProviderPicker.tsx`) — prior art for grid card layout with icon containers in the SDK
- `ResourceCountCard` (`sdk/react/src/library/ResourceCountCard.tsx`) — token-driven card styling pattern
- Phase 2: Add `icon_url` field to `SearchResult` proto (`apis/ai/stigmer/search/v1/io.proto`)

---

**Status**: ✅ Production Ready
**Files Changed**: 5 (3 SDK, 2 Console)
