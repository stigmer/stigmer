# T15 Batch 5: Integration + Polish — Console Wiring, Barrel Exports, and Accessibility

**Date**: May 13, 2026

## Summary

Final integration batch for the T15 Visual Canvas Editor. Wired the canvas editor into both web and desktop consoles via `@xyflow/react` peer dependency installation, exported all T15 public API surface from the SDK barrel, fixed five issues discovered during pre-implementation research (canvasDirty wiring gap, nodeErrors rendering gap, missing React Flow CSS, unused imports, escalation task stub), added drag-handle reordering to case/outcome lists (deferred from Batch 4), and completed an accessibility pass across all canvas components.

## Problem Statement

T15 Batches 1-4 built the complete visual canvas editor in `@stigmer/react` — graph model, React Flow integration, node authoring, schema-driven inspector, and specialized builders for `switch_case` and `human_input`. However, none of this was consumable by the actual console applications or by platform builders.

### Pain Points

- Neither web nor desktop had `@xyflow/react` installed — the canvas would fail to load at runtime
- No barrel exports — platform builders couldn't import any T15 component or hook from `@stigmer/react`
- `canvasDirty` state was declared but never set — users silently lost unsaved changes when switching from visual to code mode
- `nodeErrors` prop was accepted by `WorkflowCanvasEditor` but never threaded to `CanvasTaskNode` — validation errors were invisible on the canvas
- React Flow's base CSS was not imported anywhere — handles, controls, and minimap lacked proper styling
- Escalation task `<select>` in `ApprovalFormBuilder` was a non-functional stub
- Case/outcome lists only had up/down arrow buttons — drag-handle reordering was committed for Batch 5 during Batch 4 planning
- Palette items had `role="option"` without a `role="listbox"` parent — ARIA violation

## Solution

Systematic integration pass addressing all gaps: dependency installation, CSS loading, bug fixes, barrel exports, drag-handle reordering, and accessibility hardening. No new behavioral features — purely making the existing T15 work production-ready and consumable.

## Implementation Details

### Console Integration (DD-016)
Added `@xyflow/react: ^12.10.2` to `dependencies` in both `client-apps/web/package.json` and `client-apps/desktop/package.json`. Added `import "@xyflow/react/dist/style.css"` at the lazy-load boundary (`WorkflowCanvasInner.tsx`) per DD-013 — CSS only loads when the canvas mounts. Both apps already wire `WorkflowEditorView` identically (DD-016 confirmed), so the mode toggle and canvas editor work automatically in both.

### canvasDirty Wiring Fix
Added `onDirtyChange?: (dirty: boolean) => void` callback prop to `WorkflowCanvasEditorProps`. A `useEffect` fires `onDirtyChange(canvas.isDirty)` whenever dirty state changes. `WorkflowEditorView` passes `onDirtyChange={setCanvasDirty}`, enabling the existing "Discard & Switch" prompt dialog and "Unsaved changes" indicator.

### nodeErrors Rendering
Extended `CanvasTaskNodeData` with `errorCount?: number`. `WorkflowCanvasInner` enriches node data from the `nodeErrors` map via `useMemo`. `CanvasTaskNode` renders a red count badge (positioned at top-right) and a red border when `errorCount > 0`, with a descriptive `title` attribute.

### Barrel Exports
Added 58 lines to `sdk/react/src/workflow/index.ts`: types (`WorkflowGraphModel`, `WorkflowGraphNode`, `WorkflowGraphEdge`, etc.), hook (`useWorkflowCanvas`), components (`WorkflowCanvasEditor`, `WorkflowTaskPalette`, `WorkflowInspectorPanel`, `TaskConfigForm`, `BranchConditionBuilder`, `ApprovalFormBuilder`), functions (`yamlToGraph`, `graphToYaml`, `graphToWorkflowInput`), and constants (`START_NODE_ID`, `END_NODE_ID`). Added 27 lines of top-level re-exports to `sdk/react/src/index.ts`.

### Drag-Handle Reordering (Deferred from Batch 4)
Added 6-dot grip handles to case rows in `BranchConditionBuilder` and outcome rows in `ApprovalFormBuilder`. Uses HTML5 DnD (`draggable`, `onDragStart`, `onDragOver`, `onDrop`) with local `dragIdx`/`dropIdx` state. Drop target highlighted with primary-color border. Coexists with existing up/down arrow buttons (keyboard-accessible alternative).

### Accessibility Pass
- Palette: Added `role="listbox"` parent for `role="option"` items
- Canvas: Added `aria-live="polite"` region announcing selection changes for screen readers
- Node: Added `aria-label` with task name, kind, and error count
- Escalation: Wired the stub `<select>` to `onUpdateConfig("escalation_task", value)` with proper `escalationTask` value binding

### Cleanup
Removed unused `DeleteEdgeCommand` import from `WorkflowCanvasEditor.tsx` and unused `graphToYaml` import from `WorkflowEditorView.tsx`.

## Benefits

- Visual canvas editor is now fully functional in both web and desktop consoles
- Platform builders can import all canvas components and hooks from `@stigmer/react`
- Users no longer silently lose unsaved canvas changes when switching modes
- Validation errors are visible directly on canvas nodes
- Case/outcome lists support both drag and keyboard reordering
- Screen reader users get announcements for canvas selection changes

## Impact

- **SDK React**: 12 files modified (~300 lines added)
- **Phase 2 Visual Builder**: COMPLETE. All 5 batches delivered.
- **Platform builders**: Full T15 public API surface available from `@stigmer/react`
- **Console parity**: Web and desktop both have identical canvas editor behavior (DD-016)

## Related Work

- T15 Batch 1: Canvas Foundation
- T15 Batch 2: Node Authoring
- T15 Batch 3: Inspector + Edit Loop
- T15 Batch 4: Specialized Task Editors
- T16 (next): Natural Language to Workflow (Phase 3)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
