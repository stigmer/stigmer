# Consolidate Demo List Views and Extract Shared Animation Primitive

**Date**: April 3, 2026

## Summary

Eliminated copy-paste duplication in the demo system by replacing `SkillsListView` and `McpServersListView` with a single parameterized `ResourceListPage` component and extracting the repeated pulse highlight animation into a shared `PulseHighlight` primitive. Net result: 202 lines of duplicated code replaced by 79 lines of reusable components.

## Problem Statement

The demo system had two nearly identical list view components — `SkillsListView` (107 lines) and `McpServersListView` (95 lines) — that differed by only five tokens: title, button label, cursor target, prop name, and fixture data. Additionally, the pulsing border animation used to draw the reader's eye was duplicated in five separate locations across the demo views.

### Pain Points

- Adding a new resource type demo (e.g. agents, workflows) required copy-pasting an entire view file and tweaking five strings.
- Changing the animation style (timing, color, border) required updating five separate inline `motion.span` blocks.
- The duplication obscured the fact that all list pages share the same structure: page header + create button + `ResourceListView` from the SDK.

## Solution

Two focused changes:

1. **`PulseHighlight`** — a shared animation component in `demos/shared/` that replaces all five inline instances of the pulsing border overlay.
2. **`ResourceListPage`** — a generic view component in `demos/views/` that accepts title, button label, cursor target, and items as props. Fixture data moves from the view into the scenario files, following the existing pattern set by `ComposerView`.

## Implementation Details

### New: `demos/shared/PulseHighlight.tsx`

Zero-prop component rendering a `motion.span` with the standardized pulse animation parameters (1.2s duration, infinite repeat, easeInOut). Placed alongside `tokens.ts` in the `shared/` directory.

### New: `demos/views/ResourceListPage.tsx`

Props interface:
- `title` — page heading ("Skills", "MCP Servers")
- `createLabel` — button text ("Create Skill", "Add MCP Server")
- `cursorTarget` — `data-cursor-target` for the animated cursor
- `items` — `readonly SearchResult[]` passed from the scenario
- `highlightCreate` — optional pulse on the create button
- `showNewItem` — optional flash highlight on the last list item

Uses `PulseHighlight` for the create button and a private `NewItemHighlight` helper for the list flash effect.

### Updated: Scenario files

Both `skill-creation-tour/index.tsx` and `mcp-server-creation-tour/index.tsx` now own their fixture data (previously embedded in the view) and pass it as `items` to `ResourceListPage`. This follows the data-ownership pattern already established by `ComposerView`.

### Updated: `AppShell.tsx` and `SettingsView.tsx`

Replaced inline pulse animations with `<PulseHighlight />`. Removed the now-unused `motion` import from `SettingsView.tsx`.

### Deleted

- `SkillsListView.tsx` (107 lines)
- `McpServersListView.tsx` (95 lines)

## Benefits

- **One place to add new resource type demos** — pass different props to `ResourceListPage` instead of duplicating a file.
- **One place to change the highlight animation** — update `PulseHighlight.tsx` and all five consumers update.
- **Net reduction of ~120 lines** — less code to read, less surface for inconsistency.
- **Consistent with existing patterns** — follows the same data-ownership model as `ComposerView` and the same shared-primitive model as `tokens.ts`.

## Impact

- Demo system maintainers benefit from reduced duplication.
- No visual change — rendered output is pixel-identical.
- No SDK changes — the SDK's `ResourceListView` remains correctly scoped as a composable list primitive.

## Related Work

- [Centralize demo styling tokens](2026-04-02-181623-centralize-demo-styling-tokens.md) — established the `demos/shared/` directory and the token-based approach this change extends.

---

**Status**: ✅ Production Ready
