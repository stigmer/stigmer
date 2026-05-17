# Next Task: 20260517.01.workflow-canvas-interaction-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260517.01.workflow-canvas-interaction-ux

**Description**: Add production-grade node interaction UX to the visual workflow canvas editor — on-node delete buttons, quick-add '+' buttons with task pickers, right-click context menus, and floating toolbars on selection.
**Goal**: Fix the fundamental UX gaps in the canvas editor so users can add, delete, duplicate, and manipulate nodes directly on the canvas, matching the interaction standards of editors like n8n, Retool, and ComfyUI.
**Tech Stack**: TypeScript/React, @xyflow/react v12, @stigmer/react SDK, @base-ui/react, Tailwind CSS, dagre
**Components**: sdk/react/src/workflow/ (CanvasTaskNode, CanvasTransitionEdge, TaskPickerPopover, WorkflowCanvasInner, WorkflowCanvasEditor, WorkflowInspectorPanel, useWorkflowCanvas, CanvasActionsContext)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-05-17 — Implemented T01 (on-node hover actions) + T02 (TaskPicker popover) + T03/T04 (wired node/edge "+" to picker)
- **Active Task**: T02–T04 completed, T05 next

## Session Progress (2026-05-17)

### T01: On-Node Hover Actions (Delete + Quick-Add) — COMPLETED (prior session)

**What was accomplished:**
- Added CSS-only hover-reveal delete (trash) icon button on `CanvasTaskNode`
- Added CSS-only hover-reveal "+" quick-add button on `CanvasTaskNode` (bottom center)
- Implemented `addSuccessorTask` method in `useWorkflowCanvas` (creates node + edge via CompoundCommand)
- Extended `CanvasActionsContext` with `addSuccessorTask` method
- Wired everything through `WorkflowCanvasEditor`

### T02: TaskPicker Popover Component — COMPLETED

**What was accomplished:**
- Created `TaskPickerPopover.tsx` — searchable, categorized task kind picker
- Uses `@base-ui/react/popover` (first use of this peer dependency in the SDK)
- Uses `useStigmerPortalContainer()` for portal container (matches `ContextPopover` and `ModelSelector` patterns)
- Searchable via `<input type="search">` with same filter logic as `WorkflowTaskPalette`
- Category grouping with `CATEGORY_COLORS` color dots, `CATEGORY_DISPLAY_NAMES` section headers
- Full keyboard navigation: arrow keys to traverse items, Enter to select, Escape to close
- Auto-focus search input on open via `requestAnimationFrame`
- Styled via `--stgm-*` tokens (`bg-popover`, `text-popover-foreground`, `z-popover`, `border-border`)
- Exported from SDK barrel (`@stigmer/react`) for platform builders

### T03: On-node "+" wired to TaskPicker — COMPLETED

**What was accomplished:**
- Replaced hardcoded `actions?.addSuccessorTask(id, "agent_call")` with `TaskPickerPopover` trigger
- Added per-node `useState<boolean>` for popover open state + `useRef<HTMLButtonElement>` for anchor
- On kind selection, calls `actions.addSuccessorTask(id, selectedKind)` then closes popover

### T04: Edge "+" opens TaskPicker — COMPLETED

**What was accomplished:**
- Replaced hardcoded `actions?.insertTaskOnEdge(id, "agent_call")` with `TaskPickerPopover` trigger
- Added `pickerOpen` to edge "+" button visibility condition so the button stays visible while picker is open
- On kind selection, calls `actions.insertTaskOnEdge(id, selectedKind)` then closes popover

### Shared: Extract constants to canvas-constants.ts — COMPLETED

- Moved `CATEGORY_DISPLAY_NAMES` and `CATEGORY_ORDER` from `WorkflowTaskPalette.tsx` to `canvas-constants.ts`
- Both `WorkflowTaskPalette` and `TaskPickerPopover` import from the shared location

**Key decisions:**
- `@base-ui/react/popover` as the popover primitive — MIT license (DD-012), headless-first (DD-003), no framework deps (DD-004), already a peer dependency
- Per-node popover state (not a shared singleton) — Base UI Popup doesn't mount DOM when `open=false`, so 50 idle nodes have zero DOM overhead. Simpler architecture, same performance.
- `useState` inside `React.memo` is architecturally sound — memo protects against parent-driven re-renders, local state enables self-driven re-renders. The "+" click handler becomes MORE stable (empty deps via `setPickerOpen`).
- `Popover.Positioner` `anchor` prop with ref — positions correctly inside `EdgeLabelRenderer` because Floating UI reads `getBoundingClientRect()` from the button regardless of CSS transform context.
- Keyboard isolation correct by default — portaled popover DOM is outside React Flow tree, so key events in search input don't trigger canvas Delete/Backspace handlers.

**Files modified (6 modified + 1 new, +94/-32 lines):**
- `sdk/react/src/workflow/TaskPickerPopover.tsx` — NEW: searchable popover component (327 lines)
- `sdk/react/src/workflow/canvas-constants.ts` — added `CATEGORY_DISPLAY_NAMES`, `CATEGORY_ORDER`
- `sdk/react/src/workflow/WorkflowTaskPalette.tsx` — imports from canvas-constants instead of local definitions
- `sdk/react/src/workflow/CanvasTaskNode.tsx` — `TaskPickerPopover` trigger on "+" button
- `sdk/react/src/workflow/CanvasTransitionEdge.tsx` — `TaskPickerPopover` trigger on "+" button
- `sdk/react/src/workflow/index.ts` — export `TaskPickerPopover`, `TaskPickerPopoverProps`
- `sdk/react/src/index.ts` — export `TaskPickerPopover`, `TaskPickerPopoverProps`

## Next Steps

1. **T05: Right-click context menu + DuplicateNodeCommand** — `onNodeContextMenu`, `onEdgeContextMenu`, `onPaneContextMenu`. Node menu: Delete, Duplicate, Copy. Edge menu: Delete Connection, Insert Node (opens TaskPicker). Canvas menu: Add Node (opens TaskPicker), Select All, Auto-layout.
2. **T06: NodeToolbar on selection** — Composes all previous actions into a floating toolbar using `@xyflow/react`'s `<NodeToolbar>`.
3. **T07: Keyboard shortcuts** — Ctrl+D for duplicate, N-key to open command palette.

## Context for Resume

- `TaskPickerPopover` is the shared picker component. It's used by both `CanvasTaskNode` (add successor) and `CanvasTransitionEdge` (insert on edge). The context menu (T05) should reuse the same component.
- The popover uses `@base-ui/react/popover` with `anchor` prop on `Popover.Positioner` (not `Popover.Anchor` which doesn't exist in v1.3.0). The `align` prop is used (not `alignment`).
- `CATEGORY_DISPLAY_NAMES` and `CATEGORY_ORDER` now live in `canvas-constants.ts` as shared constants.
- The hover action pattern is established: `group` class on outer div, `group-hover:` for visibility. The popover open state keeps the "+" button visible while the picker is open (edge: `hovered || selected || pickerOpen`).
- `CanvasActionsContext` is the dispatch mechanism for node-level actions. New actions for T05 (duplicate) go here.

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
6. [ ] Continue with the next task (T05: Right-click context menu)

## Quick Commands

After loading context:
- "Continue with T05" - Start the right-click context menu
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
