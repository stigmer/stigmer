# Next Task: 20260517.01.workflow-canvas-interaction-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260517.01.workflow-canvas-interaction-ux

**Description**: Add production-grade node interaction UX to the visual workflow canvas editor — on-node delete buttons, quick-add '+' buttons with task pickers, right-click context menus, and floating toolbars on selection.
**Goal**: Fix the fundamental UX gaps in the canvas editor so users can add, delete, duplicate, and manipulate nodes directly on the canvas, matching the interaction standards of editors like n8n, Retool, and ComfyUI.
**Tech Stack**: TypeScript/React, @xyflow/react v12, @stigmer/react SDK, @base-ui/react, Tailwind CSS, dagre
**Components**: sdk/react/src/workflow/ (CanvasTaskNode, CanvasTransitionEdge, TaskPickerPopover, CanvasContextMenu, WorkflowCanvasInner, WorkflowCanvasEditor, WorkflowInspectorPanel, useWorkflowCanvas, CanvasActionsContext)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-05-17 (Session 05) — Fixed stale-closure bug in task picker + Tauri drag-drop
- **Active Task**: Bug fixes completed, T07 next

## Session Progress (2026-05-17, Session 05)

### Bug Fix: Task picker selection does nothing — FIXED

**Root cause**: `addSuccessorTask` and `insertTaskOnEdge` in `useWorkflowCanvas.ts` used a stale `history.currentModel` inside their `requestAnimationFrame` callbacks. The dispatch correctly added the new node, but the rAF immediately reverted it by applying dagre layout to the pre-dispatch model captured in the closure.

**Fix**: Capture the `dispatch()` return value into `const next` and use it inside the rAF instead of the stale closure. This matches the correct pattern already used in the `onDrop` handler.

**Files modified:**
- `sdk/react/src/workflow/useWorkflowCanvas.ts` — fixed `addSuccessorTask` and `insertTaskOnEdge` (+4/-6 lines)

### Bug Fix: Palette drag-and-drop not working in Tauri desktop app — FIXED

**Root cause**: Tauri v2's default `dragDropEnabled: true` intercepts drag events at the native webview level, suppressing all DOM `dragover` and `drop` events. HTML5 drag-and-drop within the webview is completely blocked.

**Fix**: Added `"dragDropEnabled": false` to the window config in `tauri.conf.json`. Also replaced the naive `getBoundingClientRect` subtraction in `onDrop` with React Flow's `screenToFlowPosition` for correct zoom/pan-aware drop positioning.

**Files modified:**
- `client-apps/desktop/src-tauri/tauri.conf.json` — added `dragDropEnabled: false` (+1 line)
- `sdk/react/src/workflow/useWorkflowCanvas.ts` — replaced manual position math with `screenToFlowPosition` (-8/+4 lines)

### Previous Sessions (same day)
- Session 04: T06 — NodeToolbar on Selection + shared icon extraction — COMPLETED
- Session 01-03: T01–T05 — Hover actions, TaskPicker, edge "+", context menu, duplicate — COMPLETED

## Next Steps

1. **T07: Keyboard shortcuts** — Ctrl+D for duplicate, N-key to open command palette, Ctrl+A for select all.
2. **Copy/Paste** — Clipboard serialization format, Ctrl+C/Ctrl+V, multi-node support (deferred from T05).

## Context for Resume

- `addSuccessorTask` and `insertTaskOnEdge` now capture the `dispatch()` return value and pass it into the `requestAnimationFrame` callback — matching the pattern in `onDrop`. Do NOT re-read `history.currentModel` in rAF closures.
- Tauri's `dragDropEnabled` must be `false` for HTML5 DnD to work in the webview. The config change requires a full Tauri rebuild (Rust recompile), not just Vite HMR.
- `onDrop` now uses `screenToFlowPosition` from `useReactFlow()` for viewport-aware drop position calculation.
- `CanvasTaskNode` has two interaction layers: hover buttons (CSS `group-hover`) and `<NodeToolbar>` (visible on selection). They coexist.
- `canvas-icons.tsx` is the shared icon module for `TrashIcon`, `DuplicateIcon`, `PlusIcon`. Internal module, not in the SDK barrel.
- The picker anchor strategy uses a mutable `pickerAnchorRef` swapped before opening. One `TaskPickerPopover` instance serves both hover "+" and toolbar "Add Task After".
- `CanvasActionsContext` has 4 actions: `insertTaskOnEdge`, `deleteNode`, `addSuccessorTask`, `duplicateNode`.

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260517.01.workflow-canvas-interaction-ux/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the next task (T07: Keyboard shortcuts)

## Quick Commands

After loading context:
- "Continue with T07" - Start keyboard shortcuts
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
