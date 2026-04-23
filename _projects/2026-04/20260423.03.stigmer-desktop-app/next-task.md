# Next Task: 20260423.03.stigmer-desktop-app

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Stigmer Desktop App

**Description**: Build the Stigmer Desktop application using Tauri 2.x (Rust shell + React web frontend). Full web console experience natively — sessions, agents, runner management, settings — plus native OS integration: stigmer:// URL scheme, system tray, background runner processes, native notifications, auto-updates.
**Goal**: Ship a native desktop app on macOS, Linux, and Windows that provides everything the web console offers, plus OS-level integration that browsers cannot. Distributed via website download and package managers (Homebrew, winget).
**Tech Stack**: Tauri 2.x (Rust), TypeScript/React (@stigmer/react SDK, @stigmer/typescript SDK), Go (CLI sidecar)
**Components**: client-apps/desktop (new), sdk/react (reused), sdk/typescript (reused), client-apps/cli (bundled as sidecar)

## Current State

- **Status**: T06 complete, ready for T04
- **Last Session**: 2026-04-23 — T06 complete (CLI sidecar integration for runner management)
- **Active Task**: T04 (next)

## Task Overview

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Tauri project scaffolding | **Complete** | None |
| T03 | Core app shell (routing, layout, auth) | **Complete** | T02 |
| T04 | System tray integration | Pending | T03 |
| T05 | `stigmer://` URL scheme handling | Pending | T03, Phase 3 T02 |
| T06 | Sidecar — bundle CLI for runner management | **Complete** | T03 |
| T07 | Auto-updater & distribution pipeline | Pending | T06 |
| T08 | Desktop-specific features (file picker, notifications) | Pending | T03 |
| T09 | End-to-end testing & polish | Pending | All |

## Session Progress (2026-04-23, Session 3)

### T06: Sidecar — Bundle CLI for Runner Management (completed)

Bundled the Go CLI binary as a Tauri sidecar and built a Rust process manager + React hook integration layer so the desktop app can start, stop, monitor, and stream logs from local runner processes.

#### Rust Layer (`src-tauri/`)

- **`sidecar.rs`** (~350 lines) — Process manager that spawns/kills CLI child processes, tracks PIDs in memory, captures stdout/stderr into a 2000-line ring buffer, reads `~/.stigmer/runners/*.json` state files directly from Rust (no CLI spawn needed for listing), reaps stale processes (dead PIDs), and emits lifecycle events (`runner:started`, `runner:log`, `runner:stopped`, `runner:error`) to the frontend. Five Tauri commands exposed: `start_runner`, `stop_runner`, `stop_all_runners`, `list_local_runners`, `get_runner_logs`.
- **`lib.rs`** — Registers `tauri-plugin-shell`, manages `ProcessManager` state, wires all commands, and handles graceful shutdown on `ExitRequested` (SIGTERM → 3s wait → SIGKILL).

#### Configuration

- **`Cargo.toml`** — Added `tauri-plugin-shell`, `tokio`, `dirs`, `log`, `hostname`, `libc`.
- **`tauri.conf.json`** — Added `bundle.externalBin: ["binaries/stigmer"]`.
- **`capabilities/default.json`** — Scoped `shell:allow-spawn` and `shell:allow-execute` permissions for the stigmer sidecar with regex arg validators.
- **`package.json`** — Added `@tauri-apps/plugin-shell`.

#### Dev Workflow

- **`scripts/setup-sidecar-dev.sh`** — Finds the CLI binary (Bazel output → GOPATH → system PATH) and creates a target-triple symlink at `src-tauri/binaries/stigmer-<triple>`.
- **`binaries/.gitignore`** — Platform-specific binaries are ignored; created by the dev script, injected by CI for production.

#### React Hooks (`src/hooks/`)

- **`tauri.ts`** — Typed wrappers for all five `invoke()` commands and four `listen()` event subscriptions matching the Rust struct shapes exactly.
- **`useLocalRunners.ts`** — Fetches local runner state on mount, auto-refreshes on `runner:started`/`runner:stopped` events. Returns a name-keyed `Map` for efficient lookup.
- **`useStartRunner.ts`** — Async callback with loading/error state. Detects auth errors and surfaces a clear onboarding message about `stigmer auth login`.
- **`useStopLocalRunner.ts`** — Async callback with loading/error state.
- **`useRunnerLogs.ts`** — Fetches initial log buffer, subscribes to live `runner:log` events, caps at 2000 lines.

#### Enhanced Settings > Runners Page

- **`SettingsRunners.tsx`** (rewritten from 11-line wrapper to ~300 lines) — Unified runner list composing `useRunnerList` (SDK, server-side) with `useLocalRunners` (desktop, local processes). Shows "Local" badge on locally-running processes, "Start Runner" button with dialog, per-runner Stop and Logs actions, auth error banner with guidance, streaming log viewer panel.
- **`StartRunnerDialog.tsx`** — Modal for starting a runner with optional name/endpoint/token fields.
- **`RunnerLogViewer.tsx`** — Side panel with live-streaming log output, auto-scrolling, and "Live" indicator.

### Key Decisions

- **DD-T06-01: CLI handles its own credentials** — No credential-bridging from desktop OAuth to CLI. The sidecar uses the CLI's existing resolution chain (`--token` flag > `STIGMER_API_KEY` env > `~/.stigmer/config.yaml`). Throwaway auth plumbing avoided; Phase 3 launch token API will be the clean solution.
- **DD-T06-02: Unified runner view with local awareness** — Single list from server API augmented with local process badges, not two separate sections. Avoids duplicate entries and matches user mental model.
- **DD-T06-03: Process manager, not command runner** — Rust layer manages long-running child processes with PID tracking, ring buffers, and events, not one-shot command execution.
- **DD-T06-04: Dev symlink workflow** — Local binary symlink for development; production cross-compilation deferred to T07.

### Surprises Discovered

1. CLI's `stigmer up runner` does NOT have a `--runtime` flag (Docker is Phase 3 T03). Sidecar command signature omits `runtime`.
2. Python bootstrap latency is significant on first run (minutes). Log viewer streams progress naturally.
3. `list runners` CLI command is local-only (`~/.stigmer/runners/*.json`); Rust reads files directly rather than spawning CLI.

### Files Changed

- 1 new Rust module (`sidecar.rs`, ~350 lines)
- 1 rewritten Rust entry (`lib.rs`)
- 5 new React hook files (`tauri.ts`, `useLocalRunners.ts`, `useStartRunner.ts`, `useStopLocalRunner.ts`, `useRunnerLogs.ts`)
- 3 new React component files (`SettingsRunners.tsx` rewritten, `StartRunnerDialog.tsx`, `RunnerLogViewer.tsx`)
- 1 new dev script (`setup-sidecar-dev.sh`)
- 5 config files modified (`Cargo.toml`, `package.json`, `tauri.conf.json`, `capabilities/default.json`, plus Cargo.lock/gen schemas auto-updated)
- Rust: zero `cargo clippy` warnings
- TypeScript: zero `tsc` errors

## Next Steps

1. **T04: System tray integration** — Native tray icon, runner status indicators (leveraging local runner state from T06), quick actions (Start/Stop runner, Open Stigmer, Settings, Quit)
2. **T08: Desktop-specific features** — Native file picker for workspace selection, native notifications for runner events, keyboard shortcuts
3. **T07: Auto-updater & distribution pipeline** — Cross-platform CLI compilation, `.dmg`/`.AppImage`/`.msi` builds, update manifest hosting (depends on T06 for sidecar bundling)
4. **T05: `stigmer://` URL scheme** — Deep linking (blocked on Phase 3 T02 launch tokens)

## Context for Resume

- The desktop app now has full local runner management via the CLI sidecar
- `ProcessManager` in Rust tracks all runners spawned by the desktop app (child processes with PID, log buffer, lifecycle events)
- Local runner state files (`~/.stigmer/runners/*.json`) are read directly by Rust — no CLI spawn needed for listing
- The `start_runner` command accepts optional `endpoint` and `token` — forward-compatible with Phase 3 launch token exchange
- Auth error detection in `useStartRunner` checks for CLI auth failure patterns and shows an onboarding guide
- The `SettingsRunners` page composes SDK's `useRunnerList` (server) with desktop's `useLocalRunners` (local) for a unified view
- Graceful shutdown on app exit sends SIGTERM to all managed runners, waits 3s, then SIGKILL
- Dev workflow: run `./scripts/setup-sidecar-dev.sh` to create the sidecar symlink before `cargo tauri dev`
- Pre-existing typecheck errors in web app (`LibraryBreadcrumbContext`) and `sdk/typescript/src/gen/runner.ts` — not introduced by this work

## Blockers

- Phase 3 project T02 (launch token endpoints) needed for `stigmer://` handler (T05) and seamless runner auth (DD-T06-01 upgrade path)

## Quick Commands

- "Start T04" — Begin system tray integration
- "Show project status" — Get overview of progress
- "Run desktop" — `make desktop-dev` to launch the desktop app (run `./scripts/setup-sidecar-dev.sh` first for sidecar)

---

*This file provides direct paths to all project resources for quick context loading.*
