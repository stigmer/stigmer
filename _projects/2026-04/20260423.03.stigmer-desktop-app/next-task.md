# Next Task: 20260423.03.stigmer-desktop-app

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Stigmer Desktop App

**Description**: Build the Stigmer Desktop application using Tauri 2.x (Rust shell + React web frontend). Full web console experience natively — sessions, agents, runner management, settings — plus native OS integration: stigmer:// URL scheme, system tray, background runner processes, native notifications, auto-updates.
**Goal**: Ship a native desktop app on macOS, Linux, and Windows that provides everything the web console offers, plus OS-level integration that browsers cannot. Distributed via website download and package managers (Homebrew, winget).
**Tech Stack**: Tauri 2.x (Rust), TypeScript/React (@stigmer/react SDK, @stigmer/typescript SDK), Go (CLI sidecar)
**Components**: client-apps/desktop (new), sdk/react (reused), sdk/typescript (reused), client-apps/cli (bundled as sidecar)

## Current State

- **Status**: T04 complete, ready for T08
- **Last Session**: 2026-04-23 — T04 complete (system tray integration)
- **Active Task**: T08 (next)

## Task Overview

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Tauri project scaffolding | **Complete** | None |
| T03 | Core app shell (routing, layout, auth) | **Complete** | T02 |
| T04 | System tray integration | **Complete** | T03 |
| T05 | `stigmer://` URL scheme handling | Pending | T03, Phase 3 T02 |
| T06 | Sidecar — bundle CLI for runner management | **Complete** | T03 |
| T07 | Auto-updater & distribution pipeline | Pending | T06 |
| T08 | Desktop-specific features (file picker, notifications) | Pending | T03 |
| T09 | End-to-end testing & polish | Pending | All |

## Session Progress (2026-04-23, Session 4)

### T04: System Tray Integration (completed)

Added a native system tray to the desktop app with a dynamic menu reflecting runner state, hide-to-tray window behavior, and quick actions (stop runners, open window, quit).

#### New: `tray.rs` (~120 lines)

The tray module, entirely Rust-side with no frontend changes needed:

- **`setup_tray`** — Creates the tray icon during app setup via `TrayIconBuilder`. Embeds the existing `icon.png` at compile time using `include_bytes!`. Sets up the menu event handler (Open / Stop All / Quit) and enables `show_menu_on_left_click` for macOS menu bar compatibility.
- **`refresh_tray_state`** — Called after every runner state change. Uses a non-blocking `try_lock()` on `ProcessManager` to read runner names (skips gracefully if contended — the next state change triggers another refresh). Updates tooltip ("Stigmer — Idle" or "Stigmer — N runners active") and rebuilds the menu.
- **`build_menu`** — Constructs the native menu dynamically. When idle: "No active runners" (disabled). When runners active: each runner name as a disabled status item, plus "Stop All Runners". Always includes "Open Stigmer" and "Quit Stigmer".
- **`show_main_window`** — Brings the main window back from hidden state (show + unminimize + focus).

#### Modified: `lib.rs`

- Added `mod tray;` and `.setup()` hook calling `tray::setup_tray(app)`.
- Added `WindowEvent::CloseRequested` handler: `api.prevent_close()` + `window.hide()` for hide-to-tray behavior.
- Existing `ExitRequested` handler preserved for runner cleanup on quit.

#### Modified: `sidecar.rs`

- Added `ProcessManager::runner_names()` — non-blocking `try_lock` method exposing runner names to the tray without risk of deadlock.
- Added `stop_all_managed()` — shared async helper used by both the Tauri command and the tray menu's "Stop All Runners" action. Eliminates duplicated stop logic.
- Refactored `stop_all_runners` command to delegate to `stop_all_managed`.
- Restructured `stop_runner` to release the ProcessManager lock before calling `refresh_tray_state` (prevents lock contention with `try_lock`).
- Added `refresh_tray_state` calls at all state change points: after start, after terminate, after stop, and inside `stop_all_managed`.

#### Modified: `Cargo.toml`

- Added `tray-icon` and `image-png` features to the `tauri` dependency (pulled `tray-icon v0.21.3`, `image v0.25.10`, `png v0.18.1` as transitive deps).

### Key Decisions

- **DD-T04-01: Tray is a Rust-only concern** — No Tauri commands exposed to frontend, no React hooks created. The tray reads from `ProcessManager` (Rust state) and controls the native window (Rust API). Adding a JS bridge would be unnecessary complexity.
- **DD-T04-02: Refresh-on-change, not polling** — Tray menu is rebuilt when runner state changes, not on a timer. Event-driven, zero-overhead when idle.
- **DD-T04-03: Single icon, status in tooltip and menu** — Single tray icon (Stigmer logo) for v1. Status communicated via tooltip text and menu items. Icon state variants (green/red dot overlays) deferred to a polish pass with designer-created assets.
- **DD-T04-04: Hide-to-tray on window close** — Closing the window hides it to tray; runners continue running. "Quit Stigmer" in tray menu is the only exit path, triggering the existing `ExitRequested` → `shutdown_all_sync` flow.
- **DD-T04-05: Programmatic tray, not declarative config** — Tray created entirely in Rust code via `TrayIconBuilder`, not via `tauri.conf.json` `trayIcon` config. Declarative config would create a duplicate tray icon since we need programmatic control for dynamic menus and event handlers.
- **DD-T04-06: Non-blocking lock for tray refresh** — `runner_names()` uses `try_lock()` instead of `lock().await` to avoid deadlocks when called from both sync (tray event handlers) and async (sidecar commands) contexts. If contended, the refresh is skipped — the next state change will trigger another.

### Surprises Discovered

1. Tauri 2's `tray-icon` is a Cargo feature on `tauri`, not a separate plugin. No `tauri-plugin-tray` crate exists.
2. `tauri.conf.json` `trayIcon` config creates the tray declaratively — using it alongside programmatic `TrayIconBuilder` would create duplicate icons.
3. `stop_all_runners` held the `ProcessManager` lock for the entire stop loop including event emissions. Refactored to `stop_all_managed` with explicit `drop(runners)` before `refresh_tray_state` to prevent deadlock with `try_lock`.
4. `stop_runner` similarly held the lock through the emit+return path. Restructured to scope the lock guard tightly, releasing before calling refresh.

### Files Changed

- 1 new Rust module (`tray.rs`, ~120 lines)
- 2 modified Rust files (`lib.rs` expanded from 27→41 lines, `sidecar.rs` restructured with ~50 lines net additions)
- 1 config file modified (`Cargo.toml`, added 2 features)
- Auto-updated: `Cargo.lock` (5 new transitive dependencies)
- Zero frontend changes
- Rust: zero `cargo clippy` warnings
- TypeScript: zero `tsc` errors

## Next Steps

1. **T08: Desktop-specific features** — Native file picker for workspace selection, native notifications for runner events (leveraging tray infrastructure), keyboard shortcuts
2. **T07: Auto-updater & distribution pipeline** — Cross-platform CLI compilation, `.dmg`/`.AppImage`/`.msi` builds, update manifest hosting
3. **T05: `stigmer://` URL scheme** — Deep linking (blocked on Phase 3 T02 launch tokens)
4. **Polish: Tray icon state variants** — Designer-created icons for idle/active/error states, macOS template image support

## Context for Resume

- The desktop app now has a persistent system tray with dynamic runner status
- Hide-to-tray: closing the window hides it; "Quit Stigmer" from the tray menu is the exit path
- `tray::refresh_tray_state` is the single function that syncs tray state — called from every runner lifecycle event in `sidecar.rs`
- `stop_all_managed` is the shared helper for stopping all runners — used by both the Tauri command and tray menu action
- `ProcessManager::runner_names()` uses `try_lock()` for non-blocking access — safe to call from any context
- The tray module has zero dependency on the frontend — purely Rust-side
- Tray menu is fully dynamic: runner items appear/disappear as processes start/stop, "Stop All Runners" only visible when runners exist
- No `tauri.conf.json` changes for tray — everything is programmatic via `TrayIconBuilder`
- Dev workflow: run `./scripts/setup-sidecar-dev.sh` to create the sidecar symlink before `cargo tauri dev`
- Pre-existing typecheck errors in web app (`LibraryBreadcrumbContext`) and `sdk/typescript/src/gen/runner.ts` — not introduced by this work

## Blockers

- Phase 3 project T02 (launch token endpoints) needed for `stigmer://` handler (T05) and seamless runner auth (DD-T06-01 upgrade path)

## Quick Commands

- "Start T08" — Begin desktop-specific features (file picker, notifications, shortcuts)
- "Show project status" — Get overview of progress
- "Run desktop" — `make desktop-dev` to launch the desktop app (run `./scripts/setup-sidecar-dev.sh` first for sidecar)

---

*This file provides direct paths to all project resources for quick context loading.*
