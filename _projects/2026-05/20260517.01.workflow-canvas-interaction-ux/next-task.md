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
- **Last Session**: 2026-05-17 — Implemented T06 (NodeToolbar on selection + shared icon extraction)
- **Active Task**: T06 completed, T07 next

## Session Progress (2026-05-17, Session 04)

### T06: NodeToolbar on Selection — COMPLETED

**What was accomplished:**
- Added `<NodeToolbar>` from `@xyflow/react` to `CanvasTaskNode` — floating toolbar appears above selected nodes with Duplicate, Add Task After, and Delete actions
- Toolbar coexists with existing hover-revealed quick-action buttons (matching n8n/Retool conventions)
- Wired `duplicateNode` through `CanvasActionsContext` (was defined in context but never called from node)
- Implemented switchable picker anchor ref strategy — both hover "+" and toolbar "Add Task After" open the same `TaskPickerPopover`, anchored to whichever button triggered it
- Extracted shared SVG icons (`TrashIcon`, `DuplicateIcon`, `PlusIcon`) into `canvas-icons.tsx` to eliminate duplication across `CanvasContextMenu` and `CanvasTaskNode`
- Created `ToolbarButton` as a `forwardRef` component with proper `--stgm-*` token styling, 28x28 touch targets, destructive variant

**Key decisions:**
- Toolbar coexists with hover buttons (not replaces) — hover for quick surgical actions, toolbar for comprehensive selected-node actions
- `NodeToolbar` uses `Position.Top`, `offset={8}`, `align="center"` — positions cleanly above the node without overlapping the hover delete button
- Shared `pickerAnchorRef` (mutable ref swapped before opening) avoids two `TaskPickerPopover` instances
- `canvas-icons.tsx` is internal (not exported from SDK barrel) — implementation detail shared between canvas components
- `ToolbarButton` uses `forwardRef` to support ref forwarding for the picker anchor
- `role="toolbar"` + `aria-orientation="horizontal"` for proper WAI-ARIA keyboard navigation

**Files modified (2 modified + 1 new, +101/-35 lines):**
- `sdk/react/src/workflow/canvas-icons.tsx` — NEW: shared 14×14 inline SVG icons (TrashIcon, DuplicateIcon, PlusIcon)
- `sdk/react/src/workflow/CanvasTaskNode.tsx` — NodeToolbar, ToolbarButton, shared picker anchor, duplicate wiring (+90 lines)
- `sdk/react/src/workflow/CanvasContextMenu.tsx` — replaced 3 inline icon defs with imports from canvas-icons.tsx (-28 lines)

### Previous Sessions (same day)
- T01: On-Node Hover Actions (Delete + Quick-Add) — COMPLETED
- T02: TaskPicker Popover Component — COMPLETED
- T03: On-node "+" wired to TaskPicker — COMPLETED
- T04: Edge "+" opens TaskPicker — COMPLETED
- T05: Right-click Context Menu + DuplicateNodeCommand — COMPLETED

## Next Steps

1. **T07: Keyboard shortcuts** — Ctrl+D for duplicate, N-key to open command palette, Ctrl+A for select all.
2. **Copy/Paste** — Clipboard serialization format, Ctrl+C/Ctrl+V, multi-node support (deferred from T05).

## Context for Resume

- `CanvasTaskNode` now has two interaction layers: hover buttons (CSS `group-hover`) and a `<NodeToolbar>` (React Flow managed, visible on selection). They coexist.
- `canvas-icons.tsx` is the shared icon module for `TrashIcon`, `DuplicateIcon`, `PlusIcon` — used by both `CanvasContextMenu` and `CanvasTaskNode`. Internal module, not in the SDK barrel.
- `ToolbarButton` is a `forwardRef` component inside `CanvasTaskNode.tsx` — styled with `--stgm-*` tokens, 28x28 touch targets, has a `destructive` variant for the delete button.
- The picker anchor strategy uses a mutable `pickerAnchorRef` that gets swapped to point at whichever button (hover "+" or toolbar "Add Task After") triggered the picker. One `TaskPickerPopover` instance serves both entry points.
- `CanvasActionsContext` has 4 actions: `insertTaskOnEdge`, `deleteNode`, `addSuccessorTask`, `duplicateNode`. All are now wired in `CanvasTaskNode`.
- `CanvasContextMenu` imports shared icons from `canvas-icons.tsx`; `SelectAllIcon` and `LayoutIcon` remain local to the context menu.
- `CATEGORY_DISPLAY_NAMES` and `CATEGORY_ORDER` live in `canvas-constants.ts`.
- React Flow's `NodeToolbar` auto-hides when multiple nodes are selected (correct default; multi-select toolbar is a future task).

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
