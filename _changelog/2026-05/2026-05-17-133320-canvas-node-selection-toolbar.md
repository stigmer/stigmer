# Canvas Node Selection Toolbar

**Date**: May 17, 2026

## Summary

Added a floating selection toolbar to workflow canvas task nodes using React Flow's `<NodeToolbar>` component. When a user clicks a node, a toolbar appears above it with Duplicate, Add Task After, and Delete actions — completing the node interaction UX alongside the existing hover buttons and right-click context menu.

## Problem Statement

The workflow canvas editor had hover-revealed action buttons (delete, add successor) and a right-click context menu, but no visible action surface for selected nodes. Users who clicked a node to select it had no discoverable way to perform common actions without either hovering or right-clicking — both of which require knowing the affordance exists.

### Pain Points

- Selected nodes had no visible action UI — only the selection ring indicated state
- Duplicate action was only accessible via right-click context menu
- No consistent "toolbar on selection" pattern matching industry-standard editors (n8n, Retool, ComfyUI)

## Solution

Added `<NodeToolbar>` from `@xyflow/react` v12 inside `CanvasTaskNode`, rendering a themed toolbar with three actions (Duplicate, Add Task After, Delete) that auto-shows on selection and auto-hides on deselection. The toolbar coexists with hover buttons — two complementary interaction layers.

## Implementation Details

- **NodeToolbar**: `Position.Top`, `offset={8}`, `align="center"` — floats above the node, does not scale with viewport zoom
- **ToolbarButton**: `forwardRef` component with 28x28 touch targets, `--stgm-*` token styling, destructive variant for delete
- **Shared picker anchor**: mutable `pickerAnchorRef` swapped to point at whichever button (hover "+" or toolbar "Add Task After") triggered the `TaskPickerPopover` — avoids duplicate popover instances
- **Icon deduplication**: extracted `TrashIcon`, `DuplicateIcon`, `PlusIcon` into `canvas-icons.tsx` (internal module) to eliminate copies across `CanvasContextMenu` and `CanvasTaskNode`
- **Accessibility**: `role="toolbar"`, `aria-orientation="horizontal"`, contextual `aria-label` per button (e.g., "Duplicate task fetch_data")

## Benefits

- Selected nodes now have a discoverable, always-visible action surface
- Duplicate action accessible from three surfaces: toolbar, context menu, and (future) Ctrl+D
- Icon consistency guaranteed by single shared module
- Zero performance cost for unselected nodes — React Flow only renders the toolbar when `selected` is true

## Impact

- **SDK**: `@stigmer/react` — `CanvasTaskNode` enhanced, no public API changes
- **Console + embeddable**: toolbar appears automatically for all consumers of `WorkflowCanvasEditor`
- **Files**: 2 modified + 1 new, +101/-35 lines net

---

**Status**: ✅ Production Ready
