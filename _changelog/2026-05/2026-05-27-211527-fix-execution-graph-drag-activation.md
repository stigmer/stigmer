# Fix: Execution Graph Drag Support Activation and Pan Behavior

**Date**: May 27, 2026

## Summary

Fixed the workflow execution graph drag feature that was implemented but never activated in consumer applications. Enabled `nodesDraggable` in both web and desktop execution detail pages, corrected the pan behavior to preserve left-click canvas panning, and fixed sentinel nodes incorrectly inheriting the draggable flag.

## Problem Statement

The drag support feature (added earlier today) was fully wired through the SDK layer but had three issues preventing it from working correctly in production:

### Pain Points

- `nodesDraggable` prop defaulted to `false` and was never set to `true` in either the web console or desktop app execution detail pages — the feature was effectively dead code
- `panOnDrag={[1, 2]}` removed the ability to left-click on empty canvas space to pan, forcing users to use middle/right mouse button — a significant UX regression
- Sentinel nodes (Start/End) did not explicitly set `draggable: false`, so they inherited the canvas-level `nodesDraggable={true}` and became draggable (contradicting the documented behavior)

## Solution

Three targeted fixes:

1. **Enable the feature** in both consumer pages by passing the `nodesDraggable` prop
2. **Restore natural pan behavior** by changing `panOnDrag` to `true` (matching the overview graph pattern — React Flow already distinguishes node-click from canvas-click)
3. **Lock sentinel nodes** by explicitly setting `draggable: false` when `nodesDraggable` is enabled

## Implementation Details

**Web console** (`client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx`): Added `nodesDraggable` prop to `<WorkflowExecutionViewer>`.

**Desktop app** (`client-apps/desktop/src/pages/workflow/WorkflowExecutionDetailPage.tsx`): Same addition.

**Graph component** (`sdk/react/src/workflow/WorkflowExecutionGraph.tsx`): Changed `panOnDrag={draggable ? [1, 2] : true}` to `panOnDrag={true}`. This preserves the standard UX: left-click on empty space pans, left-click on a node drags it.

**Data hook** (`sdk/react/src/workflow/useWorkflowExecutionGraph.ts`): Updated sentinel node handling to explicitly return `{ ...node, draggable: false }` when `nodesDraggable` is enabled, preventing Start/End nodes from being dragged.

## Benefits

- Drag feature now actually works in production (web and desktop)
- Canvas panning with left-click is preserved — no UX regression
- Sentinel nodes remain fixed as documented
- Consistent behavior with the overview graph's drag pattern

## Impact

- **End users**: Can now drag execution graph nodes during presentations and demos
- **UX**: Left-click on canvas still pans (no behavior change for non-node areas)
- **No breaking changes**: Feature was already opt-in at the SDK level

---

**Status**: Production Ready
**Timeline**: Single session (bug fix)
