# ScopeToggle Redesigned as Segmented Control

**Date**: May 12, 2026

## Summary

Replaced the "Include public" checkbox with a modern segmented control (pill toggle) that makes both scope states — "Org" and "All" — explicitly labeled and immediately recognizable. This brings the scope selector into visual and interaction parity with the existing `VisibilityToggle` and `ViewSwitcher` components.

## Problem Statement

The Library list pages and resource pickers (Agents, Skills, MCP Servers) used a native HTML checkbox labeled "Include public" to control whether results include community/public resources.

### Pain Points

- The "off" state (org-only) was unlabeled and invisible — users had to decode what unchecked means.
- A bare checkbox clashed with the polished dark-themed design system used everywhere else.
- The adjacent `ViewSwitcher` (table/cards/list) already uses a segmented button group, creating inconsistency within the same toolbar row.
- In picker popovers (session composer), the checkbox appeared as an afterthought below the search input.

## Solution

Rewrote `ScopeToggle` as a WAI-ARIA Radio Group with two pill buttons: a building icon with "Org" label and a globe icon with "All" label. The active segment is highlighted with `bg-background text-foreground shadow-sm`, making the current state immediately obvious.

## Implementation Details

**Single file changed**: `sdk/react/src/library/ScopeToggle.tsx`

- `role="radiogroup"` container with `role="radio"` buttons
- Roving `tabIndex` (active = 0, inactive = -1) with arrow-key navigation
- Inline SVG icons: building (org scope), globe (all scope)
- Neutral active-state styling (non-semantic, unlike the amber/green of `VisibilityToggle`)
- New optional `compact` prop for icon-only rendering in constrained picker popovers
- Container uses `bg-muted rounded-md p-0.5` matching `VisibilityToggle`

**No breaking changes**: The component name, export path, and `value`/`onChange`/`disabled` prop contract remain identical. All 7 consumer files (ResourceWorkbench, AgentPicker, SkillPicker, McpServerPicker, library/index.ts, sdk/react/src/index.ts) work without modification.

## Benefits

- Both states are self-documenting — no decoding required
- Visual consistency with `ViewSwitcher` and `VisibilityToggle` in the same surfaces
- Full keyboard accessibility (arrow keys, roving tabindex, focus ring)
- The `compact` prop enables platform builders to use icon-only mode in tight layouts
- Screen reader announces "Resource scope" group with "Organization only" / "All including public" labels

## Impact

- **Direct users**: Library list pages (MCP Servers, Agents, Skills) and session composer pickers across web and desktop apps
- **Platform builders**: Anyone using `<ScopeToggle>` from `@stigmer/react` gets the upgraded control automatically
- **Accessibility**: Improved from a generic checkbox to a proper radio group with explicit state labeling

## Related Work

- `VisibilityToggle` (same directory) — the design reference for this segmented control pattern
- `ViewSwitcher` (resource-workbench) — adjacent toolbar control that already used segmented buttons
- ResourceWorkbench scope filtering — the data flow that this control drives

---

**Status**: Production Ready
