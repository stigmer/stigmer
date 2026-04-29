# Workspace Selector UX Upgrade

**Date**: April 29, 2026

## Summary

Upgraded the `RunnerFileBrowser` from a functional directory lister into a state-of-the-art workspace selector with runner context awareness, recent/favorite paths, type-ahead navigation, directory caching, and adaptive dual-mode support for desktop native file dialogs. These changes make the workspace selection experience comparable to VS Code Remote's folder picker across all four runner topologies (local native, local Docker, remote native, remote Docker).

## Problem Statement

The `RunnerFileBrowser` component — used by the session composer to let users pick a project directory on their runner's filesystem — was functional but lacked the UX polish expected of a state-of-the-art platform. Specific issues:

### Pain Points

- No indication of which runner's filesystem the user was browsing. With multiple runners, this was disorienting.
- Every session required browsing from scratch — no memory of previously used paths.
- Power users who knew the exact path had to click through multiple directories.
- Every directory navigation required a full cloud round-trip (browser -> server -> runner -> back), with no caching of visited paths.
- The desktop app had an orphaned native file picker hook (`useNativeFolderPicker`) that wasn't wired up, missing an opportunity for a more familiar UX on local native runners.

## Solution

Five targeted improvements to the existing `RunnerFileBrowser` ecosystem, keeping it as the single consistent mechanism across all runner topologies while adding layers of UX polish.

## Implementation Details

### 1. Runner Context Header

Added `runnerName` and `runnerHostname` optional props to `RunnerFileBrowser`. When provided, the component renders a context header (server icon + "dev-macbook · Alice's MacBook Pro") so users always know which machine's filesystem they're browsing. The metadata flows from the runner list in `SessionComposer` through `WorkspaceEditor`.

**Files**: `RunnerFileBrowser.tsx`, `WorkspaceEditor.tsx`, `SessionComposer.tsx`

### 2. Recent and Favorite Paths

Created `useRecentWorkspaces` hook with `localStorage` persistence keyed by `runner_id`. Stores up to 8 recent paths per runner with pin/unpin support. The `RunnerFileBrowser` now renders a "Recent" section at the top showing previously used paths with pin, navigate-to, and remove actions. Selecting a workspace automatically records it in recents.

Uses `useSyncExternalStore` for cross-component reactivity when the storage changes.

**Files**: new `useRecentWorkspaces.ts`, `RunnerFileBrowser.tsx`, `workspace/index.ts`

### 3. Editable Path Input

The breadcrumb path bar now has a pencil icon that toggles it into an editable text input. Users can type an absolute path or `~/relative` and press Enter to navigate directly. Escape or blur cancels. Individual breadcrumb segments remain clickable for navigation — the edit button is an addition, not a replacement.

**Files**: `RunnerFileBrowser.tsx`

### 4. Directory Listing Cache

Added a `Map<string, CachedListing>` to the `useRunnerFileBrowser` reducer state. Previously visited directories are served from cache with a 30-second TTL, making back-navigation instant instead of requiring another cloud round-trip. Cache entries are populated on every successful `ListDirectory` response.

**Files**: `useRunnerFileBrowser.ts`

### 5. Desktop Native File Dialog

Un-deprecated the `onBrowseLocalFolder` prop on `WorkspaceEditor` and clarified its role as a desktop-only enhancement (not a replacement for the file browser). When provided, an "Open system file dialog" button appears above the `RunnerFileBrowser`. Wired up the desktop `SessionLauncher` to pass the existing `useNativeFolderPicker()` hook.

**Files**: `WorkspaceEditor.tsx`, desktop `SessionLauncher.tsx`

## Benefits

- **Orientation**: Users with multiple runners always know which machine they're browsing.
- **Speed**: Recent paths eliminate browsing for repeat-use directories. Caching makes back-navigation instant.
- **Power users**: Type-ahead path input bypasses the tree entirely — type `~/projects/my-app`, press Enter.
- **Desktop familiarity**: Local native runner users get the OS file dialog alongside the in-browser browser.
- **Zero breaking changes**: All new props are optional. Existing consumers of `RunnerFileBrowser`, `WorkspaceEditor`, and `SessionComposer` continue to work without modification.

## Impact

- **SDK (`@stigmer/react`)**: New exports `useRecentWorkspaces`, `RecentWorkspace`, `UseRecentWorkspacesReturn`. New optional props on `RunnerFileBrowserProps` and `WorkspaceEditorProps`. All backward-compatible.
- **Desktop app**: `SessionLauncher` now passes native folder picker. No user-visible breaking change.
- **Web console**: Inherits all improvements automatically through the SDK.
- **Platform builders**: Can adopt recent workspaces and runner context awareness by passing the new optional props.

## Related Work

- Design analysis originated from an architectural review of the runner `ListDirectory` bidi RPC pattern.
- Companion project `20260428.02.runner-reverse-rpc-protocol` addresses the protocol layer (separate from this UX work).
- Prior project `20260422.02.runner-command-stream` introduced the `ListDirectory` command and original `RunnerFileBrowser`.

---

**Status**: Production Ready
**Timeline**: 1 session
