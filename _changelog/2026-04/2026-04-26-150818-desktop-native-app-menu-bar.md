# Desktop Native App Menu Bar

**Date**: April 26, 2026

## Summary

Added a native macOS app menu bar to the Stigmer desktop app, replacing the default Tauri menu that showed the Cargo crate name ("stigmer-desktop") with a proper branded menu including About Stigmer (with app icon, version, and copyright), Check for Updates, and standard Edit/Window submenus.

## Problem Statement

The Stigmer desktop app had no custom native app menu bar. Tauri's default fallback menu derived names from the Cargo binary name (`stigmer-desktop`), resulting in a menu bar and About dialog that showed the wrong product name, a generic folder icon, and no copyright information. The "Check for Updates" option was only reachable from the system tray, not from the standard macOS app menu where users expect it.

### Pain Points

- macOS menu bar displayed "stigmer-desktop" instead of "Stigmer"
- About dialog showed a generic blue folder icon instead of the Stigmer app icon
- No "Check for Updates" option in the app menu (only in the system tray)
- Missing standard Edit submenu meant Cmd+C/V/X relied on implicit Tauri defaults
- No Window submenu for standard macOS window management

## Solution

Created a new Rust module (`menu.rs`) that builds and installs a proper native app menu bar during Tauri's `setup` phase. The menu reuses the existing `check-for-update` Tauri event that the system tray and `useAppUpdater.ts` already handle, requiring zero frontend changes.

## Implementation Details

### New module: `client-apps/desktop/src-tauri/src/menu.rs`

Builds three submenus using Tauri 2's `SubmenuBuilder` API:

- **Stigmer** (app submenu): About Stigmer, Check for Updates..., Services, Hide/Hide Others/Show All, Quit
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **Window**: Minimize, Close Window

The About, Hide, and Quit items are created via `PredefinedMenuItem::about()`, `::hide()`, and `::quit()` with explicit label overrides (e.g. `Some("About Stigmer")`). This is necessary because the default labels derive from the macOS process name, which in dev mode is the Cargo binary name (`stigmer-desktop`). The label override ensures correct branding in both dev and production builds while retaining native OS behavior (About panel, app hide, app quit).

The About metadata includes the app name, version (from `app.config().version`), copyright, and the app icon (via `include_bytes!`).

Exports two public functions: `setup_app_menu()` (called during setup) and `handle_menu_event()` (called from the builder's `on_menu_event` handler).

### Wiring in `lib.rs`

Three surgical changes: `mod menu;` declaration, `.on_menu_event()` handler on the builder chain, and `menu::setup_app_menu(app)?;` call in the setup closure alongside the existing tray setup.

### What was NOT changed

- System tray menu remains exactly as-is (serves different purpose: runner status + quick actions)
- No frontend changes (existing `useAppUpdater.ts` already handles `check-for-update` events)
- No new Cargo dependencies (all APIs from `tauri` crate with existing `image-png` feature)
- No new capabilities (menu APIs are part of `core:default`)

## Benefits

- **Correct branding**: Menu bar and About dialog show "Stigmer" with the proper app icon
- **Standard macOS UX**: About, Check for Updates, Services, Hide/Show/Quit follow macOS conventions
- **Edit shortcuts**: Explicit Edit submenu ensures Cmd+C/V/X work reliably across all platforms
- **Zero duplication**: "Check for Updates" shares the same Tauri event as the tray menu

## Impact

- **Desktop users**: Professional, branded app menu matching macOS conventions (like Slack, VS Code, etc.)
- **Maintainers**: Menu definition is a single self-contained module with no cross-cutting dependencies

## Related Work

- Desktop auto-updater and distribution pipeline (2026-04-23)
- Desktop shell rebuild and SDK section extraction (this session)
- System tray implementation in `tray.rs`

---

**Status**: Production Ready
**Timeline**: < 30 minutes
