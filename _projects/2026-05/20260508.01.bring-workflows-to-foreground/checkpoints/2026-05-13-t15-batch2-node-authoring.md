# Checkpoint: T15 Batch 2 — Node Authoring

**Date**: 2026-05-13
**Task**: T15 Batch 2 — Task Palette + Connections + Undo/Redo
**Status**: COMPLETE
**Scope**: React SDK (`@stigmer/react`) — 3 new files, 4 modified

## Accomplishments

Turned the Batch 1 read-only canvas into an interactive authoring tool. Users can
now create tasks via drag-and-drop from a categorized palette, draw transitions
between tasks, delete nodes/edges with cascade, multi-select with lasso, and
undo/redo all canvas operations.

## New Files (3)

### `sdk/react/src/workflow/graph-commands.ts`
- `GraphCommand` interface: `apply(model) -> model`, `undo(model) -> model`
- Concrete commands: `AddNodeCommand`, `DeleteNodeCommand` (cascade edges),
  `AddEdgeCommand`, `DeleteEdgeCommand`, `MoveNodesCommand`, `CompoundCommand`
- `GraphHistory` class: bounded undo/redo stack (50 entries), dispatch/undo/redo/reset
- Factory helpers: `generateEdgeId`, `generateTaskName`, `createTaskNode`, `isSentinelNode`

### `sdk/react/src/workflow/useGraphHistory.ts`
- React wrapper around `GraphHistory` with `useState` for reactivity
- Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z (redo)
- Focus-scoped via `containerRef` — only active when canvas has focus

### `sdk/react/src/workflow/WorkflowTaskPalette.tsx`
- Standalone SDK component (DD-001, AD-T15-B2-005)
- Uses `useTaskKindRegistry()` for data — no canvas/React Flow dependency
- Categorized sections (AI, Control Flow, Invocation, Data, Governance, Event)
- Search input filtering by displayName and description
- Collapsible category sections
- HTML5 Drag and Drop with `application/stigmer-task-kind` MIME type
- Loading skeleton and error states with retry
- All visuals via `--stgm-*` tokens

## Modified Files (4)

### `sdk/react/src/workflow/useWorkflowCanvas.ts` — Major rewrite
- Source of truth is now `WorkflowGraphModel` managed by `useGraphHistory`
- Structural mutations go through command/history pipeline
- React Flow elements derived from model after each mutation via `toReactFlowElements()`
- New methods: `onConnect`, `isValidConnection`, `onDrop`, `onDragOver`,
  `onNodesDelete`, `onEdgesDelete`, `undo`, `redo`, `canUndo`, `canRedo`
- Connection validation (AD-T15-B2-004): no self-loops, no duplicates,
  no connect-to-start, no connect-from-end
- Single-output nodes: edge replacement via CompoundCommand (undo restores old edge)
- Drop handler: reads palette drag data, auto-generates unique task names,
  auto-wires `__start__` -> first task on empty canvas
- Model-based dirty tracking (reference equality, not position-only ref)
- New signature: `useWorkflowCanvas(yaml, containerRef)` (breaking from Batch 1)

### `sdk/react/src/workflow/WorkflowCanvasInner.tsx`
- Wired: `onConnect`, `isValidConnection`, `onDrop`, `onDragOver`,
  `onNodesDelete`, `onEdgesDelete`
- Added: `selectionMode: Partial`, `multiSelectionKeyCode: "Shift"`,
  `panOnDrag: [1, 2]`, `selectionOnDrag`, `deleteKeyCode: ["Backspace", "Delete"]`

### `sdk/react/src/workflow/WorkflowCanvasEditor.tsx`
- Added `WorkflowTaskPalette` sidebar (left, with `showPalette` prop)
- Added `containerRef` for keyboard shortcut scoping
- Added `tabIndex={-1}` for focusability
- Toolbar: Undo/Redo buttons with disabled states, divider, Auto-layout
- Empty state prompt: "Drag a task from the palette to get started"
- All new callbacks plumbed from `useWorkflowCanvas` to `LazyCanvasInner`

### `sdk/react/src/workflow/CanvasTaskNode.tsx`
- Fixed: `human_input` nodes now render multi-port output handles per outcome
  (matching `outcome_*` sourceHandle edges from `yamlToGraph`)
- Extracted `getMultiOutputHandles()` — handles both `switch_case` and `human_input`
- Fixed typo: `hasMulitpleOutputs` -> `hasMultipleOutputs`

### `sdk/react/src/workflow/workflow-graph-conversions.ts` (minor)
- Exported `categorizeKind`, `stringToTaskKind`, `taskKindToString` (used by graph-commands)
- Added `deletable: !isSentinel` to React Flow node properties in `toReactFlowElements()`

## Architectural Decisions

- **AD-T15-B2-001**: Immutable graph model + command pattern. Commands hold
  `apply`/`undo` — history stores commands, not snapshots.
- **AD-T15-B2-002**: Auto-generated task names: `{kind}_{N}` with collision avoidance.
- **AD-T15-B2-003**: Sentinel lifecycle — `__start__` always present, `__end__` auto-managed.
- **AD-T15-B2-004**: Connection validation rules — no self-loops, no duplicates,
  single-output replacement, sentinel port restrictions.
- **AD-T15-B2-005**: Palette as standalone SDK component — zero canvas dependency.

## Bug Fixes (from Batch 1)

- `human_input` multi-port handles: `CanvasTaskNode` now renders `outcome_*` handles
  matching the edge inference in `yamlToGraph` (was only rendering for `switch_case`)
- `isDirty` reactive: replaced `useRef`-based position tracking with model reference
  comparison (ref changes don't trigger re-renders)
- Sentinel `deletable: false`: added to `toReactFlowElements` output

## Verification

- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files

## Next

- **T15 Batch 3**: Inspector + Edit Loop — schema-driven config forms,
  YAML/Canvas mode toggle, round-trip, save from canvas
