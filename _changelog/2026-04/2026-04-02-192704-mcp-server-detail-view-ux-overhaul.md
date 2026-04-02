# MCP Server Detail View — Tabbed Capabilities UX Overhaul

**Date**: April 2, 2026

## Summary

Restructured the `McpServerDetailView` component in `@stigmer/react` from a flat stack of 8+ undifferentiated sections into a clean information hierarchy: compact metadata at the top, a tabbed capabilities panel for tools and policies below. Created a reusable accessible `Tabs` primitive as internal SDK infrastructure.

## Problem Statement

The `McpServerDetailView` rendered every piece of MCP server information as visually identical stacked sections — validation, header, discovery action, server config, tool list, resource templates, approval policies, generate action, env vars, and tags — all competing for attention with equal weight.

### Pain Points

- **Proximity violation (Gestalt):** The Discover button and the resulting tool list lived in separate sections. Users clicked "Discover" in one place, then had to scroll to see tools appear elsewhere.
- **Same for policies:** Existing approval policies were displayed separately from the "Generate Policies" action that creates them.
- **Cognitive overload (Miller's Law):** 8+ sections with no grouping forced users to scan every title to find what they needed.
- **No progressive disclosure:** Compact metadata (server type, URL, env vars) was interleaved with potentially long lists (20+ tools, 20+ policies), creating an unpredictable page height.

## Solution

Two-part restructuring:

1. **Tabbed Capabilities panel** — Merged the four scattered capability sections (Discovery, Tools, Approval Policies, Generate Policies) into a single `Tabs` container with co-located actions:
   - **Tools tab**: Discover/Re-discover button + credential form + tool list
   - **Policies tab**: Generate/Regenerate button + policy list + inline generator panel
   - **Resources tab**: Resource templates (tab hidden when empty)

2. **Context-first layout reorder** — Moved compact, stable metadata (Server Configuration, Environment Variables) above the capabilities panel so users orient themselves before scrolling into dynamic lists.

## Implementation Details

### New file: `sdk/react/src/internal/Tabs.tsx`

Accessible, themed Tabs primitive following the WAI-ARIA Tabs pattern:

- `role="tablist"` / `role="tab"` / `role="tabpanel"` with full `aria-selected`, `aria-controls`, `aria-labelledby` wiring
- Arrow-key navigation (Left/Right wrap-around), Home/End jump
- Badge count support on tab labels (e.g. "Tools 3", "Policies 2")
- Controlled component (`activeTab` + `onTabChange`)
- Themed exclusively via `--stgm-*` tokens — zero hardcoded colors
- Placed in `internal/` (not exported publicly) until the API stabilizes across use cases

### Modified file: `sdk/react/src/mcp-server/McpServerDetailView.tsx`

- Removed standalone `DiscoverySection`, `ToolsSection`, `ApprovalPoliciesSection`, `GenerateApprovalPoliciesSection`
- Created `ToolsTabContent` (merges discovery + tools) and `PoliciesTabContent` (merges policies + generation)
- `ResourceTemplatesList` renders inside a conditional third tab
- `useMemo` for dynamic tab array (conditional Resources tab based on data)
- Hook ordering corrected — all hooks called unconditionally before early returns
- `McpServerDetailViewProps` interface: **unchanged** (zero breaking changes)

### Final section order

```
ValidationBanner
Header
Server Configuration    ← compact identity/connection metadata
Environment Variables   ← compact credential/config metadata
Capabilities [Tools | Policies | Resources]  ← tabbed dynamic content
Tags                    ← metadata footer
```

## Benefits

- **Co-located actions and results:** Discover button and tool list are in the same tab. Generate button and policy list are in the same tab. No more scrolling between action and outcome.
- **Reduced cognitive load:** 8+ sections → 4 (Header, Config/Env, Capabilities, Tags). The tabbed panel uses badges for at-a-glance counts.
- **Context-first layout:** Server type, URL/command, and environment variables are visible on page load without scrolling past tool lists.
- **Reusable infrastructure:** The `Tabs` primitive is available for other SDK components (e.g. `ArtifactContentRenderer` could adopt it in a follow-up).
- **Zero breaking changes:** No changes to props, hooks, exports, or consumer code. The Console and docs site demos continue to work without modification.

## Impact

- **`@stigmer/react`** — Internal rendering overhaul of `McpServerDetailView`. All existing consumers (Console `McpServerDetailPage`, docs site `McpServerDetail` demo) work without changes.
- **Platform builders** — Embedding `<McpServerDetailView />` now provides a cleaner, more organized detail view out of the box.
- **SDK infrastructure** — New `Tabs` primitive available for internal reuse. Candidate for public API promotion after further stabilization.

## Related Work

- Documentation demo `McpServerDetailDemo.tsx` (site) — Already used co-located card layout; the SDK component now aligns with this pattern via tabs.
- `ArtifactContentRenderer.tsx` — Contains a local tab implementation that could migrate to the shared `Tabs` primitive in a follow-up.

---

**Status**: ✅ Production Ready
**Timeline**: Single session
