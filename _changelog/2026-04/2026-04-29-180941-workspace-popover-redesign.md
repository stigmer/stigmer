# Workspace Popover Redesign: Run On + Flat List with Drill-In

**Date**: April 29, 2026

## Summary

Redesigned the workspace popover from a tabbed layout (Local Folder / GitHub Repo) to a Cursor-inspired flat list with drill-in sub-views. Moved runner selection into the workspace popover as a "Run On" section. Fixed a critical infinite re-render crash in `useRecentWorkspaces`. Added runner-switch safety that auto-clears local folder entries when the user changes runners.

## Problem Statement

The previous workspace UX had several issues:

### Pain Points

- An infinite re-render crash when opening the workspace popover (caused by `useSyncExternalStore` snapshot returning new array references on every call)
- Runner selection was in the Configure menu, separate from workspace -- users had to hop between two menus to set up their working environment
- The tabbed layout (Local Folder / GitHub Repo) showed everything simultaneously, creating clutter
- No safety mechanism when switching runners -- local folder entries from one runner would persist after switching to a different runner where those paths don't exist
- "Local Folder" as a tab name felt wrong; entry badges showed "Local" redundantly

## Solution

### 1. Crash Fix (`useRecentWorkspaces`)

Added module-level snapshot caching keyed by `(runnerId, snapshotVersion)`. The `getSnapshot` function now returns the same reference unless a mutation bumps the version, satisfying `useSyncExternalStore`'s referential equality contract.

### 2. "Run On" Selector (`WorkspaceRunnerSelector`)

New Cursor-inspired component that renders a compact "Run On" section at the top of the workspace popover. Shows available runners with Auto/name/hostname labels. Single-select (mutually exclusive). When "Auto" is selected, local folder browsing is disabled since there's no specific runner to browse.

### 3. Flat List with Drill-In (`WorkspaceEditor`)

Replaced the tabbed layout with a progressive-disclosure pattern:
- **Default view**: current workspace entries (folder icon for local, "GitHub" badge for git, remove buttons) + action items ("Browse Folder" and "Connect GitHub")
- **Browse Folder drill-in**: back button + `RunnerFileBrowser` with recents, context header, type-ahead
- **Connect GitHub drill-in**: back button + GitHub connection/repo picker
- **Desktop native shortcut**: when `onBrowseLocalFolder` is provided, clicking "Browse Folder" opens the OS native file dialog directly instead of drilling into the in-browser file browser

### 4. Runner-Switch Safety

Added `clearLocal()` to `useWorkspaceEntries` that removes only local entries (keeping git entries). A `useEffect` in `SessionComposer` watches `runnerId` and auto-clears local entries on runner switch -- no blocking dialog, just quiet cleanup.

### 5. Runner Relocated from Configure to Workspace

When workspace is enabled, runner is shown in the workspace popover ("Run On" section) instead of the Configure menu. When workspace is NOT enabled, runner stays in Configure for platform builders who use runner selection without workspace.

## Benefits

- No more crash when opening workspace
- Single unified flow: pick where to run, then pick what to work on -- one popover
- Progressive disclosure reduces initial cognitive load
- Runner-switch safety prevents invalid workspace configurations
- Desktop users get native OS dialog directly, no extra clicks
- Works in both session launcher and follow-up composer contexts

## Impact

- **SDK (`@stigmer/react`)**: New component `WorkspaceRunnerSelector`. New method `clearLocal()` on `UseWorkspaceEntriesReturn`. `WorkspaceEditor` API unchanged (same props, different rendering).
- **Desktop app**: `SessionLauncher` passes `useNativeFolderPicker()` for native dialog.
- **Web console**: Inherits all changes through SDK.

---

**Status**: Production Ready
**Timeline**: 1 session
