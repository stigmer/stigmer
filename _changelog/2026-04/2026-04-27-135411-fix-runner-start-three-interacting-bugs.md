# Fix Runner Start: Three Interacting Bugs

**Date**: April 27, 2026

## Summary

Fixed three interacting bugs that caused the desktop app's "Start Runner" button to silently fail: a missing `--org` CLI flag that sent registrations to the wrong organization, a fire-and-forget sidecar that returned success before the CLI finished registering, and missing event listeners that swallowed async errors.

## Problem Statement

Clicking "Start Runner" in the desktop app appeared to do nothing — no error, no runner, no feedback. The backend logs showed a `PERMISSION_DENIED` error for `can_create_runner` on the wrong organization, but the desktop app never surfaced this to the user.

### Pain Points

- The CLI's `stigmer up runner` command had no `--org` flag, so the org passed by the desktop sidecar was rejected by Cobra. The CLI fell back to `~/.stigmer/config.yaml`, which had a different org where the user lacked membership.
- The Tauri `start_runner` command returned `Ok(runner_name)` immediately after spawning the CLI child process, before registration completed. The frontend received "success" and closed the dialog.
- When the CLI failed asynchronously (seconds later), the `runner:stopped` event was emitted but nothing in the UI was listening for it — the dialog was already closed.

## Solution

Three targeted fixes across CLI (Go), desktop backend (Rust), and desktop frontend (TypeScript):

## Implementation Details

### Bug 1: Added `--org` flag to CLI

- `client-apps/cli/cmd/stigmer/root/up.go` — Added `--org` flag to both `stigmer up` and `stigmer up runner` commands
- `client-apps/cli/internal/cli/runner/start.go` — Added `OrgOverride` to `StartOptions`
- `client-apps/cli/internal/cli/runner/backend_info.go` — Added `OrgOverride` to `ResolveOptions`, used as highest priority in `resolveOrg()`

### Bug 2: Sidecar grace period for early failure detection

- `client-apps/desktop/src-tauri/src/sidecar.rs` — After spawning the CLI, the `start_runner` command now waits up to 8 seconds. If the CLI exits with non-zero during that window, stderr is collected and returned as `Err(detail)`. The runner is only registered as "managed" after surviving the grace period. Captured stderr lines are replayed into the log buffer.

### Bug 3: Async error listeners in the UI

- `client-apps/desktop/src/pages/runners/RunnersPage.tsx` — Added `useEffect` that listens for `runner:stopped` (non-zero exit code) and `runner:error` events. When the most recently launched runner fails, the error is surfaced via `setLaunchError`.

### Tauri sidecar name collision (bonus)

- Renamed sidecar from `stigmer` to `stigmer-cli` across `tauri.conf.json`, `sidecar.rs`, and the on-disk symlink to resolve the Tauri v2 build error that forbids a sidecar sharing the Cargo package name.

## Benefits

- **Start Runner works**: The correct org is sent to the backend, so `can_create_runner` authorization succeeds for the user's own organization
- **Errors are visible**: Registration failures surface in the Start Runner dialog instead of being silently swallowed
- **Defense-in-depth**: Even if the CLI fails after the 8-second grace period, the event listener catches it and surfaces the error

## Impact

- **Direct users**: "Start Runner" now works correctly when the user's config context org differs from their active desktop org
- **Platform builders**: The `--org` flag is available for any integration that spawns the CLI with explicit org context
- **CLI users**: `stigmer up --org <slug>` is now a valid invocation, useful in CI/CD scripts

---

**Status**: ✅ Production Ready
