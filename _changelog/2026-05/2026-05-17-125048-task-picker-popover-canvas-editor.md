# TaskPicker Popover: Searchable Task Type Selector for Canvas Editor

**Date**: May 17, 2026

## Summary

Added a shared `TaskPickerPopover` component to the workflow canvas editor that replaces hardcoded `agent_call` insertion on both node "+" and edge "+" buttons. Users can now search and select from all 20 task types when adding or inserting nodes on the canvas, matching the interaction standards of n8n, Retool, and ComfyUI.

## Problem Statement

The visual workflow canvas editor had functional "+" buttons on nodes (add successor) and edges (insert between), but both hardcoded `agent_call` as the task type. Users had no way to choose which type of task to create from these quick-add affordances — they had to drag from the sidebar palette instead, which is slower for experienced users who know what they want.

### Pain Points

- "+" buttons always created Agent Call tasks regardless of user intent
- No inline task type selection — forced users back to the sidebar palette
- The edge "+" insert and node "+" add were functionally identical (both created agent_call), reducing their utility
- Missing a fundamental interaction pattern expected by users of visual editors

## Solution

Created a `TaskPickerPopover` component using `@base-ui/react/popover` that presents a searchable, categorized list of all workflow task kinds. Wired it as the selection step between clicking "+" and creating the node. The popover reuses the same `useTaskKindRegistry` data hook and `CATEGORY_COLORS`/`CATEGORY_ORDER` constants as the sidebar palette, ensuring visual and data consistency.

## Implementation Details

- **New component**: `TaskPickerPopover` (327 lines) — `Popover.Root` → `Popover.Portal` → `Popover.Positioner` → `Popover.Popup` with search input, categorized list, keyboard navigation
- **First SDK usage** of `@base-ui/react/popover` (already a declared peer dependency)
- **Shared constants**: Extracted `CATEGORY_DISPLAY_NAMES` and `CATEGORY_ORDER` from `WorkflowTaskPalette` into `canvas-constants.ts`
- **Node "+"**: `CanvasTaskNode` now opens the picker popover; on selection, calls `addSuccessorTask(id, chosenKind)`
- **Edge "+"**: `CanvasTransitionEdge` now opens the picker popover; on selection, calls `insertTaskOnEdge(id, chosenKind)`
- **Keyboard-first**: Search auto-focused on open, arrow keys traverse items, Enter selects, Escape closes
- **SDK export**: `TaskPickerPopover` and `TaskPickerPopoverProps` exported from `@stigmer/react` for platform builders

## Benefits

- Users can now add any of 20 task types directly from canvas "+" buttons
- Keyboard-first interaction: type to search, arrow to navigate, Enter to confirm — no mouse required
- Consistent visual language with the sidebar palette (same categories, colors, descriptions)
- Platform builders can embed `TaskPickerPopover` in custom canvas UIs via the SDK export

## Impact

- **Workflow canvas editor UX**: Fundamental interaction gap closed — "+" buttons are now fully functional task type selectors
- **SDK surface**: New public export (`TaskPickerPopover`) available to platform builders
- **Codebase**: First production usage of `@base-ui/react/popover` in the SDK, establishing the pattern for future portaled popover components

## Related Work

- T01: On-node hover actions (delete + quick-add) — the "+" buttons this task enhances
- T05 (upcoming): Right-click context menu — will reuse `TaskPickerPopover` for "Add Node" / "Insert Node" actions
- Deep research report: `_projects/2026-05/20260508.01.bring-workflows-to-foreground/research.visual-canvas-editor-ux/04.report.gpt.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~45 minutes)
