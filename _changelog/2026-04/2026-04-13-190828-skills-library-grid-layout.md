# Skills Library Grid Layout

**Date**: April 13, 2026

## Summary

Switched the Skills library page from list layout to grid layout, bringing it in line with the Agents and MCP Servers library pages that already use the card grid.

## Problem Statement

The Skills library page at `/library/skills` rendered skills as a vertical list, while both the Agents and MCP Servers pages had already been upgraded to the responsive card grid layout. This created an inconsistent browsing experience across the three resource types in the Library.

### Pain Points

- Visual inconsistency between Skills (list) and Agents/MCP Servers (grid)
- Skills lost the information density and scannability benefits of the card grid
- Users switching between library tabs experienced a jarring layout change

## Solution

Added `layout="grid"` to the `ResourceListView` component in `SkillListPage.tsx`. The SDK's `ResourceListView` already supports both `"list"` and `"grid"` layouts with full feature parity — including responsive columns, skeleton loading states, keyboard navigation, and the `DefaultResourceCard` renderer with kind-based icon fallbacks.

## Implementation Details

Single prop addition in `client-apps/web/src/app/library/skills/SkillListPage.tsx`:

```tsx
<ResourceListView
  layout="grid"
  items={skills}
  ...
/>
```

No SDK changes required. The `ResourceListView` component handles:
- Responsive grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- `DefaultResourceCard` with `SkillIcon` (lightning bolt) fallback when no `iconUrl` is present
- Grid-aware keyboard navigation (ArrowLeft/Right + column-aware Up/Down)
- Grid skeleton loading state (`SkeletonCards`)

## Benefits

- Consistent card grid layout across all three Library resource types
- Better information density and visual scannability for skill browsing
- Zero SDK changes — purely a Console layout preference

## Impact

- **Users**: Skills page now matches the visual pattern of Agents and MCP Servers
- **SDK**: No changes — `ResourceListView` grid support was already complete
- **Architecture**: Correct layering — layout preference stays in `client-apps/web`, reusable component stays in `@stigmer/react`

## Related Work

- [Library Card Grid Layout](2026-04-13-171427-library-card-grid-layout.md) — original grid layout implementation in `ResourceListView`
- [Search Result Icon URL](2026-04-13-174629-search-result-icon-url.md) — added `iconUrl` to `SearchResult` proto for card icons
- [MCP Card Grid Fixes](2026-04-13-184556-mcp-card-grid-fixes.md) — grid layout polish for MCP Servers

---

**Status**: ✅ Production Ready
