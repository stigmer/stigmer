# T15 Batch 2: Canvas Node Authoring — Task Palette, Connections, Undo/Redo

**Date**: May 13, 2026

## Summary

Turned the T15 Batch 1 read-only canvas into a full interactive authoring tool. Users can now drag task kinds from a categorized palette onto the canvas, draw transitions between tasks, delete nodes and edges with cascade, multi-select with lasso, and undo/redo all operations. Three new files and four modified files in `@stigmer/react`, with zero downstream breakage.

## Problem Statement

Batch 1 delivered a visual canvas that could render an existing workflow as interactive nodes and edges, but users could not create or modify the graph. The canvas was a viewer, not an editor. To complete the visual builder (Phase 2), users need to author workflow structure directly on the canvas.

### Pain Points

- No way to add new tasks visually — users had to write YAML and reload
- No way to connect tasks visually — transitions required editing `flow.then` in YAML
- No way to remove tasks or edges — deletion required YAML editing
- No undo/redo — accidental changes had no recovery path
- `human_input` nodes didn't render multi-port outcome handles (Batch 1 bug)
- `isDirty` flag used a ref that didn't trigger re-renders (Batch 1 bug)

## Solution

Implemented graph structure manipulation through a command/history pattern integrated into the existing `useWorkflowCanvas` hook, with a standalone task palette component and full React Flow interactivity wiring.

## Implementation Details

### New: Command/History Infrastructure (`graph-commands.ts`)

Pure TypeScript module with no React dependency:

- `GraphCommand` interface with `apply(model) -> model` and `undo(model) -> model`
- Six concrete commands: `AddNodeCommand`, `DeleteNodeCommand` (cascades connected edges), `AddEdgeCommand`, `DeleteEdgeCommand`, `MoveNodesCommand`, `CompoundCommand`
- `GraphHistory` class with bounded undo/redo stack (50 entries max)
- Factory helpers: `generateEdgeId`, `generateTaskName` (collision-avoiding `{kind}_{N}`), `createTaskNode`, `isSentinelNode`

### New: React History Hook (`useGraphHistory.ts`)

Thin React wrapper around `GraphHistory`:

- `useState` for reactivity on model changes
- Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z (redo)
- Focus-scoped via `containerRef` — shortcuts only active when the canvas container has focus, preventing conflicts with YAML editor or other inputs

### New: Task Palette (`WorkflowTaskPalette.tsx`)

Standalone SDK component following DD-001 and AD-T15-B2-005:

- Depends only on `useTaskKindRegistry()` — no canvas or React Flow dependency
- Categories: AI, Control Flow, Invocation, Data, Governance, Event
- Search input filtering by `displayName` and `description`
- Collapsible category sections with category-colored dot indicators
- HTML5 Drag and Drop with `application/stigmer-task-kind` MIME type
- Loading skeleton and error states with retry button
- All visuals via `--stgm-*` tokens, `.stgm` scoped

### Modified: Canvas Hook (`useWorkflowCanvas.ts`) — Major Rewrite

Architecture shift: `WorkflowGraphModel` managed by `useGraphHistory` is now the source of truth. React Flow nodes/edges are derived from the model after each mutation.

New capabilities:
- `onConnect` — validates and creates edges, with single-output replacement via `CompoundCommand`
- `isValidConnection` — AD-T15-B2-004 rules (no self-loops, no duplicates, sentinel restrictions)
- `onDrop`/`onDragOver` — palette drag-to-create with auto-naming and `__start__` auto-wiring
- `onNodesDelete`/`onEdgesDelete` — cascade deletion with compound undo
- `undo`/`redo`/`canUndo`/`canRedo` — exposed from history
- Model-based dirty tracking (reference equality, not position-only ref)

### Modified: Canvas Inner (`WorkflowCanvasInner.tsx`)

Wired all new React Flow props: `onConnect`, `isValidConnection`, `onDrop`, `onDragOver`, `onNodesDelete`, `onEdgesDelete`, `selectionMode: Partial`, `selectionOnDrag`, `multiSelectionKeyCode: "Shift"`, `panOnDrag: [1, 2]`, `deleteKeyCode: ["Backspace", "Delete"]`.

### Modified: Canvas Editor (`WorkflowCanvasEditor.tsx`)

- Task palette sidebar (left, toggleable via `showPalette` prop)
- Undo/Redo toolbar buttons with disabled states
- `containerRef` + `tabIndex={-1}` for keyboard shortcut scoping
- Empty state prompt: "Drag a task from the palette to get started"

### Modified: Task Node (`CanvasTaskNode.tsx`)

- Fixed `human_input` multi-port handles — now renders `outcome_*` handles matching edge inference
- Extracted `getMultiOutputHandles()` supporting both `switch_case` and `human_input`
- Fixed typo: `hasMulitpleOutputs` -> `hasMultipleOutputs`

### Minor: Conversions (`workflow-graph-conversions.ts`)

- Exported `categorizeKind`, `stringToTaskKind`, `taskKindToString` for use by graph commands
- Added `deletable: !isSentinel` to React Flow node output in `toReactFlowElements()`

## Benefits

- Users can visually author workflow DAGs without touching YAML
- Full undo/redo support prevents accidental data loss
- Palette provides discoverability — all 19 task kinds organized by category with search
- Command pattern enables future features (collaborative editing, operation logging) cheaply
- Standalone palette component is independently embeddable by platform builders

## Impact

- **SDK (`@stigmer/react`)**: 3 new files, 4 modified, 1 minor modification — all verified clean
- **Console apps**: No changes required (canvas editor component API is backward-compatible except for the new `containerRef` parameter on `useWorkflowCanvas`)
- **Platform builders**: New `WorkflowTaskPalette` component available for custom canvas integrations
- **Phase 2 progress**: Batch 2 of 5 complete — canvas is now a functional authoring tool

## Related Work

- T15 Batch 1 (Canvas Foundation) — the base this builds on
- T15 Batch 3 (Inspector + Edit Loop) — next batch, adds config editing and mode toggle
- T04 (Task Schema Registry) — provides the `useTaskKindRegistry` data for the palette

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes implementation)
