# Workflow Visual Editor: Full-Canvas Layout and Drag-and-Drop Fix

**Date**: May 17, 2026

## Summary

Fixed drag-and-drop from the task palette onto an empty canvas and redesigned the workflow visual editor to use a full-viewport layout, replacing the `max-w-4xl` (896px) constraint that left only 376px of usable canvas space. Also fixed a Babel parse error in `SessionComposer` caused by `memo(forwardRef<...>(...))` inline nesting.

## Problem Statement

The workflow visual editor had three issues preventing usable operation:

### Pain Points

- Dragging a task from the palette onto an empty canvas did nothing — the drop target (`<ReactFlow>`) was never rendered when `canvas.graph` was null, so `onDrop`/`onDragOver` had no element to attach to.
- The canvas was squeezed inside `LibraryLayout`'s `max-w-4xl` (896px). After the palette (240px) and inspector (280px), only 376px remained for the actual canvas — far too narrow for spatial editing.
- The existing workflow detail page editor tab used a fixed `h-[600px]` height, wasting vertical space.
- A pre-existing `memo(forwardRef<H, P>(...))` syntax in `SessionComposer.tsx` caused a Babel JSX parse ambiguity, preventing the Vite dev server from starting.

## Solution

### Drag-and-Drop Fix (SDK layer)

Restructured `WorkflowCanvasEditor` so the `<ReactFlow>` canvas is always rendered — even when the graph is empty — providing a valid HTML5 drop target at all times. Added an empty-state overlay ("Drag a task from the palette to get started") as a `pointer-events-none` layer on top of the canvas.

Updated `useWorkflowCanvas.onDrop` to handle the first-drop-on-empty-canvas case: it bootstraps a new graph model with `__start__` and `__end__` sentinel nodes, adds the dropped task wired from `__start__`, and triggers a Dagre auto-layout pass.

### Full-Viewport Layout (Client layer)

Created a `FullViewportLayoutProvider` context and `useRequestFullViewport` declarative hook. When the workflow visual editor is active, it signals `LibraryLayout` to replace `max-w-4xl px-6 py-8` with `flex h-full flex-col`, giving the canvas the full viewport width minus the app sidebar.

The editor page renders its own back-navigation toolbar, and the `WorkflowEditorView` fills the remaining space with flex-based height distribution.

### Collapsible Palette (SDK layer)

Added a `PaletteToggle` button that lets users collapse the task palette to reclaim canvas space. The toggle is positioned at the canvas edge and uses a clear open/close icon pattern.

### SessionComposer Parse Fix (SDK layer)

Separated `memo(forwardRef<H, P>(...))` into a two-step pattern: `const Inner = forwardRef<H, P>(...)` then `export const SessionComposer = memo(Inner)`. This resolves the Babel ambiguity where `<SessionComposerHandle` was misinterpreted as a JSX opening tag.

## Implementation Details

| File | Change |
|------|--------|
| `sdk/react/src/workflow/WorkflowCanvasEditor.tsx` | Always render `<ReactFlow>` as drop target; collapsible palette; conditional toolbar/inspector |
| `sdk/react/src/workflow/useWorkflowCanvas.ts` | Bootstrap empty graph model on first drop; `JsonObject` import |
| `sdk/react/src/composer/SessionComposer.tsx` | Separate `forwardRef` from `memo` to fix Babel parse error |
| `client-apps/web/src/domain/library/full-viewport-layout.tsx` | New `FullViewportLayoutProvider` context |
| `client-apps/web/src/domain/library/LibraryLayout.tsx` | Conditional full-width layout based on context |
| `client-apps/web/src/domain/workflow/WorkflowNewPage.tsx` | Request full-viewport when visual editor active |
| `client-apps/web/src/domain/workflow/WorkflowDetailPage.tsx` | `h-[600px]` → `h-[calc(100vh-16rem)]` for editor tab |
| `client-apps/desktop/src/pages/library/full-viewport-layout.tsx` | Desktop parity — same context provider |
| `client-apps/desktop/src/pages/library/LibraryLayout.tsx` | Desktop parity — conditional layout |
| `client-apps/desktop/src/pages/workflow/WorkflowNewPage.tsx` | Desktop parity — full-viewport signal |
| `client-apps/desktop/src/pages/workflow/WorkflowDetailPage.tsx` | Desktop parity — viewport-relative height |

## Benefits

- Drag-and-drop now works on empty canvases — users can start building workflows immediately
- Canvas area increases from ~376px to ~680-1080px depending on viewport width
- Palette is collapsible for maximum canvas space
- Editor tab uses available viewport height instead of a fixed 600px
- DD-016 (client app parity) maintained — identical changes across web and desktop
- Vite dev server no longer crashes on `SessionComposer.tsx` parse error

## Impact

- **Direct users**: Workflow authoring via the visual editor is now functional and spatially usable
- **Platform builders**: `WorkflowCanvasEditor` and `WorkflowEditorView` SDK components work correctly in both full-viewport and constrained embedded contexts
- **Developer experience**: Dev server starts cleanly without the Babel parse error

## Related Work

- T15 Batch 1-5: Visual Canvas Editor foundation
- DD-013: React.lazy for optional heavy dependencies
- DD-016: Client app parity

---

**Status**: ✅ Production Ready
