# Next Task: 20260423.03.stigmer-desktop-app

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Stigmer Desktop App

**Description**: Build the Stigmer Desktop application using Tauri 2.x (Rust shell + React web frontend). Full web console experience natively — sessions, agents, runner management, settings — plus native OS integration: stigmer:// URL scheme, system tray, background runner processes, native notifications, auto-updates.
**Goal**: Ship a native desktop app on macOS, Linux, and Windows that provides everything the web console offers, plus OS-level integration that browsers cannot. Distributed via website download and package managers (Homebrew, winget).
**Tech Stack**: Tauri 2.x (Rust), TypeScript/React (@stigmer/react SDK, @stigmer/sdk), Go (CLI sidecar)
**Components**: client-apps/desktop (new), sdk/react (reused), sdk/typescript (reused), client-apps/cli (bundled as sidecar)

## Current State

- **Status**: T08 complete, ready for T07
- **Last Session**: 2026-04-23 — T08 complete (desktop-specific features)
- **Active Task**: T07 (next)

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
| T08 | Desktop-specific features (file picker, notifications) | **Complete** | T03 |
| T09 | End-to-end testing & polish | Pending | All |

## Session Progress (2026-04-23, Session 5)

### T08: Desktop-Specific Features (completed)

Implemented four desktop-native features: window state persistence, native OS folder picker for workspace selection, native notifications for runner events, and app-level keyboard shortcuts. Background operation (hide-to-tray) was already complete from T04.

#### T08.1: Window State Persistence

Added `tauri-plugin-window-state` to automatically save and restore window size, position, and maximized state across app restarts.

- **`Cargo.toml`** — Added `tauri-plugin-window-state = "2"` (resolved to v2.4.1).
- **`lib.rs`** — Registered `tauri_plugin_window_state::Builder::default().build()`. Added explicit `save_window_state(StateFlags::all())` call in `ExitRequested` handler — necessary because we `prevent_close()` and hide the window to tray, so the plugin's automatic save-on-close may not trigger.
- **`capabilities/default.json`** — Added `window-state:default` permission.
- **`routes.tsx`** — Added route persistence via `localStorage`. `router.subscribe()` saves the current path on every navigation. On app startup, `router.navigate()` restores the last-viewed page (skips `/` index since that's the default). Pure React, no Tauri plugin needed.

#### T08.2: Native Folder Picker for Workspace Selection

Two-layer implementation: SDK extension point + desktop integration.

**SDK change (`@stigmer/react`):**
- **`WorkspaceEditor.tsx`** — Added `onBrowseLocalFolder?: () => Promise<string | null>` prop. When provided and `enableLocal` is true, clicking "Local Folder" invokes the callback directly (opening a native OS dialog) instead of showing the manual text input. Includes `isBrowsing` state for UX feedback ("Opening…" label while dialog is open). Falls back to existing text input when the callback is not provided (backward compatible for web environments).
- **`SessionComposer.tsx`** — Threaded `onBrowseLocalFolder` prop through to `WorkspaceEditor`.

**Desktop integration:**
- **`Cargo.toml`** — Added `tauri-plugin-dialog = "2"` (resolved to v2.7.0).
- **`lib.rs`** — Registered `tauri_plugin_dialog::init()`.
- **`capabilities/default.json`** — Added `dialog:default` permission.
- **`package.json`** — Added `@tauri-apps/plugin-dialog`.
- **`useNativeFolderPicker.ts`** (new, 21 lines) — Hook wrapping `open({ directory: true, multiple: false, title: "Select project folder" })`. Returns a stable callback passed as `onBrowseLocalFolder`.
- **`SessionLauncher.tsx`** — Wired `browseLocalFolder` from the hook into `SessionComposer`.

#### T08.3: Native OS Notifications for Runner Events

- **`Cargo.toml`** — Added `tauri-plugin-notification = "2"` (resolved to v2.3.3).
- **`lib.rs`** — Registered `tauri_plugin_notification::init()`.
- **`capabilities/default.json`** — Added `notification:default` permission.
- **`package.json`** — Added `@tauri-apps/plugin-notification`.
- **`useRunnerNotifications.ts`** (new, 91 lines) — Hook that requests notification permission on mount, subscribes to `runner:started`, `runner:stopped`, and `runner:error` Tauri events (already emitted by `sidecar.rs`), and sends OS notifications. Only fires when the window is not focused (`document.hasFocus()` check). Cleanup unsubscribes all listeners.
- **`App.tsx`** — Mounted `useRunnerNotifications()` in `AuthenticatedApp`.

Notification content:
| Event | Title | Body |
|-------|-------|------|
| `runner:started` | Runner Started | `{name}` is now running |
| `runner:stopped` | Runner Stopped | `{name}` has stopped (exit code {code}) |
| `runner:error` | Runner Error | `{name}`: {message} |

#### T08.4: App-Level Keyboard Shortcuts

- **`useAppShortcuts.ts`** (new, 42 lines) — Hook registering `keydown` listener on `document`. Detects `metaKey` (macOS) vs `ctrlKey` (Windows/Linux). Two shortcuts for v1: `Cmd/Ctrl+N` → new session (`/`), `Cmd/Ctrl+,` → settings (`/settings/runners`). Calls `preventDefault()` to suppress default behavior.
- **`AppShell.tsx`** — Mounted `useAppShortcuts()` so shortcuts are active on all pages.

### Key Decisions

- **DD-T08-01: SDK callback pattern for native dialogs** — Added `onBrowseLocalFolder` as an optional callback prop to `WorkspaceEditor` and `SessionComposer` rather than coupling the SDK to any native framework. The callback is the integration seam — Tauri apps pass their native dialog, Electron apps pass theirs, web apps don't pass anything and get the text input. Framework-agnostic, backward-compatible.
- **DD-T08-02: App-level shortcuts over global shortcuts** — Rejected global OS-wide hotkeys (from original T01 plan) in favor of app-level shortcuts. Global shortcuts are aggressive, conflict-prone, and require `tauri-plugin-global-shortcut`. App-level shortcuts follow platform conventions (Cmd+N, Cmd+,), need no Tauri plugin, and don't steal key combinations from other apps.
- **DD-T08-03: Notifications scoped to runner events only** — Execution-level notifications (HITL approval, agent completion) were deferred. Runner events are already emitted as Tauri events from `sidecar.rs` — zero new backend wiring. Execution events would require gRPC stream subscriptions from the frontend, adding complexity and potential notification noise.
- **DD-T08-04: Focus-gated notifications** — Notifications only fire when `document.hasFocus()` is false. No point alerting about something the user is already looking at. Simple, no Tauri window-focus API needed.
- **DD-T08-05: Explicit window state save on exit** — `save_window_state(StateFlags::all())` called in `ExitRequested` handler because `prevent_close()` + hide may prevent the plugin's auto-save. Belt-and-suspenders approach.
- **DD-T08-06: Route persistence via localStorage** — Used `router.subscribe()` + `router.navigate()` on the hash router rather than the window-state plugin's JS API. Pure React, no additional Tauri dependency for this concern. Saves pathname only (not search params or hash), restores on startup with `replace: true`.

### Surprises Discovered

1. `npm install` resolved `@tauri-apps/plugin-dialog: "^2"` to `^2.7.0` in package.json (version pinning behavior differs from Cargo's semver ranges).
2. `tauri-plugin-dialog` pulls `tauri-plugin-fs` as a transitive dependency (used internally for the dialog's file path resolution).
3. Tauri 2's `cargo check` regenerates the capability schema files (`gen/schemas/*.json`) when new plugin permissions are added — these are auto-generated and should be committed.
4. `WorkspaceEditor`'s "Local Folder" button had to handle both sync (toggle panel) and async (browse dialog) paths — solved with a simple `isBrowsing` flag rather than introducing a state machine.

### Files Changed

- 3 new hooks (`useNativeFolderPicker.ts` 21 lines, `useRunnerNotifications.ts` 91 lines, `useAppShortcuts.ts` 42 lines)
- 3 Tauri plugins added (`dialog`, `notification`, `window-state`)
- 2 SDK files modified (`WorkspaceEditor.tsx`, `SessionComposer.tsx`)
- 5 desktop files modified (`lib.rs`, `Cargo.toml`, `capabilities/default.json`, `App.tsx`, `SessionLauncher.tsx`, `AppShell.tsx`, `routes.tsx`, `package.json`)
- Auto-updated: `Cargo.lock`, `package-lock.json`, `yarn.lock`, `gen/schemas/*.json`
- Rust: zero `cargo clippy` warnings
- TypeScript: zero `tsc` errors

## Next Steps

1. **T07: Auto-updater & distribution pipeline** — Cross-platform CLI compilation, `.dmg`/`.AppImage`/`.msi` builds, update manifest hosting, Tauri's built-in updater plugin
2. **T05: `stigmer://` URL scheme** — Deep linking (blocked on Phase 3 T02 launch tokens)
3. **Polish: Tray icon state variants** — Designer-created icons for idle/active/error states, macOS template image support
4. **Polish: Notification click-to-focus** — When user clicks a notification, bring the Stigmer window to focus (requires platform-specific testing)

## Context for Resume

- T08 added three Tauri plugins: `dialog` (v2.7.0), `notification` (v2.3.3), `window-state` (v2.4.1)
- Plugin registration pattern: `.plugin(tauri_plugin_X::init())` in `lib.rs` builder chain, plus capability permission in `capabilities/default.json`
- `onBrowseLocalFolder` is a new public prop on `WorkspaceEditor` and `SessionComposer` in `@stigmer/react` — any platform builder can provide a native folder picker via this callback
- `useRunnerNotifications` subscribes to the same Tauri events (`runner:started`, `runner:stopped`, `runner:error`) that were already emitted by `sidecar.rs` since T06
- Window state plugin saves/restores geometry automatically; explicit `save_window_state()` call in `ExitRequested` handler handles the hide-to-tray edge case
- Route persistence uses `router.subscribe()` / `router.navigate()` on the hash router — stored in `localStorage` under key `stigmer:lastRoute`
- Keyboard shortcuts are React-only (`useEffect` + `keydown` listener), mounted in `AppShell` — no Tauri plugin needed
- Dev workflow unchanged: run `./scripts/setup-sidecar-dev.sh` then `cargo tauri dev`
- Pre-existing typecheck errors in web app (`LibraryBreadcrumbContext`) and `sdk/typescript/src/gen/runner.ts` — not introduced by this work

## Blockers

- Phase 3 project T02 (launch token endpoints) needed for `stigmer://` handler (T05) and seamless runner auth (DD-T06-01 upgrade path)

## Quick Commands

- "Start T07" — Begin auto-updater & distribution pipeline
- "Show project status" — Get overview of progress
- "Run desktop" — `make desktop-dev` to launch the desktop app (run `./scripts/setup-sidecar-dev.sh` first for sidecar)

---

*This file provides direct paths to all project resources for quick context loading.*
