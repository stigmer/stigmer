# Keyboard Shortcuts for the Workflow Canvas Editor

**Date**: May 17, 2026

## Summary

Added keyboard shortcuts to the visual workflow canvas editor — Ctrl/Cmd+D to duplicate nodes, Ctrl/Cmd+A to select all, N to open the task picker, and Escape to dismiss overlays. Includes platform-aware shortcut hint badges in the context menu and toolbar tooltips.

## Problem Statement

The workflow canvas editor had comprehensive mouse-driven interactions (hover buttons, NodeToolbar, right-click context menu, drag-and-drop) but no keyboard shortcuts for common actions. Users building workflows sequentially had to reach for the mouse for every operation.

### Pain Points

- No keyboard shortcut to duplicate a selected node — required right-click menu or toolbar click
- No quick-add from the keyboard — had to click the "+" button or use the context menu
- No keyboard select-all — only available via the pane context menu
- No Escape key to dismiss menus and clear selection
- Toolbar tooltips showed hardcoded "Ctrl+Z" even on macOS where users expect "⌘Z"

## Solution

Created a dedicated `useCanvasKeyboardShortcuts` hook following single responsibility principle, wired into the existing `WorkflowCanvasEditor` component. Reuses the established capture-phase keyboard event pattern from `useGraphHistory` (undo/redo) and the `pendingPicker` state machine for the N-key task picker flow.

## Implementation Details

**New hook: `useCanvasKeyboardShortcuts.ts`** — Canvas-scoped keyboard shortcut handler with:
- Focus scoping via `container.contains(document.activeElement)` (same pattern as undo/redo)
- Text input guard (`isTextInput`) preventing bare-key shortcuts from firing in inspector inputs, search fields, and contentEditable elements
- Platform-aware modifier detection (`e.metaKey || e.ctrlKey`)

**Shortcut bindings:**
- `Ctrl/Cmd+D` — Duplicate selected node (reads `selection.id`, calls `duplicateNode`)
- `Ctrl/Cmd+A` — Select all non-sentinel nodes (blocks browser text selection via `preventDefault`)
- `N` (bare key) — Opens task picker, positioned below selected node or at viewport center
- `Escape` — Clears selection, closes context menu, dismisses pending picker

**Context menu shortcut badges** — Right-aligned platform-aware labels (`⌘D` on macOS, `Ctrl+D` on Windows) on Duplicate, Delete, Add task, and Select all menu items.

**Toolbar tooltip consistency** — Undo/Redo buttons now show platform-appropriate modifier symbols.

## Benefits

- Keyboard-first workflow building: select node → `N` → pick type → node appears connected — no mouse required for the core editing loop
- Consistent with reference editors (n8n, Figma, VS Code) that users already know
- Context menu badges make shortcuts discoverable without documentation
- Platform-native feel on both macOS and Windows/Linux

## Impact

- **SDK package**: `@stigmer/react` — 1 new internal module, 2 modified components
- **Users affected**: All workflow canvas editor users (Console + embedded)
- **Bundle impact**: ~135 lines of new code, no new dependencies
- **Accessibility**: Keyboard navigation is improved; all new shortcuts work alongside existing tab/arrow/Enter navigation

## Related Work

- T01–T06: Mouse-driven interaction UX (hover buttons, NodeToolbar, TaskPicker, context menu)
- `useGraphHistory.ts`: Established the capture-phase keyboard event pattern now shared by this hook
- Future: Copy/Paste (Ctrl+C/Ctrl+V) — deferred, requires clipboard serialization format

---

**Status**: ✅ Production Ready
