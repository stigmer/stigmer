# Desktop Workspace File Listing (Phase 3)

**Date**: May 29, 2026

## Summary

Implemented desktop-native workspace file browsing by adding a Rust-side `list_workspace_files` Tauri command and wiring it through `useNativeWorkspaceFiles()` into `SessionPage` and `SessionLauncher`. Desktop now achieves DD-016 parity with web: local workspace entries show an expandable file tree in the Setup inspector, powered by the existing Phase 2 SDK contracts (`WorkspaceFileLister`, `useWorkspaceFiles`, `WorkspaceEntryFiles`).

## Problem Statement

Phase 2 shipped the SDK layer and web GitHub tree lister, but desktop intentionally passed no `workspaceFileLister` — workspace entries rendered as flat rows with no expand affordance. Users on desktop could attach a local folder but could not browse its contents before starting a session.

### Pain Points

- No way to verify the correct folder was selected before sending a message
- DD-016 client parity gap between web (GitHub tree) and desktop (hidden affordance)
- Original Phase 3 plan called for `tauri-plugin-fs` and optional `tauri-plugin-shell`, adding security surface and capability changes

## Solution

Use a **custom Tauri command** in Rust with the `ignore` crate (ripgrep's gitignore engine) instead of exposing filesystem or shell plugins to JavaScript. The JS hook is a thin IPC wrapper that implements the existing `WorkspaceFileLister` contract.

## Implementation Details

### Rust: `workspace.rs`

- `list_workspace_files(path)` — validates directory, walks with `ignore::WalkBuilder`
- Respects nested `.gitignore`, `.git/info/exclude`, and global gitconfig excludes
- 10,000 entry cap with `truncated: true` signal
- Relative paths, no symlink following, permission errors skipped
- Runs on `spawn_blocking` to avoid blocking the async runtime
- 9 unit tests (gitignore filtering, cap, hidden dirs, error paths)

### JS: `useNativeWorkspaceFiles.ts`

- Returns stable `WorkspaceFileLister` callback via `useCallback` (DD-010)
- Invokes `list_workspace_files` for `entry.type === "local"` with `localPath`
- Returns `null` for git entries (not on disk at browse time on desktop)

### Wiring (DD-016)

- `SessionPage.tsx` and `SessionLauncher.tsx` pass `workspaceFileLister={useNativeWorkspaceFiles()}`
- Mirrors web pattern: `useGitHubTreeLister(token)` → same prop name, platform-specific hook

### Design decisions (DD-P3-001 through DD-P3-004)

- No new Tauri plugins — no changes to `capabilities/default.json`
- `ignore` crate over `git ls-files` or JS `ignore` package — full gitignore spec, no shell access
- SDK contract unchanged — truncation handled as future UX refinement

## Benefits

- Desktop users can browse local workspace files before and during sessions
- Minimal security surface — JS never touches filesystem; only controlled Rust code reads disk
- No new capability grants or plugin dependencies
- Reuses entire Phase 2 SDK UI stack with zero SDK changes

## Impact

- **Desktop app**: Local workspace entries now show expandable file trees in Setup tab
- **Web app**: Unchanged (already wired via GitHub Trees API)
- **SDK consumers**: Pattern documented — platform hooks implement `WorkspaceFileLister`

## Related Work

- Phase 2: `_changelog/2026-05/2026-05-29-161408-workspace-file-explorer-phase-2.md`
- Phase 4 (deferred): `_cursor/phase-4-workspace-file-references.md` — drag-to-reference
- Design doc: `_cursor/phase-3-desktop-workspace-files-design.md` (local, gitignored)

---

**Status**: Production Ready
**Timeline**: Single session
