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
- **Last Session**: 2026-05-17 — Implemented T05 (right-click context menus + DuplicateNodeCommand)
- **Active Task**: T05 completed, T06 next

## Session Progress (2026-05-17, Session 03)

### T05: Right-click Context Menu + DuplicateNodeCommand — COMPLETED

**What was accomplished:**
- Created `CanvasContextMenu.tsx` — context-sensitive right-click menu using `@base-ui/react/menu` with controlled state and virtual anchor positioning
- Node menu: Duplicate, Add task after…, Delete
- Edge menu: Insert task…, Delete connection
- Pane menu: Add task…, Select all, Auto-layout
- Added `DuplicateNodeCommand` to `graph-commands.ts` — deep-clones node config, offset position (+30,+30), no edge duplication
- Added `duplicateNode`, `addNodeAtPosition`, `selectAll` methods to `useWorkflowCanvas`
- Extended `CanvasActionsContext` with `duplicateNode`
- Implemented two-step menu-to-picker flow: menu closes → `TaskPickerPopover` opens at stored click coordinates via virtual anchor
- Wired into `WorkflowCanvasEditor` (context menu state, pending picker state, 9 action handlers) and `WorkflowCanvasInner` (3 event props passthrough)
- Exported from SDK barrel

**Key decisions:**
- `@base-ui/react/menu` (not `context-menu`) — React Flow handles hit detection via `onNodeContextMenu`/`onEdgeContextMenu`/`onPaneContextMenu`; controlled `Menu.Root` with virtual anchor avoids DOM wrapper conflicts
- Virtual anchor: `Menu.Positioner` receives a `VirtualElement` with `getBoundingClientRect()` returning click coordinates
- No edge duplication on duplicate — avoids ambiguous topology, matches n8n/Retool behavior
- Copy/Paste deferred to later task — clipboard requires serialization format, Ctrl+V, multi-node support
- `modal={false}` on `Menu.Root` — non-modal matches native context menu behavior
- Two-step picker flow via `pendingPicker` state — detached `HTMLButtonElement` with overridden `getBoundingClientRect` satisfies `React.RefObject<HTMLElement | null>` type

**Files modified (7 modified + 1 new, +716 lines):**
- `sdk/react/src/workflow/CanvasContextMenu.tsx` — NEW: context menu component (365 lines)
- `sdk/react/src/workflow/graph-commands.ts` — `DuplicateNodeCommand` (+53 lines)
- `sdk/react/src/workflow/useWorkflowCanvas.ts` — `duplicateNode`, `addNodeAtPosition`, `selectAll` (+68 lines)
- `sdk/react/src/workflow/CanvasActionsContext.ts` — added `duplicateNode` to interface
- `sdk/react/src/workflow/WorkflowCanvasEditor.tsx` — context menu orchestration (+212 lines)
- `sdk/react/src/workflow/WorkflowCanvasInner.tsx` — 3 event handler props (+9 lines)
- `sdk/react/src/workflow/index.ts` — exports
- `sdk/react/src/index.ts` — barrel exports

### Previous Sessions (same day)
- T01: On-Node Hover Actions (Delete + Quick-Add) — COMPLETED
- T02: TaskPicker Popover Component — COMPLETED
- T03: On-node "+" wired to TaskPicker — COMPLETED
- T04: Edge "+" opens TaskPicker — COMPLETED

## Next Steps

1. **T06: NodeToolbar on selection** — Composes all previous actions into a floating toolbar using `@xyflow/react`'s `<NodeToolbar>`.
2. **T07: Keyboard shortcuts** — Ctrl+D for duplicate, N-key to open command palette, Ctrl+A for select all.

## Context for Resume

- `CanvasContextMenu` is the context menu component. It receives a `target` (node/edge/pane) and `position` (screen coordinates), renders appropriate items, and calls action callbacks. Uses `@base-ui/react/menu` with virtual anchor positioning via `Menu.Positioner`.
- `TaskPickerPopover` is the shared picker used by node "+", edge "+", and the two-step context menu flow. It accepts `anchorRef: React.RefObject<HTMLElement | null>`.
- The two-step menu-to-picker flow uses `pendingPicker` state in `WorkflowCanvasEditor`. When a context menu item needs a picker (Insert task, Add task), it sets `pendingPicker = { purpose, sourceId?, position }`, which renders a `TaskPickerPopover` with a virtual anchor at the stored position.
- `DuplicateNodeCommand` uses `structuredClone(node.config)` for deep copy. It only clones the node — no edges. The clone gets a new name via `generateTaskName()` and is offset (+30, +30) from the source.
- `CanvasActionsContext` now has 4 actions: `insertTaskOnEdge`, `deleteNode`, `addSuccessorTask`, `duplicateNode`.
- React Flow's `onPaneContextMenu` has a wider type signature: `(event: MouseEvent | React.MouseEvent) => void`.
- `CATEGORY_DISPLAY_NAMES` and `CATEGORY_ORDER` live in `canvas-constants.ts`.
- The hover action pattern: `group` + `group-hover:` for CSS visibility. Popover open state keeps buttons visible (`hovered || selected || pickerOpen`).

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
6. [ ] Continue with the next task (T06: NodeToolbar on selection)

## Quick Commands

After loading context:
- "Continue with T06" - Start the NodeToolbar on selection
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
