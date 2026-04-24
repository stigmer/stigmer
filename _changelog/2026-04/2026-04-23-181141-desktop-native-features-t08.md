# Desktop-Specific Native Features (T08)

**Date**: April 23, 2026

## Summary

Added four native desktop features to the Stigmer Desktop app: window state persistence across restarts, a native OS folder picker for workspace selection, native OS notifications for runner lifecycle events, and app-level keyboard shortcuts. This also introduced a new SDK extension point (`onBrowseLocalFolder`) that enables any platform builder using a desktop framework to provide native folder picking without coupling the SDK to any specific native API.

## Problem Statement

The desktop app (built in T02–T06) had the core web console experience running in a Tauri shell with system tray and sidecar runner management, but lacked the OS-level integration that makes a native app feel native:

### Pain Points

- Window size and position reset to defaults on every app restart
- Users had to type filesystem paths manually to add local workspace folders — no native folder picker
- Runner events (started, stopped, errored) were only visible inside the app — no OS notifications when the app was minimized or in tray
- No keyboard shortcuts for common actions
- Returning to the app after a restart always landed on the home page, not where the user left off

## Solution

Four independent features implemented as Tauri plugins + React hooks, following the established patterns from T04 (tray) and T06 (sidecar):

1. **Window state persistence** via `tauri-plugin-window-state` with explicit save on exit
2. **Native folder picker** via `tauri-plugin-dialog` with an SDK-level callback prop for framework-agnostic integration
3. **Runner notifications** via `tauri-plugin-notification` with focus-gated delivery
4. **App-level keyboard shortcuts** via pure React `keydown` handlers

## Implementation Details

### Window State Persistence (T08.1)

- `tauri-plugin-window-state` registered in the Tauri builder — automatically saves/restores window geometry
- `save_window_state(StateFlags::all())` called explicitly in `ExitRequested` handler because the hide-to-tray `prevent_close()` pattern may bypass the plugin's automatic save
- Route persistence via `router.subscribe()` on the hash router — saves current pathname to `localStorage`, restores on startup with `replace: true`

### Native Folder Picker (T08.2)

- SDK change: `onBrowseLocalFolder?: () => Promise<string | null>` prop added to `WorkspaceEditor` and `SessionComposer` in `@stigmer/react`. When provided, clicking "Local Folder" invokes the callback directly instead of showing the manual text input. Backward-compatible — web environments without the callback get existing behavior.
- Desktop hook: `useNativeFolderPicker` wraps `@tauri-apps/plugin-dialog`'s `open({ directory: true })` and returns a stable callback matching the prop signature.

### Runner Notifications (T08.3)

- `useRunnerNotifications` hook: requests permission on mount, subscribes to existing `runner:started`, `runner:stopped`, and `runner:error` Tauri events (emitted by `sidecar.rs`), sends OS notifications via `sendNotification()`.
- Focus-gated: only fires when `document.hasFocus()` returns `false` — avoids redundant alerts when the user is already looking at the app.

### Keyboard Shortcuts (T08.4)

- `useAppShortcuts` hook: `keydown` listener on `document`, detects `metaKey` (macOS) vs `ctrlKey` (Windows/Linux). Two shortcuts for v1: `Cmd/Ctrl+N` → new session, `Cmd/Ctrl+,` → settings. Mounted in `AppShell`.
- Rejected global OS-wide shortcuts from the original plan — too aggressive for developer tools, conflict-prone.

## Benefits

- **Native feel**: Window remembers its position, pages persist across restarts, native OS dialogs and notifications
- **SDK extensibility**: `onBrowseLocalFolder` callback pattern available to all platform builders embedding Stigmer in desktop frameworks (Tauri, Electron, etc.)
- **Zero backend changes**: All features are Tauri plugin + React hook combinations wired to existing infrastructure
- **Clean plugin pattern**: Established a repeatable pattern (Cargo dep + plugin registration + capability permission + JS package + React hook) for future Tauri plugin integrations

## Impact

- **Desktop app users**: Significantly improved native experience — the app now behaves like a first-class desktop application rather than a web app in a window
- **SDK platform builders**: New `onBrowseLocalFolder` prop enables native folder selection in any desktop framework without SDK changes
- **Codebase**: 3 new hooks (~154 lines total), 2 SDK files modified with backward-compatible prop additions, 3 Tauri plugins registered

## Related Work

- T04 (system tray): Background operation / hide-to-tray was already complete — T08 builds on top of it
- T06 (sidecar): Runner events emitted by `sidecar.rs` are now consumed by `useRunnerNotifications`
- `@stigmer/react` SDK: The `onBrowseLocalFolder` prop follows DD-001 (SDK-first development) and DD-004 (zero framework deps in SDK)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
