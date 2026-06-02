# Execution Graph: Node Dragging and Spacing Improvements

**Date**: May 27, 2026

## Summary

Added optional node dragging to the workflow execution graph and increased default dagre layout spacing for execution views. Users can now manually reposition crowded nodes during demos and presentations, with a one-click "Reset layout" button to snap back to auto-layout. The execution graph also gets more generous default spacing (`ranksep: 80, nodesep: 50` vs the editor's `60, 30`) to accommodate status badges, duration chips, and fork-progress overlays.

## Problem Statement

The workflow execution graph auto-layout produced a dense, crowded visualization for complex workflows. Nodes with status overlays, duration chips, and fork-progress bars were packed too tightly, making the graph difficult to use when presenting to customers or discussing workflow behavior in meetings.

### Pain Points

- Execution graph nodes were hardcoded as non-draggable at both the canvas level (`nodesDraggable={false}`) and per-node level (`draggable: false`)
- The dagre layout used the same tight spacing (`ranksep: 60, nodesep: 30`) as the editor canvas, despite execution nodes carrying more visual overlays
- Users had no way to manually spread out nodes to create breathing room for presentations
- No precedent existed to reset manual repositioning back to auto-layout

## Solution

Mirrored the existing ephemeral-drag pattern from `WorkflowOverviewGraph` into `WorkflowExecutionGraph`, with two additions: a "Reset layout" pill button and a separate `EXECUTION_DAGRE_CONFIG` with more generous spacing. The feature is opt-in via a `nodesDraggable` prop (default `false`), preserving backward compatibility for all existing consumers.

## Implementation Details

**Layout spacing** (`canvas-constants.ts`): Added `EXECUTION_DAGRE_CONFIG` with `ranksep: 80, nodesep: 50` and a `DagreLayoutConfig` interface for type-safe custom configs.

**Layout function** (`apply-dagre-layout.ts`): Extended `applyDagreLayout` with an optional second parameter for custom dagre config, defaulting to the existing `DAGRE_CONFIG`. All existing callers are unaffected.

**Data hook** (`useWorkflowExecutionGraph.ts`): Added `nodesDraggable` option that controls per-node `draggable` flags. Sentinel nodes (Start/End) remain non-draggable regardless. Uses `EXECUTION_DAGRE_CONFIG` for layout.

**Graph component** (`WorkflowExecutionGraph.tsx`): Added full drag infrastructure — ephemeral `dragPositions` state, `onNodesChange` handler for position changes, display node merge, "Reset layout" pill button, and `panOnDrag={[1, 2]}` when draggable (middle/right mouse for panning, left-click for node dragging).

**Viewer passthrough** (`WorkflowExecutionViewer.tsx`): Added `nodesDraggable` to props and wires it through to the graph component.

**Tests**: Added 5 new unit tests covering custom dagre config behavior (default equivalence, execution config spread, custom ranksep) and draggable node flags (sentinel vs non-sentinel). Clarified E2E test description for the default non-draggable behavior.

## Benefits

- Users can manually reposition execution graph nodes for presentations without any UI clutter by default
- Execution graphs have more breathing room out of the box due to wider spacing
- Platform builders embedding `<WorkflowExecutionGraph>` get the same capability via an opt-in prop
- Zero behavior change for existing consumers (prop defaults to `false`)
- "Reset layout" button provides a clear escape hatch back to auto-layout

## Impact

- **SDK consumers**: New optional `nodesDraggable` prop on `WorkflowExecutionGraph` and `WorkflowExecutionViewer`
- **Platform builders**: Can enable drag for their embedded execution viewers
- **No breaking changes**: Default behavior unchanged, new prop is opt-in
- **Files changed**: 8 files modified across SDK and tests

## Related Work

- Follows the established ephemeral-drag pattern from `WorkflowOverviewGraph`
- Complements the existing visual editor drag infrastructure in `WorkflowCanvasInner`
- Adheres to DD-004 (zero framework deps in SDK) and DD-011 (opt-in behavior changes)

---

**Status**: Production Ready
**Timeline**: Single session
