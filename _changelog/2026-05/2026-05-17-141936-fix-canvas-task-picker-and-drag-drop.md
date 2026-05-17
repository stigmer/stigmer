# Fix Canvas Task Picker and Palette Drag-Drop

**Date**: May 17, 2026

## Summary

Fixed two bugs in the workflow visual canvas editor: (1) selecting a task from the "+" button picker silently reverted the new node due to a stale closure in `requestAnimationFrame`, and (2) HTML5 drag-and-drop from the palette was completely blocked by Tauri v2's default native drag interception. Also corrected the drop position calculation to be viewport zoom/pan-aware.

## Problem Statement

After the T01–T06 canvas interaction UX work was completed, manual testing in the Tauri desktop app revealed that the core "add task" flows were broken:

### Pain Points

- Clicking the "+" button on a node, selecting a task kind from the picker, and seeing **nothing happen** — the new node briefly appeared then vanished
- Dragging tasks from the left palette onto the canvas had **zero effect** — no drag cursor change, no drop target highlight, no node creation
- The drop position calculation used a naive `getBoundingClientRect` subtraction that placed nodes at wrong positions when the canvas was zoomed or panned

## Solution

Three targeted fixes across two files, each following existing correct patterns already in the codebase.

## Implementation Details

### Fix 1: Stale closure in rAF (useWorkflowCanvas.ts)

Both `addSuccessorTask` and `insertTaskOnEdge` dispatched a graph command (correctly creating the new model) but then read `history.currentModel` inside a `requestAnimationFrame` callback. Since `history` was captured from the React render closure before dispatch flushed, the rAF applied dagre layout to the **old** model and reset the history to it — undoing the add.

The fix captures `dispatch()`'s return value into `const next` and passes it into the rAF. This matches the pattern already used correctly in the `onDrop` handler.

### Fix 2: Tauri native drag-drop interception (tauri.conf.json)

Tauri v2's `dragDropEnabled` defaults to `true`, which hooks into the native webview's drag-drop handling to expose OS file paths via `onDragDropEvent()`. As a side effect, all DOM `dragover` and `drop` events are suppressed. Setting `dragDropEnabled: false` on the window config restores HTML5 drag-and-drop.

### Fix 3: Viewport-aware drop positioning (useWorkflowCanvas.ts)

Replaced the manual `getBoundingClientRect` subtraction with React Flow's `screenToFlowPosition()`, which correctly accounts for the viewport transform (zoom level and pan offset).

## Benefits

- The "+" button flow (node hover, toolbar, edge midpoint) now works end-to-end — users can build workflows entirely from the canvas
- Palette drag-and-drop works in the Tauri desktop app (after Rust rebuild)
- Dropped nodes land at the correct position regardless of zoom/pan state

## Impact

- **SDK** (`@stigmer/react`): `useWorkflowCanvas` — affects all consumers of the canvas editor
- **Desktop app**: Tauri window configuration — requires Rust recompile to take effect
- **End users**: Both primary "add task" workflows (click picker + drag-from-palette) now function correctly

## Related Work

- T01–T06 canvas interaction UX (same project, same day)
- T15 Visual Canvas Editor foundation (parent project)

---

**Status**: Production Ready
**Timeline**: Single session (bug investigation + fix)
