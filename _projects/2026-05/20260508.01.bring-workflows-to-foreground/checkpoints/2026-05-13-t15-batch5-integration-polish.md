# Checkpoint: T15 Batch 5 — Integration + Polish

**Date**: 2026-05-13
**Task**: T15 Batch 5 — Console wiring, barrel exports, a11y, drag reorder, bug fixes
**Status**: COMPLETE
**Scope**: React SDK (`@stigmer/react`) + client-apps (web, desktop) — 0 new files, 12 modified

## Accomplishments

Final integration batch completing Phase 2 (Visual Builder). Wired the canvas
editor into both console apps, exported the full T15 public API surface, fixed
five issues discovered during pre-implementation research, added drag-handle
reordering (deferred from Batch 4), and completed an accessibility pass.

## Modified Files (12)

### `client-apps/web/package.json`
- Added `@xyflow/react: ^12.10.2` to dependencies

### `client-apps/desktop/package.json`
- Added `@xyflow/react: ^12.10.2` to dependencies

### `sdk/react/src/workflow/WorkflowCanvasInner.tsx`
- Added `import "@xyflow/react/dist/style.css"` (missing CSS fix)
- Accept `nodeErrors` prop, enrich node data via `useMemo`

### `sdk/react/src/workflow/WorkflowCanvasEditor.tsx`
- Added `onDirtyChange` callback prop (canvasDirty fix)
- Added `useEffect` to fire `onDirtyChange` on dirty state changes
- Pass `nodeErrors` to `WorkflowCanvasInner`
- Added `aria-live="polite"` selection announcement region
- Removed unused `DeleteEdgeCommand` import

### `sdk/react/src/workflow/WorkflowEditorView.tsx`
- Pass `onDirtyChange={setCanvasDirty}` to canvas editor
- Removed unused `graphToYaml` import

### `sdk/react/src/workflow/CanvasTaskNode.tsx`
- Added red error-count badge when `data.errorCount > 0`
- Added red border for nodes with errors
- Added `aria-label` with task name, kind, and error info

### `sdk/react/src/workflow/workflow-graph-conversions.ts`
- Extended `CanvasTaskNodeData` with `errorCount?: number`

### `sdk/react/src/workflow/BranchConditionBuilder.tsx`
- Added drag grip handle (6-dot icon) with HTML5 DnD reordering
- Local drag state (`dragIdx`/`dropIdx`), drop target highlight

### `sdk/react/src/workflow/ApprovalFormBuilder.tsx`
- Added drag grip handle to outcome rows (same pattern)
- Wired escalation task `<select>` to `onUpdateConfig("escalation_task", ...)`
- Added `escalationTask` prop to `TimeoutSection`

### `sdk/react/src/workflow/WorkflowTaskPalette.tsx`
- Added `role="listbox"` to category items container

### `sdk/react/src/workflow/index.ts`
- Barrel exports: 6 graph types, 1 hook, 6 components + props, 3 functions, 2 constants

### `sdk/react/src/index.ts`
- Top-level re-exports for all new T15 public surface

## Verification

- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files
- DD-016 parity: web and desktop wire `WorkflowEditorView` identically

## Next

- **T16**: Natural Language to Workflow (Phase 3)
- **Chart visualizations**: recharts/visx for Cost by Workflow chart
- **Workflow execution → session navigation fix**: web routing mismatch
