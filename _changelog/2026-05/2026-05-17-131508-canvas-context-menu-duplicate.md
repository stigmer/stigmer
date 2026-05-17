# Canvas Right-click Context Menus and Node Duplication

**Date**: May 17, 2026

## Summary

Added right-click context menus to the visual workflow canvas editor and a `DuplicateNodeCommand` to the command/history system. Users can now right-click nodes, edges, and the canvas background to access contextual actions (delete, duplicate, insert task, auto-layout) without leaving the canvas — matching the interaction standards of production canvas editors like n8n, Retool, and ComfyUI.

## Problem Statement

The workflow canvas editor lacked standard right-click interactions. Users could only delete nodes via hover icons or the inspector panel, had no way to duplicate nodes, and couldn't trigger actions from the canvas background. This created unnecessary friction compared to the canvas editors users are familiar with.

### Pain Points

- No right-click context menu on any canvas element
- No node duplication capability at all (no command, no UI)
- No way to add a disconnected node at a specific position (only via palette drag or "+" buttons)
- No way to trigger Select All or Auto-layout from the canvas itself
- Missing "Insert Task" shortcut when right-clicking an edge

## Solution

Implemented a complete context menu system using `@base-ui/react/menu` in controlled mode with virtual anchor positioning, plus a `DuplicateNodeCommand` in the graph command/history pipeline. The context menu adapts its items based on what was right-clicked (node, edge, or pane), and integrates with the existing `TaskPickerPopover` for task-kind selection via a two-step flow.

## Implementation Details

### New Component: `CanvasContextMenu.tsx` (365 lines)

- Uses `@base-ui/react/menu` with `Menu.Root` in controlled mode (`open`/`onOpenChange`)
- Virtual anchor positioning: `Menu.Positioner` receives a `VirtualElement` with `getBoundingClientRect()` returning right-click coordinates
- Portaled via `useStigmerPortalContainer()` to inherit `--stgm-*` design tokens
- Three conditional menu variants:
  - **Node**: Duplicate, Add task after…, Delete
  - **Edge**: Insert task…, Delete connection
  - **Pane**: Add task…, Select all, Auto-layout
- Inline SVG icons (14x14) matching existing canvas icon style
- Destructive items (Delete) styled with `--stgm-destructive` token

### New Command: `DuplicateNodeCommand`

- Added to `graph-commands.ts` alongside existing `AddNodeCommand`, `DeleteNodeCommand`, etc.
- Deep-clones node config via `structuredClone(node.config)` — safe for nested `JsonObject` structures
- Generates unique name via existing `generateTaskName()` to avoid collisions
- Offsets position by (+30, +30) so the duplicate is visually adjacent
- Does not duplicate edges — consistent with n8n/Retool behavior where edge duplication would create ambiguous topology
- Fully reversible via undo (removes the cloned node)

### Hook Extensions: `useWorkflowCanvas`

Three new methods added to the canvas orchestrator hook:
- `duplicateNode(nodeId)` — dispatches `DuplicateNodeCommand`, selects the clone
- `addNodeAtPosition(kindString, position)` — creates a disconnected node at flow coordinates
- `selectAll()` — selects all non-sentinel nodes via React Flow's change API

### Two-step Menu-to-Picker Flow

When context menu items need a task-kind selection (Insert task, Add task after, Add task):
1. Menu item handler stores `pendingPicker = { purpose, sourceId?, position }` and closes the menu
2. `TaskPickerPopover` renders at the stored position using a virtual anchor (detached `HTMLButtonElement` with overridden `getBoundingClientRect`)
3. On kind selection, dispatches the appropriate action (`insertTaskOnEdge`, `addSuccessorTask`, or `addNodeAtPosition`)

### Editor Orchestration

`WorkflowCanvasEditor` gained context menu state management, 9 action handlers, and rendering of both `CanvasContextMenu` and the pending `TaskPickerPopover`. React Flow's `onNodeContextMenu`, `onEdgeContextMenu`, and `onPaneContextMenu` are passed through `WorkflowCanvasInner`.

## Benefits

- **Complete canvas interaction parity** with production editors (n8n, Retool, ComfyUI)
- **Node duplication** — common workflow pattern now has a one-click path
- **Consistent command/history integration** — all context menu actions go through `GraphCommand` dispatch, so undo/redo works for every action
- **SDK-first** — `CanvasContextMenu` is exported from `@stigmer/react` for platform builders
- **Accessible** — Base UI `Menu.Item` provides `role="menuitem"`, arrow key navigation, Enter/Space activation, Escape to close

## Impact

- **SDK**: `@stigmer/react` gains 3 new exports (`CanvasContextMenu`, `CanvasContextMenuProps`, `CanvasContextMenuTarget`) and the `CanvasActions` interface grows by 1 method (`duplicateNode`)
- **Users**: Workflow canvas editor now supports right-click context menus on all surfaces
- **Platform builders**: Context menu is embeddable — same component works in the Stigmer Console and third-party dashboards

## Related Work

- T01: On-node hover actions (delete + quick-add) — provided the `CanvasActionsContext` pattern
- T02: TaskPickerPopover — reused for the two-step picker flow
- T03/T04: Node/edge "+" wiring — established the popover anchor pattern
- Next: T06 (NodeToolbar on selection), T07 (Keyboard shortcuts)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~1 hour)
