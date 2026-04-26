# Desktop Updater: Robustness and Discoverability

**Date**: April 26, 2026

## Summary

Made the Stigmer Desktop auto-update mechanism robust and discoverable. The existing Tauri updater pipeline was fully functional but invisible — errors were swallowed silently, there was no version display, and no way for users to manually trigger an update check. This change adds error logging, a version indicator in the sidebar, an "Update available" call-to-action, and a "Check for Updates" item in the system tray menu.

## Problem Statement

After pushing a new version to GitHub Releases, users of Stigmer Desktop had no way to know whether the auto-updater was working, whether an update was available, or how to trigger a check manually.

### Pain Points

- The `useAppUpdater` hook's `catch` blocks silently set status to `"error"` with zero logging — update check failures were completely invisible in DevTools
- No version display anywhere in the app — users had no idea which version they were running
- No "Check for Updates" surface — the only update mechanism was an automatic toast that fired 5 seconds after login and then every 4 hours, easily missed
- The system tray menu had no update-related option despite being the standard location for such actions in desktop apps
- When no update was available, user-initiated checks provided zero feedback — the user couldn't tell if the check completed or failed

## Solution

Four focused changes across the Rust backend and React frontend that make the existing updater pipeline visible and actionable, without introducing new pages or settings routes.

## Implementation Details

### Hardened `useAppUpdater` hook

- Added `console.warn` with `[updater]` prefix in both `performCheck` and `downloadAndRelaunch` catch blocks for DevTools diagnostics
- Exposed `availableVersion: string | null` in the hook's return type so the sidebar can display the available version
- Added `userInitiated` parameter to `performCheck` — automatic checks remain silent on no-update/error; user-initiated checks show a "You're on the latest version" success toast or an error toast
- Registered a Tauri event listener for `check-for-update` (emitted by the tray menu) that triggers a user-initiated check, bridging the Rust tray menu to the JS updater
- Exported `UpdateStatus` and `AppUpdaterState` types for the context layer

### AppUpdaterContext

Created a thin React context (`AppUpdaterContext.tsx`) that wraps `useAppUpdater` and provides its state to any descendant component. Mounted in `App.tsx` inside `StigmerProvider` but above `OrgProvider` and `RouterProvider`. Follows the same pattern as the existing `OrgProvider` context.

### Sidebar version footer

- Calls `getVersion()` from `@tauri-apps/api/app` on mount to read the compiled-in version
- Displays `v0.0.97` in `sidebar-muted-foreground` at `text-[0.65rem]` — information-dense but not noisy
- When an update is available, replaces the version with a clickable "Update available: vX.Y.Z" button using `sidebar-primary` color and an `ArrowUpCircle` icon. Clicking it re-triggers the toast with "Restart to Update"
- All colors use `sidebar-*` tokens — zero hardcoded values

### Tray menu "Check for Updates..."

- Added a `check_updates` menu item in `build_menu` (Rust), placed between "Open Stigmer" and "Quit Stigmer" with an ellipsis suffix following platform convention
- On click, the handler brings the main window to the foreground and emits a `check-for-update` event to the webview
- The frontend listener in `useAppUpdater` picks up the event and runs a user-initiated check with full toast feedback

## Benefits

- **Diagnosability**: Update check failures are now logged to the console with the error object, making it trivial to debug in DevTools
- **Discoverability**: Users always see their current version in the sidebar footer and get a prominent call-to-action when an update is available
- **User control**: Users can manually trigger an update check from the system tray or by clicking the sidebar update indicator — they are not dependent on the automatic timer
- **Feedback loop**: User-initiated checks always provide feedback — success, update available, or error — so users know the check completed

## Impact

- **Files changed**: 5 (4 modified, 1 new)
  - `client-apps/desktop/src/hooks/useAppUpdater.ts` — hardened hook
  - `client-apps/desktop/src/hooks/AppUpdaterContext.tsx` — new context provider
  - `client-apps/desktop/src/App.tsx` — wired context provider
  - `client-apps/desktop/src/shell/Sidebar.tsx` — version footer
  - `client-apps/desktop/src-tauri/src/tray.rs` — tray menu item + event emission
- **Users affected**: All Stigmer Desktop users
- **Breaking changes**: None — the hook's existing return type is extended, not changed

## Related Work

- [Desktop Auto-Updater Distribution Pipeline](2026-04-23-183714-desktop-auto-updater-distribution-pipeline.md) — the original updater pipeline this change improves
- [Desktop System Tray Integration](2026-04-23-175303-desktop-system-tray-integration.md) — the tray infrastructure extended here

---

**Status**: ✅ Production Ready
