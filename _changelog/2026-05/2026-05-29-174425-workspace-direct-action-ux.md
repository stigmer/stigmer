# Workspace Direct-Action UX: Eliminate Redundant Source Selection Steps

**Date**: May 29, 2026

## Summary

Removed redundant intermediate clicks in the workspace source picker. On desktop (zero entries), the workspace icon now directly opens the native folder dialog instead of showing a popover with a single "Browse Folder" option. On web (zero entries), the popover auto-drills into the GitHub connect/picker panel instead of showing an action list with a single "Connect GitHub" button.

## Problem Statement

The workspace button in the composer toolbar always opened a `ContextPopover` regardless of how many choices the user had, creating unnecessary friction on both platforms.

### Pain Points

- Desktop users clicked the workspace icon, saw a popover with only "Browse Folder", clicked that, then got the OS dialog — one completely wasted click
- Web users clicked the workspace icon, saw a popover with only "Connect GitHub", clicked that, then drilled into the GitHub panel — two wasted interactions
- Both violated Hick's Law (unnecessary choices increase decision time) and Nielsen's Heuristic #7 (flexibility and efficiency of use)

## Solution

Made the workspace button's click behavior context-aware: when there is exactly one logical path forward and no existing entries, skip the intermediary and go directly to the action.

- **Desktop (zero entries):** Workspace icon click → native folder dialog immediately
- **Web (zero entries):** Workspace icon click → popover opens directly at GitHub panel (connect prompt or repo picker)
- **Entries > 0 or both sources enabled:** Current popover behavior preserved (management surface for existing entries)

## Implementation Details

### New prop: `onWorkspaceDirectAction` on `ComposerToolbar`

When provided, the workspace icon renders as a plain button that calls the callback directly — no `ContextPopover` wrapper. The button preserves identical styling, badge count, disabled state, and aria-label.

### New prop: `initialPanel` on `WorkspaceEditor`

When `"github"` is passed and entries are empty, the component mounts with `activePanel` already set to `"github"`, bypassing the action-list view. A sync effect resets to the list view when entries transition from 0 to >0.

### Derivation logic in `SessionComposer`

Two `useMemo` hooks derive the optimal behavior based on `workspaceCount`, `enableGitHub`, `enableLocal`, and `onBrowseLocalFolder`:
- `workspaceDirectAction`: set when local-only with zero entries (desktop direct-to-dialog)
- `workspaceInitialPanel`: set to `"github"` when github-only with zero entries (web auto-drill)

### No client-app changes required

The behavior is entirely SDK-internal. Desktop and web already pass the correct `enableGitHub`, `enableLocal`, and `onBrowseLocalFolder` props through `useWorkspaceSources` + `useNativeFolderPicker`.

## Benefits

- Desktop users save one click per workspace addition when starting from scratch
- Web users skip the redundant "Connect GitHub" action-list step
- Zero breaking changes — existing consumers see no difference when entries > 0 or both sources enabled
- Follows DD-016 (client-app parity) — both platforms benefit from a single SDK-level optimization

## Impact

- **Desktop app**: Workspace icon click opens native folder dialog immediately when no entries exist
- **Web app**: Workspace popover opens directly at GitHub panel (connect or picker) when no entries exist
- **SDK consumers**: New `onWorkspaceDirectAction` and `initialPanel` props available for platform builders who embed `WorkspaceEditor` or `ComposerToolbar` directly

## Related Work

- DD-016 (client-app parity) — both platforms benefit uniformly
- DD-003/DD-004 (headless-first, no framework deps in SDK) — all logic lives in the SDK layer
- `2026-05-29-130720-workspace-source-by-execution-target.md` — builds on the `useWorkspaceSources` hook introduced there

---

**Status**: Production Ready
