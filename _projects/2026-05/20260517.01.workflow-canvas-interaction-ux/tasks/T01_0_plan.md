# Task T01: NodeToolbar with Delete & Duplicate on Selected Nodes

**Created**: 2026-05-17
**Status**: PENDING REVIEW
**Type**: Feature Development
**Estimated effort**: 1 session

> This plan requires your review before execution.

## Context

Deep research report: `_projects/2026-05/20260508.01.bring-workflows-to-foreground/research.visual-canvas-editor-ux/04.report.gpt.md`

The visual workflow canvas editor (`sdk/react/src/workflow/`) currently has no visible way to delete or duplicate nodes directly from the canvas. The only delete affordance is a "Delete task" button buried at the bottom of the inspector panel (requires scrolling). Both reports from the deep research identify **on-node action controls** as the highest-priority UX gap.

## Objective

Add a floating `<NodeToolbar>` (from `@xyflow/react`) to the `CanvasTaskNode` component that appears when a node is selected, providing Delete and Duplicate buttons. This is the smallest change with the biggest impact.

## What Changes

### File: `sdk/react/src/workflow/CanvasTaskNode.tsx`
- Import `NodeToolbar` from `@xyflow/react`
- Import `CanvasActionsContext` to access `deleteNode`
- Add a new `DuplicateNodeCommand` to `CanvasActionsContext` (or reuse existing patterns)
- Render `<NodeToolbar position={Position.Top}>` inside the task node component with:
  - **Delete button** (trash icon) — calls `canvasActions.deleteNode(nodeId)`
  - **Duplicate button** (copy icon) — calls a new `canvasActions.duplicateNode(nodeId)`
- Toolbar only appears when node is selected (React Flow handles this automatically)
- Do NOT show toolbar on sentinel nodes (Start/End)

### File: `sdk/react/src/workflow/CanvasActionsContext.ts`
- Add `duplicateNode: (nodeId: string) => void` to the `CanvasActions` interface

### File: `sdk/react/src/workflow/WorkflowCanvasEditor.tsx`
- Implement `handleDuplicateNode` — creates a copy of the node with offset position
- Add `duplicateNode` to the `canvasActions` useMemo

### File: `sdk/react/src/workflow/useWorkflowCanvas.ts`
- Add a `duplicateNode` method that:
  - Reads the node from the current model
  - Creates a new node with the same kind/config but a new generated name and offset position
  - Dispatches `AddNodeCommand` (no auto-connect — just places the duplicate nearby)

### File: `sdk/react/src/workflow/graph-commands.ts`
- No new command needed — `AddNodeCommand` already handles node creation

## Design Decisions

- **Position Top**: Toolbar renders above the node so it doesn't obscure content or overlap with output handles
- **No confirmation modal**: Delete relies on undo (Ctrl+Z) per research recommendation
- **CSS-only hover on toolbar buttons**: No React state for hover — pure CSS transitions
- **Sentinel guard**: `if (data.isSentinel) return null` for the toolbar — Start/End cannot be deleted or duplicated

## Acceptance Criteria

- [ ] Selecting a task node shows a floating toolbar above it with Delete and Duplicate icons
- [ ] Clicking Delete removes the node (goes through `DeleteNodeCommand` for undo/redo)
- [ ] Clicking Duplicate creates a copy of the node nearby (goes through `AddNodeCommand`)
- [ ] Sentinel nodes (Start/End) do NOT show the toolbar
- [ ] Toolbar does not scale with zoom (stays readable at all zoom levels)
- [ ] Toolbar buttons have tooltips and ARIA labels
- [ ] Existing keyboard Delete/Backspace still works
- [ ] Inspector panel "Delete task" button still works (not removed yet — secondary affordance)

## Out of Scope (handled in later tasks)

- Hover-show icons on nodes (T02)
- Right-click context menu (T03)
- Task picker for "+" on edges/nodes (T04)
- "+" button on node output handles (T05)
- Command palette / keyboard shortcut for quick-add (T06)

---

## Full Task Roadmap (T01–T06)

| Task | Title | Priority | Depends On |
|------|-------|----------|------------|
| **T01** | NodeToolbar with Delete & Duplicate on selection | Must-have | — |
| **T02** | Hover action icons on node cards (trash, "+") | Must-have | T01 |
| **T03** | Right-click context menu (node, edge, canvas) | Must-have | T01 |
| **T04** | Task-type picker popover for edge "+" insert | Must-have | T03 |
| **T05** | "+" button on node output handles (quick-add successor) | Must-have | T04 |
| **T06** | Command palette / keyboard shortcuts (N-key, Ctrl+D) | Nice-to-have | T01 |

### T02: Hover Action Icons on Node Cards
Show a small trash icon (and possibly "+") at the top-right of the node card on hover. Pure CSS visibility toggle (no React state). Clicking trash deletes; clicking "+" opens the task picker (from T04). This provides a faster path than selecting first.

### T03: Right-Click Context Menu
Implement `onNodeContextMenu`, `onEdgeContextMenu`, and `onPaneContextMenu` on the `<ReactFlow>` component. Create a shared `<CanvasContextMenu>` component that renders at the pointer position with context-sensitive items:
- **Node menu**: Delete, Duplicate, Copy, Rename, Configure (open inspector)
- **Edge menu**: Delete Connection, Insert Node (opens task picker)
- **Canvas menu**: Add Node (opens task picker), Paste, Select All, Auto-layout

### T04: Task-Type Picker Popover
Replace the hardcoded `agent_call` insert in `CanvasTransitionEdge`'s "+" button. Create a `<TaskPickerPopover>` component — a small, searchable list of task types (reusing data from `useTaskKindRegistry`). The popover anchors to the click position. Used by: edge "+", node "+", and context menu "Add Node" / "Insert Node".

### T05: "+" Button on Node Output Handles
Add a "+" icon near the bottom output handle of each node (visible on hover). Clicking it opens the `<TaskPickerPopover>` from T04. Selecting a task type creates a new node connected as a successor. Similar to n8n and Retool's "Add block" on output connectors.

### T06: Command Palette & Keyboard Shortcuts
Add Ctrl+D for duplicate, "N" key to open a command palette for quick node addition. Integrate `NodeSearch`-style component from @xyflow/react Pro or build a simple one using the task kind registry.

---

## Review Process

Please review and consider:
1. Does the task ordering make sense? (T01 first = smallest change, biggest impact)
2. Is the T01 scope right — just NodeToolbar with Delete + Duplicate?
3. Should T02 (hover icons) be merged with T01, or kept separate?
4. Any concerns about the Duplicate behavior (offset position, no auto-connect)?
5. Any task missing from the roadmap?
