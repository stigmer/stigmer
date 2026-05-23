# Session Notes: T11 Context Menus and Keyboard Shortcuts

**Date**: 2026-05-23
**Task**: T11 (Context Menus and Keyboard Shortcuts)
**Status**: Complete

## Accomplishments

- Created `shortcut-registry.ts` — canonical shortcut definition table, pure TypeScript, platform-aware hints
- Created `clipboard.ts` — internal clipboard serialize/paste with ID regen, edge remapping, position offset
- Created `ViewYamlDialog.tsx` — read-only YAML modal with copy-to-clipboard, native `<dialog>` element
- Enriched `CanvasContextMenu` with Rename, Copy, Disable/Bypass, Wrap in Try/Catch, View YAML for nodes
- Added multi-selection context menu via `onSelectionContextMenu` (batch delete/duplicate/disable/copy)
- Added Paste and Zoom to Fit to pane context menu
- Added Cmd+C/V/X keyboard shortcuts to `useCanvasKeyboardShortcuts`
- Added clipboard/batch operations to `useWorkflowCanvas` (copySelection, pasteAtCenter, cutSelection, duplicateSelection, disableSelection, deleteSelection)
- Threaded View YAML through inspector panel (InspectorHeader → InspectorShell → WorkflowInspectorPanel → WorkflowCanvasEditor)
- 53 new unit tests + 10 E2E test cases, zero regressions

## Decisions Made

- **DD-T11-001**: Shortcut registry as single source of truth — hardcoded hint strings removed from CanvasContextMenu
- **DD-T11-002**: Internal clipboard only (no `navigator.clipboard`) — simpler, avoids cross-workflow serialization format commitment
- **DD-T11-003**: Multi-selection via `CompoundCommand` — proven pattern from existing `onNodesDelete`
- **DD-T11-004**: Focus-gated shortcuts only — no configurable shortcutMap prop for embedders (defer to follow-up if demanded)

## Key Code Changes

- `shortcut-registry.ts`: New file, ~130 lines. `ShortcutDefinition` type with `id`, `label`, `keys`, `hint`, `scope`, `requiresDesignMode`. `formatHint()` handles Mac/non-Mac symbols. Exported via `getShortcut()`, `getShortcutHint()`, `getAllShortcuts()`.
- `clipboard.ts`: New file, ~170 lines. `serializeSelection()` deep-clones selected nodes + internal edges, strips sentinels. `pasteClipboard()` generates unique names, offsets positions, remaps edges, returns `CompoundCommand`.
- `ViewYamlDialog.tsx`: New file, ~150 lines. Uses native `<dialog>` element with `showModal()`. Copy button with fallback `execCommand("copy")`. All `--stgm-*` tokens.
- `CanvasContextMenu.tsx`: +275 lines. New `SelectionMenuItems` component. Node menu expanded from 3 to 8 items. 7 new inline SVG icons. `DISABLED_ITEM_CLASS` for paste-when-empty.
- `useWorkflowCanvas.ts`: +125 lines. `clipboardRef`, `hasClipboard` state, 7 new `useCallback` methods for clipboard and batch operations. `getSelectedNodeIds()` bridges RF selection with inspector single-select.
- `useCanvasKeyboardShortcuts.ts`: +39 lines. Three new Cmd+C/V/X handlers with `isTextInput` guards.

## Learnings

- React Flow's `onSelectionContextMenu` fires when right-clicking on the blue selection box. It does NOT fire when right-clicking a single selected node — that still goes through `onNodeContextMenu`. Both must be handled.
- The clipboard uses the graph model's node list (not React Flow's `getNodes()`) for serialization, ensuring the data is the canonical model — not the RF view state with additional rendering props.
- `CompoundCommand` for batch operations gives single-undo for free and was already proven by the existing multi-delete path.

## Open Questions

- **Configurable shortcutMap**: Deferred. If platform builders request key remapping, the internal shortcut registry supports it without refactoring.
- **Cross-workflow clipboard**: Deferred. Would need a portable YAML fragment format + context-mismatch handling.
- **Multi-node YAML preview**: ViewYamlDialog currently shows single-node YAML only.

## Test Results

- 27 shortcut-registry tests — all pass
- 15 clipboard tests — all pass
- 11 context-menu-logic tests — all pass
- 158 existing workflow tests — zero regressions
- 10 E2E test specs written (require Auth0 session for interactive execution)

## Next Session Plan

- Update `next-task.md` with T11 completion
- Remaining project tasks: T09 (Branch Management UX), backend follow-ups (#6 waterfall enrichment, #7 runner I/O)
