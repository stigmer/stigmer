# Workflow Context Menus, Keyboard Shortcuts, and Internal Clipboard (T11)

**Date**: May 23, 2026

## Summary

Implemented comprehensive right-click context menus, keyboard shortcuts (copy/cut/paste), internal clipboard with multi-selection batch operations, and a View YAML dialog for the workflow visual canvas editor. This completes T11 of the workflow UX implementation project, bringing the editor to parity with state-of-the-art workflow editors (Step Functions, n8n, Retool) for direct manipulation interactions.

## Problem Statement

The workflow canvas editor had a minimal context menu (Duplicate, Add after, Delete) and limited keyboard shortcuts (Cmd+D, Cmd+A, N, Escape, Cmd+Z). Several actions available in the inspector overflow menu (Disable/Bypass, Wrap in Try/Catch) were not accessible via right-click. There was no copy/paste support, no multi-selection batch operations, and the `taskToYaml()` utility built in T10 was not surfaced in any UI.

### Pain Points

- Users had to use the inspector overflow menu for Disable, Wrap in Try/Catch — not discoverable
- No copy/paste within the same workflow — common editor expectation
- No multi-selection context menu (right-click on box-selected nodes did nothing)
- Pane context menu missing Paste and Zoom to Fit
- Shortcut hint labels were hardcoded strings scattered across files
- View YAML was built but unreachable from any UI surface

## Solution

Five-phase implementation, each independently testable:

1. **Shortcut Registry** — Canonical shortcut definition table (pure TypeScript, no React) serving as the single source of truth for all keyboard shortcuts, consumed by keyboard handlers, context menu hints, and toolbar tooltips.

2. **Context Menu Enhancement** — Node menu enriched with Rename, Copy, Disable/Bypass, Wrap in Try/Catch, View YAML. Pane menu enriched with Paste and Zoom to Fit. New multi-selection context menu via `onSelectionContextMenu` for batch operations.

3. **Internal Clipboard** — Pure TypeScript `serializeSelection` / `pasteClipboard` functions with ID regeneration, edge remapping, and position offsetting. Keyboard shortcuts Cmd+C/V/X wired through existing focus-gated pattern. Batch operations (duplicateSelection, disableSelection, deleteSelection) via CompoundCommand.

4. **View YAML Dialog** — Read-only `<dialog>` showing `taskToYaml()` output with copy-to-clipboard, accessible from both context menu and inspector overflow menu.

5. **Tests** — 53 new unit tests (shortcut registry, clipboard serialize/paste, context menu logic) + 10 E2E test specs.

## Implementation Details

### New Files (7)
- `sdk/react/src/workflow/shortcut-registry.ts` — `ShortcutDefinition` type, `getAllShortcuts()`, `getShortcut()`, `getShortcutHint()`, platform-aware hint formatting
- `sdk/react/src/workflow/clipboard.ts` — `ClipboardEntry`, `serializeSelection()`, `pasteClipboard()` with `CompoundCommand` output
- `sdk/react/src/workflow/ViewYamlDialog.tsx` — Native `<dialog>` with monospace YAML display, copy button, backdrop dismiss
- `sdk/react/src/workflow/__tests__/shortcut-registry.test.ts` — 27 tests
- `sdk/react/src/workflow/__tests__/clipboard.test.ts` — 15 tests
- `sdk/react/src/workflow/__tests__/context-menu-logic.test.ts` — 11 tests
- `test/e2e/tests/functional/workflow-context-menu.spec.ts` — 10 E2E test cases

### Modified Files (9)
- `CanvasContextMenu.tsx` — New `CanvasContextMenuTarget.selection`, enriched node/pane menus, new `SelectionMenuItems`, shortcut hints from registry
- `WorkflowCanvasInner.tsx` — Added `onSelectionContextMenu` prop to React Flow
- `useCanvasKeyboardShortcuts.ts` — Added Cmd+C (copy), Cmd+V (paste), Cmd+X (cut) handlers
- `useWorkflowCanvas.ts` — Added clipboard ref, `copySelection`, `pasteAtCenter`, `cutSelection`, `duplicateSelection`, `disableSelection`, `deleteSelection`, `getSelectedNodeIds`, `hasClipboard`
- `WorkflowCanvasEditor.tsx` — Wired all new context menu/clipboard/ViewYaml handlers
- `WorkflowInspectorPanel.tsx` — Threaded `onViewYaml` prop
- `inspector/InspectorShell.tsx` — Threaded `onViewYaml` to InspectorHeader
- `inspector/InspectorHeader.tsx` — Added View YAML to overflow actions menu
- `workflow/index.ts` — Exported new public types and components

### Design Decisions
- **DD-T11-001**: Shortcut registry as single source of truth (eliminates hardcoded hint strings)
- **DD-T11-002**: Internal clipboard only (no `navigator.clipboard` or cross-workflow) — reduces complexity
- **DD-T11-003**: Multi-selection actions via `CompoundCommand` (single undo unit)
- **DD-T11-004**: Focus-gated shortcuts only (no configurable `shortcutMap` prop) — follows DD-004/DD-011

## Benefits

- Full context menu parity with inspector overflow menu — all node actions accessible via right-click
- Copy/paste within workflow — standard editor expectation met
- Multi-selection batch operations — select N nodes, right-click → Delete/Duplicate/Disable all at once with single undo
- View YAML accessible from both context menu and inspector — helps users understand task configuration
- Centralized shortcut registry prevents hint string drift across menus and tooltips

## Impact

- **SDK consumers**: New exports (`ShortcutDefinition`, `ClipboardEntry`, `ViewYamlDialog`) available for platform builders
- **Client apps**: Zero changes required (DD-016 compliance) — all context menu and shortcut logic is internal to the canvas component
- **Test coverage**: 106 new unit tests + 10 E2E specs, zero regressions on 158 existing tests

## Related Work

- T10 (Inspector Panel Refactor) — established the action commands (ToggleNodeDisabled, WrapInTryCatch) and `taskToYaml` that T11 surfaces
- T08 (Contextual Task Picker) — established the N key shortcut pattern and `useCanvasKeyboardShortcuts` hook that T11 extends
- T05 (Runtime Inspector Panel) — established the original `CanvasContextMenu` that T11 enriches

---

**Status**: ✅ Production Ready
**Timeline**: Single session (T11 implementation)
