# Workflow Editor Dark Mode and UX Fixes

**Date**: May 16, 2026

## Summary

Fixed three interconnected usability issues in the visual workflow editor: invisible node boundaries in dark mode, undiscoverable add/remove step controls, and unreadable YAML syntax highlighting. The root cause was insufficient dark-mode adaptation across the `@stigmer/react` and `@stigmer/theme` SDK packages.

## Problem Statement

The workflow editor's visual canvas and code editor were effectively unusable in dark mode.

### Pain Points

- Node boxes (Start, step_1, End) had near-invisible borders (14% opacity white on dark background)
- The task palette sidebar blended into the background, making it impossible to discover drag-and-drop task creation
- Edges between nodes were invisible, making the graph structure unclear
- Canvas controls (zoom, minimap) were invisible
- YAML keys in the code editor used CodeMirror's default blue (#00f), nearly invisible on dark backgrounds
- No explicit "add step" or "delete step" buttons existed beyond keyboard shortcuts and invisible drag-and-drop

## Solution

Three-layer fix:
1. **New theme tokens** -- `--stgm-border-prominent` (30% opacity white in dark vs 14%) and named chart colors (`--stgm-chart-purple/blue/green/orange/yellow`) for category accents
2. **Canvas contrast overhaul** -- all node borders, edges, handles, palette items, toolbar buttons, and controls switched from `--stgm-border` to `--stgm-border-prominent` with `--stgm-card` backgrounds
3. **Syntax highlighting** -- replaced CodeMirror's `defaultHighlightStyle` with a custom `HighlightStyle` using `--stgm-syntax-*` CSS variables that adapt to light/dark mode

## Implementation Details

### Theme tokens (`sdk/theme/src/tokens.css`)
- Added `--stgm-chart-purple/blue/green/orange/yellow` for both light and dark modes
- Added `--stgm-border-prominent` (solid gray light, 30% white dark)
- Added `--stgm-syntax-*` tokens (property, string, number, bool, comment, keyword, atom, meta, tag) with distinct light/dark values

### Canvas node contrast (`CanvasTaskNode.tsx`)
- Task nodes: `border` -> `border-[var(--stgm-border-prominent)]`, `bg-background` -> `bg-card`
- Sentinel nodes (Start/End): `border` -> `border-2`, text uses `--stgm-foreground`
- All handles: use `--stgm-border-prominent` borders

### Edge visibility (`CanvasTransitionEdge.tsx`)
- Stroke: `--stgm-border` -> `--stgm-border-prominent`
- Width: 1.5 -> 2 (2.5 selected)
- Added "+" button on hover at edge midpoint for inserting new tasks

### Canvas background (`WorkflowCanvasInner.tsx`)
- Background dots: `--stgm-border` -> `--stgm-muted-foreground`
- Controls and minimap: use `--stgm-border-prominent` and `--stgm-card` backgrounds

### Task palette (`WorkflowTaskPalette.tsx`)
- All containers use `--stgm-border-prominent` and `--stgm-card`
- Palette items have visible borders by default (not just on hover)

### Add/remove affordances
- New `CanvasActionsContext` provides `insertTaskOnEdge` and `deleteNode`
- `useWorkflowCanvas.ts`: new `insertTaskOnEdge` method splits edge with new node + auto-layouts
- `WorkflowCanvasEditor.tsx`: wraps canvas with context provider
- `WorkflowInspectorPanel.tsx`: "Delete task" button when a node is selected

### YAML syntax highlighting (`WorkflowYamlEditor.tsx`)
- Custom `stigmerHighlightStyle` using `@lezer/highlight` tags
- Token colors use `var(--stgm-syntax-*)` CSS variables
- Added `@lezer/highlight` as a peer dependency

## Benefits

- Workflow editor is fully usable in dark mode
- Task palette is clearly visible and discoverable
- Users can insert tasks between existing steps via "+" button on edges
- Users can delete tasks via a visible button in the inspector panel
- YAML keys, strings, numbers, booleans, and comments are all clearly readable in both light and dark modes

## Impact

- **Users**: All users creating or editing workflows in dark mode
- **SDK consumers**: `@stigmer/react` and `@stigmer/theme` packages -- new CSS variables are additive (backward compatible with fallback values)

## Related Work

- T15 (Visual Canvas Editor) -- the original canvas implementation
- T10 (YAML Editor with Graph Preview) -- the original code editor

---

**Status**: Production Ready
