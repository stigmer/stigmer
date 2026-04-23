# Desktop App: CLI Sidecar for Local Runner Management

**Date**: April 23, 2026

## Summary

Added the ability for the Stigmer desktop app to start, stop, monitor, and stream logs from local agent runner processes. This is achieved by bundling the Go CLI binary as a Tauri sidecar, managed through a Rust process manager that bridges to the React frontend via Tauri commands and events.

## Problem Statement

The desktop app had full parity with the web console for server-side operations (sessions, agents, settings) via the TypeScript SDK, but lacked the one capability that makes a native app compelling over a browser: managing local OS processes. Users had to switch to a terminal to run `stigmer up runner`, defeating the purpose of the desktop app.

### Pain Points

- Desktop users had no way to start a local runner from the UI
- No visibility into which runners were local processes on this machine vs remote
- No way to stop a local runner or view its logs without a terminal
- Runner management was disconnected from the rest of the desktop experience

## Solution

Three-layer architecture with strict separation of concerns:

1. **Rust process manager** (`sidecar.rs`) — Owns the child process lifecycle. Spawns the CLI sidecar, tracks PIDs, captures stdout/stderr into ring buffers, reads `~/.stigmer/runners/*.json` state files, and emits lifecycle events.
2. **Tauri commands** — Five commands (`start_runner`, `stop_runner`, `stop_all_runners`, `list_local_runners`, `get_runner_logs`) exposed to the frontend via `invoke()`.
3. **React hooks** — Desktop-specific hooks (`useLocalRunners`, `useStartRunner`, `useStopLocalRunner`, `useRunnerLogs`) wrapping Tauri APIs, composed with the SDK's `useRunnerList` for a unified view.

## Implementation Details

### Rust Layer

- `ProcessManager` holds a `Mutex<HashMap<String, ManagedRunner>>` tracking all desktop-spawned runners
- Each `ManagedRunner` has a `CommandChild` handle, PID, and a 2000-line `VecDeque<String>` log ring buffer
- stdout/stderr are captured asynchronously via `tauri::async_runtime::spawn` and streamed to the frontend as `runner:log` events
- `list_local_runners` reads `~/.stigmer/runners/*.json` directly from Rust (no CLI spawn) and merges with in-memory managed state
- Graceful shutdown on `RunEvent::ExitRequested`: SIGTERM all managed runners, wait 3s, SIGKILL survivors

### Frontend Layer

- `useLocalRunners` fetches state on mount and auto-refreshes on `runner:started`/`runner:stopped` events
- `useStartRunner` detects CLI auth errors and surfaces an onboarding guide
- `SettingsRunners` page composes SDK's server-side runner list with local process awareness: "Local" badge, Stop/Logs actions
- `RunnerLogViewer` shows live-streaming logs with auto-scroll

### Configuration

- `tauri-plugin-shell` registered in Rust and JS
- `bundle.externalBin: ["binaries/stigmer"]` in `tauri.conf.json`
- Scoped `shell:allow-spawn`/`shell:allow-execute` permissions with regex arg validators
- Dev symlink script (`scripts/setup-sidecar-dev.sh`) for local development

### Key Design Decisions

- **CLI handles its own credentials** — No credential-bridging from desktop OAuth to CLI. Phase 3 launch token API will provide the clean solution. Forward-compatible via optional `endpoint`/`token` parameters.
- **Unified runner view** — Single list from server API augmented with local badges, not two sections. Matches user mental model.
- **Process manager pattern** — Long-running child processes managed with PID tracking and ring buffers, not one-shot command execution.

## Benefits

- Desktop users can start, stop, and monitor runners without leaving the app
- Live log streaming surfaces Python bootstrap progress (which can take minutes on first run)
- "Local" badge gives clear visibility into which runners are managed by this machine
- Auth error handling provides clear guidance instead of cryptic failures
- Graceful shutdown prevents zombie Python processes when quitting the app

## Impact

- **Desktop app users**: Full local runner management from the UI
- **T07 (distribution)**: Sidecar bundling is now configured, ready for cross-platform CI
- **T04 (system tray)**: Local runner state is available for tray status indicators
- **Phase 3**: `start_runner` command is forward-compatible with launch token exchange

## Related Work

- T03 (Core app shell) — Foundation this builds on
- T04 (System tray) — Will consume local runner state for status indicators
- T07 (Auto-updater & distribution) — Will add cross-platform CLI compilation
- Phase 3 T02 (Launch tokens) — Will enable seamless auth for runner starts

---

**Status**: Production Ready
**Timeline**: 1 session
