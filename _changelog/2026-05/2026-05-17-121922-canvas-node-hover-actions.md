# Canvas Node Hover Actions: Delete and Quick-Add

**Date**: May 17, 2026

## Summary

Added on-node hover action buttons (delete and quick-add "+") to the visual workflow canvas editor's task nodes. Users can now delete nodes and add successor tasks directly from the canvas by hovering over any task node, closing the two highest-priority UX gaps identified in the deep research report comparing n8n, Retool, and ComfyUI interaction patterns.

## Problem Statement

The workflow canvas editor had no on-node interaction affordances. The only way to delete a node was via the inspector panel's "Delete task" button (requires selecting the node, scrolling the panel) or the keyboard Delete key (requires knowing the shortcut). There was no way to quick-add a successor task from the canvas itself — users had to drag from the palette sidebar.

### Pain Points

- No visible delete affordance on node cards — users had to discover the inspector button or keyboard shortcut
- No quick-add mechanism on nodes — adding a successor required drag-from-palette, a multi-step flow
- The canvas felt passive compared to editors like n8n (hover-reveal trash/menu icons) and Retool (output handle "+" buttons)

## Solution

Added two CSS-only hover-reveal buttons to `CanvasTaskNode`:

1. **Delete button** (top-right corner): Trash icon that immediately deletes the node via `DeleteNodeCommand`. No confirmation modal — undo via Ctrl+Z.
2. **"+" button** (bottom center): Plus icon that creates a new `agent_call` successor task via a `CompoundCommand` (AddNode + AddEdge), with automatic dagre re-layout.

Both buttons are invisible at rest and fade in on hover using Tailwind's `group`/`group-hover:` CSS pattern — zero React state, zero re-renders per node.

## Implementation Details

**4 files changed, +105/-4 lines:**

- **`CanvasActionsContext.ts`**: Extended the `CanvasActions` interface with `addSuccessorTask(sourceNodeId, kindString)`
- **`CanvasTaskNode.tsx`**: Added `id` to destructured NodeProps, `useContext(CanvasActionsContext)`, two `useCallback` handlers, `group` class on the outer div, and two absolutely-positioned buttons with CSS-only hover visibility
- **`useWorkflowCanvas.ts`**: Implemented `addSuccessorTask` — creates a new node positioned below the source, connects via edge, dispatches as `CompoundCommand` for atomic undo, auto-selects the new node, triggers dagre re-layout via `requestAnimationFrame`
- **`WorkflowCanvasEditor.tsx`**: Wired `canvas.addSuccessorTask` into the `canvasActions` context provider

**Key pattern established**: CSS-only hover visibility via `group-hover:` prevents per-node React state changes when hovering. This scales to 50+ nodes without performance degradation. All future on-node UI affordances (context menu triggers, toolbar buttons) should follow this pattern.

## Benefits

- Users can delete nodes in one hover+click (down from select → scroll inspector → click button)
- Users can add successor tasks in one hover+click (down from open palette → find task type → drag → position → connect)
- Canvas interaction now matches the baseline expectations set by n8n, Retool, and ComfyUI
- Zero performance overhead — CSS-only visibility, no state management per node
- Full undo/redo support — both actions dispatch through the existing `GraphCommand` pipeline

## Impact

- **SDK component**: `@stigmer/react` `CanvasTaskNode` — affects all platform builders using the visual workflow editor
- **Accessibility**: Both buttons have `aria-label` and `title` attributes
- **Theme compliance**: All colors use `--stgm-*` CSS custom properties (destructive for delete hover, primary for "+" hover)
- **Foundation**: Establishes the hover interaction pattern that T02–T07 will build upon (task picker, context menu, toolbar, keyboard shortcuts)

## Related Work

- Research report: `_projects/2026-05/20260508.01.bring-workflows-to-foreground/research.visual-canvas-editor-ux/04.report.gpt.md`
- Project: `_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/`
- Next: T02 (TaskPicker popover to replace hardcoded `agent_call` on both node "+" and edge "+" buttons)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
