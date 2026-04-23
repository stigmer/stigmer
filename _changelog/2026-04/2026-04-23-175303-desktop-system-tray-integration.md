# Desktop System Tray Integration

**Date**: April 23, 2026

## Summary

Added a native system tray to the Stigmer Desktop app with dynamic runner status, hide-to-tray window behavior, and quick actions. The tray is entirely a Rust-side module — no frontend changes needed — that reflects ProcessManager state in real time through event-driven menu rebuilds.

## Problem Statement

The desktop app managed long-running runner processes but had no persistent presence after the window was closed. Users had no way to monitor runner status at a glance, and closing the window killed all runners.

### Pain Points

- No OS-level visibility of runner status when the app window was minimized or closed
- Closing the window quit the app, killing all managed runner processes
- No quick actions for common operations (stop runners, reopen window) without navigating the full UI

## Solution

A Rust-only tray module (`tray.rs`) that creates a native system tray icon via Tauri's built-in `tray-icon` feature, with a dynamic menu that reflects current runner state. The tray module acts as a read-only view of `ProcessManager` state, updated on every runner lifecycle event.

## Implementation Details

### New Module: `tray.rs` (~120 lines)

Four functions with clear responsibilities:

- **`setup_tray`** — Creates the tray via `TrayIconBuilder` during app setup. Embeds the icon at compile time (`include_bytes!`). Registers menu event handlers for Open, Stop All, and Quit.
- **`refresh_tray_state`** — Called after every runner state change. Uses non-blocking `try_lock()` on ProcessManager to read runner names, rebuilds the menu and tooltip. Skips gracefully if the lock is contended.
- **`build_menu`** — Constructs the native menu dynamically: runner names as disabled status items, "Stop All Runners" (only when active), "Open Stigmer", "Quit Stigmer".
- **`show_main_window`** — Restores the hidden window (show + unminimize + focus).

### Hide-to-Tray Behavior

`lib.rs` now intercepts `WindowEvent::CloseRequested` with `api.prevent_close()` + `window.hide()`. The app stays alive in the tray. "Quit Stigmer" from the tray menu calls `app.exit(0)`, which triggers the existing `ExitRequested` → `shutdown_all_sync` cleanup flow.

### Sidecar Integration

Added `ProcessManager::runner_names()` (non-blocking `try_lock`) and `stop_all_managed()` (shared async helper). Refactored `stop_all_runners` to delegate to the shared helper, eliminating duplicated stop logic. Added `refresh_tray_state` calls at all four runner state change points.

### Lock Safety

The `stop_runner` function was restructured to release the ProcessManager lock before calling `refresh_tray_state`, which itself uses `try_lock()`. This prevents deadlock between the async command handlers and the sync tray refresh.

## Benefits

- **Persistent runner awareness** — Users see runner count in the tooltip and individual runner names in the menu without opening the app
- **Process safety** — Closing the window no longer kills runners; they continue running in the background
- **Quick control** — Stop all runners or reopen the app directly from the tray menu
- **Zero frontend overhead** — No new React hooks, components, or IPC commands; the tray is a pure Rust concern
- **Event-driven updates** — Tray state is always current with zero polling overhead

## Impact

- Desktop app users on macOS, Windows, and Linux get standard tray app behavior matching Docker Desktop, Slack, and similar tools
- Runner processes survive window close, critical for long-running agent execution
- Foundation for future tray enhancements: icon state variants, native notifications (T08)

## Related Work

- [Desktop Sidecar Runner Management](2026-04-23-172611-desktop-sidecar-runner-management.md) — T06 that built the ProcessManager this tray integrates with
- [SDK Session Orchestration & Desktop Shell](2026-04-23-161015-sdk-session-orchestration-desktop-shell.md) — T03 that established the app shell
- [Stigmer Desktop Tauri Scaffolding](2026-04-23-124833-stigmer-desktop-tauri-scaffolding.md) — T02 project foundation

---

**Status**: ✅ Production Ready
**Timeline**: T04 of the Stigmer Desktop App project (20260423.03)
