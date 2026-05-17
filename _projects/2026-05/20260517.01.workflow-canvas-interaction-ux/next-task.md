# Next Task: 20260517.01.workflow-canvas-interaction-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260517.01.workflow-canvas-interaction-ux

**Description**: Add production-grade node interaction UX to the visual workflow canvas editor — on-node delete buttons, quick-add '+' buttons with task pickers, right-click context menus, and floating toolbars on selection.
**Goal**: Fix the fundamental UX gaps in the canvas editor so users can add, delete, duplicate, and manipulate nodes directly on the canvas, matching the interaction standards of editors like n8n, Retool, and ComfyUI.
**Tech Stack**: TypeScript/React, @xyflow/react v12, @stigmer/react SDK, Tailwind CSS, dagre
**Components**: sdk/react/src/workflow/ (CanvasTaskNode, CanvasTransitionEdge, WorkflowCanvasInner, WorkflowCanvasEditor, WorkflowInspectorPanel, useWorkflowCanvas, CanvasActionsContext)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-05-17 — Implemented T01 (on-node hover actions)
- **Active Task**: T01 completed, T02 next

## Session Progress (2026-05-17)

### T01: On-Node Hover Actions (Delete + Quick-Add) — COMPLETED

**What was accomplished:**
- Added CSS-only hover-reveal delete (trash) icon button on `CanvasTaskNode`
- Added CSS-only hover-reveal "+" quick-add button on `CanvasTaskNode` (bottom center)
- Implemented `addSuccessorTask` method in `useWorkflowCanvas` (creates node + edge via CompoundCommand)
- Extended `CanvasActionsContext` with `addSuccessorTask` method
- Wired everything through `WorkflowCanvasEditor`
- TypeScript compiles cleanly, zero linter errors

**Key decisions:**
- CSS-only hover visibility (`group`/`group-hover:` in Tailwind) — no React state per node for performance with 50+ nodes
- "+" button hardcodes `agent_call` kind for now — T02 will add the task picker popover
- Delete button positioned at top-right (-right-2 -top-2), "+" at bottom-center (-bottom-3)
- Both buttons use `scale-75 opacity-0 → scale-100 opacity-100` transition matching existing edge "+" pattern
- Sentinel nodes (Start/End) are unaffected — they render via separate `SentinelNode` component
- `addSuccessorTask` appends a new edge (simple append, not splice) — Option C from the plan

**Files modified (4 files, +105/-4 lines):**
- `sdk/react/src/workflow/CanvasActionsContext.ts` — added `addSuccessorTask` to interface
- `sdk/react/src/workflow/CanvasTaskNode.tsx` — hover buttons, context consumption, callbacks
- `sdk/react/src/workflow/useWorkflowCanvas.ts` — `addSuccessorTask` implementation + return type
- `sdk/react/src/workflow/WorkflowCanvasEditor.tsx` — wired into canvasActions provider

## Next Steps

1. **T02: TaskPicker popover component** — Shared dependency for T03 and T04. Searchable list of task types from `useTaskKindRegistry`. Used by edge "+", node "+", and context menu.
2. **T03: On-node "+" wired to TaskPicker** — Replace hardcoded `agent_call` with TaskPicker popover
3. **T04: Edge "+" opens TaskPicker** — Replace hardcoded `agent_call` in `CanvasTransitionEdge`
4. **T05: Right-click context menu + DuplicateNodeCommand** — `onNodeContextMenu`, `onEdgeContextMenu`, `onPaneContextMenu`
5. **T06: NodeToolbar on selection** — Composes all previous actions into a floating toolbar
6. **T07: Keyboard shortcuts** — Ctrl+D, N-key palette

## Context for Resume

- The hover action pattern is established: `group` class on outer div, `group-hover:` for visibility. All future on-node UI (context menu triggers, selection indicators) should follow this pattern.
- `CanvasActionsContext` is the dispatch mechanism for node-level actions. New actions go here.
- The "+" button's `addSuccessorTask` uses the same pattern as `insertTaskOnEdge` (CompoundCommand + requestAnimationFrame dagre re-layout).
- Edge-case note: "+" currently does a simple append (adds edge from source to new node). The existing outgoing edge is NOT replaced. This matches palette drag behavior. May need refinement in T02 when task picker lands.

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
6. [ ] Continue with the next task (T02: TaskPicker popover)

## Quick Commands

After loading context:
- "Continue with T02" - Start the task picker popover
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
