# Next Task: 20260517.01.workflow-canvas-interaction-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260517.01.workflow-canvas-interaction-ux

**Description**: Add production-grade node interaction UX to the visual workflow canvas editor — on-node delete buttons, quick-add '+' buttons with task pickers, right-click context menus, and floating toolbars on selection.
**Goal**: Fix the fundamental UX gaps in the canvas editor so users can add, delete, duplicate, and manipulate nodes directly on the canvas, matching the interaction standards of editors like n8n, Retool, and ComfyUI.
**Tech Stack**: TypeScript/React, @xyflow/react v12, @stigmer/react SDK, @base-ui/react, Tailwind CSS, dagre
**Components**: sdk/react/src/workflow/ (CanvasTaskNode, CanvasTransitionEdge, TaskPickerPopover, CanvasContextMenu, WorkflowCanvasInner, WorkflowCanvasEditor, WorkflowInspectorPanel, useWorkflowCanvas, CanvasActionsContext, useCanvasKeyboardShortcuts)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-05-17 (Session 06) — Implemented T07 (keyboard shortcuts)
- **Active Task**: T07 completed, Copy/Paste next

## Session Progress (2026-05-17, Session 06)

### T07: Keyboard Shortcuts — COMPLETED

**What was accomplished:**
- Created `useCanvasKeyboardShortcuts.ts` — dedicated hook for canvas-scoped keyboard shortcuts, following SRP (separated from `useGraphHistory` undo/redo and `useWorkflowCanvas` state management)
- Implemented four shortcuts: `Ctrl/Cmd+D` (duplicate selected node), `Ctrl/Cmd+A` (select all non-sentinel nodes), `N` (open task picker), `Escape` (clear selection + close overlays)
- Wired hook into `WorkflowCanvasEditor` — reuses existing `pendingPicker` state machine for the N-key task picker flow
- Added platform-aware shortcut hint badges to `CanvasContextMenu` items (Duplicate, Delete, Add task, Select all) — shows `⌘` on macOS, `Ctrl+` on Windows/Linux
- Made toolbar tooltips platform-aware (Undo/Redo show correct modifier symbol)

**Key decisions:**
- **Separate hook (`useCanvasKeyboardShortcuts`)** rather than expanding `useGraphHistory` — SRP: history manages undo/redo, this hook manages canvas action shortcuts
- **Capture-phase listener** (`document.addEventListener("keydown", handler, true)`) matches `useGraphHistory` pattern for consistent keyboard event handling
- **Text input guard** for bare-key shortcuts (N, Escape): checks `tagName`, `isContentEditable`, and `role="textbox"` to prevent firing while typing in inspector inputs
- **N-key positioning**: Option B — anchors picker below the selected node (via `querySelector('[data-id=...]')` + `getBoundingClientRect()`), falls back to viewport center when nothing selected
- **`onDismiss` callback**: Escape clears both `contextMenu` and `pendingPicker` state in addition to calling `clearSelection`
- **Platform detection**: `navigator.platform` regex for macOS detection, with `typeof navigator !== "undefined"` SSR guard

**Files changed (1 new + 2 modified, +225/-3 lines):**
- `sdk/react/src/workflow/useCanvasKeyboardShortcuts.ts` — NEW: 135-line hook with keydown listener, focus scoping, text input guard, 4 shortcut handlers
- `sdk/react/src/workflow/WorkflowCanvasEditor.tsx` — import + hook call + `handleRequestTaskPicker` + `handleKeyboardDismiss` + platform-aware toolbar tooltips (+70 lines)
- `sdk/react/src/workflow/CanvasContextMenu.tsx` — platform detection + `SHORTCUT_LABELS` + `SHORTCUT_HINT_CLASS` + shortcut badges on 4 menu items (+23 lines)

### Previous Sessions (same day)
- Session 05: Bug fixes — stale-closure in task picker, Tauri drag-drop — COMPLETED
- Session 04: T06 — NodeToolbar on Selection + shared icon extraction — COMPLETED
- Session 01-03: T01–T05 — Hover actions, TaskPicker, edge "+", context menu, duplicate — COMPLETED

## Next Steps

1. **Copy/Paste** — Clipboard serialization format, Ctrl+C/Ctrl+V, multi-node support (deferred from T05).

## Context for Resume

- `useCanvasKeyboardShortcuts` is an internal module (not exported from the SDK barrel). It uses the same capture-phase `document.addEventListener("keydown", ...)` pattern as `useGraphHistory`.
- The hook receives canvas actions via options object — `duplicateNode`, `selectAll`, `clearSelection`, `onRequestTaskPicker`, `onDismiss`. It reads `selection` to know which node is selected for `Ctrl+D` and `N` positioning.
- The `N` key handler passes `{ x: 0, y: 0 }` as a sentinel position when a node is selected — `handleRequestTaskPicker` in `WorkflowCanvasEditor` resolves the actual screen position by querying the DOM element via `[data-id]` attribute selector.
- `isTextInput()` checks three conditions: `tagName` (INPUT/TEXTAREA/SELECT), `isContentEditable`, and `role="textbox"`. Bare-key shortcuts (N, Escape) use this guard; modified shortcuts (Ctrl+D, Ctrl+A) do not.
- Platform detection (`isMac`) is duplicated in `CanvasContextMenu.tsx` and `WorkflowCanvasEditor.tsx` — both use `typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)`. Kept as local constants to avoid adding browser dependencies to `canvas-constants.ts`.
- `CanvasContextMenu` now has `SHORTCUT_LABELS` and `SHORTCUT_HINT_CLASS` for right-aligned shortcut badges. On macOS: `⌘D`, `⌫`, `⌘A`, `N`. On Windows: `Ctrl+D`, `Del`, `Ctrl+A`, `N`.
- Toolbar `TOOLBAR_SHORTCUTS` object provides platform-aware labels for Undo/Redo tooltip `title` attributes.

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
6. [ ] Continue with the next task (Copy/Paste)

## Quick Commands

After loading context:
- "Continue with Copy/Paste" - Start clipboard support
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
