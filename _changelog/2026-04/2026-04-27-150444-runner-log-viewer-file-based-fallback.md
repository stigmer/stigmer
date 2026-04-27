# Runner Log Viewer: File-Based Fallback and UX Fix

**Date**: April 27, 2026

## Summary

Fixed the desktop runner log viewer which permanently displayed "Waiting for output..." for any runner not spawned by the current desktop session. Introduced file-based log persistence in the CLI and a two-tier log sourcing strategy in the desktop app, so logs work for CLI-started, daemon-managed, and desktop-managed runners alike. Also fixed stdout being silently dropped during the sidecar grace period, eliminated unnecessary re-renders from polling, and replaced misleading status messages with context-aware UX.

## Problem Statement

The runner log viewer in the desktop app had three interacting issues:

1. **Permanent "Waiting for output..."** — Logs only worked for runners spawned by the current desktop session's in-memory `ProcessManager`. Runners started from the CLI (`stigmer up`) or surviving a desktop restart had no log source, yet the UI showed a "Live" indicator and "Waiting for output..." forever.

2. **Grace period stdout drop** — During the 8-second startup grace period, the Rust sidecar captured stderr but silently discarded stdout. Any output the CLI or Python runner produced on stdout during this window was lost.

3. **Polling-induced re-renders** — The 5-second runner list poll created new runner object references on every cycle, causing the log viewer header to re-render visibly even though the log content was stable.

### Pain Points

- Users could not understand where logs came from or why the panel was always empty
- The "Live" indicator was misleading — it showed even when no log source existed
- The log panel header flickered during transitional polling, giving the impression of instability

## Solution

### CLI log file persistence (Go)

The CLI runner now tees stdout+stderr to `~/.stigmer/runners/<name>.log` using `io.MultiWriter`. A `cappedWriter` limits the file to 2 MiB. The `RunnerState` JSON includes a `log_file` field pointing to the absolute path. `RemoveState()` cleans up both `.json` and `.log` files.

### Tauri file-tail commands (Rust)

Two new Tauri commands:
- `tail_runner_log_file` — reads the last N lines from the on-disk log file
- `watch_runner_log_file` — polls the file every 500ms and emits `runner:log-file` events for new lines, stopping when the runner's state file disappears

### Two-tier log sourcing (TypeScript)

`useRunnerLogs` now attempts the ProcessManager buffer first (fast path for desktop-managed runners), falls back to file tail (for CLI-started or daemon-managed runners), and reports `"unavailable"` if neither exists. A new `LogSource` type (`"idle" | "connecting" | "process" | "file" | "unavailable"`) drives context-aware rendering.

### Grace period stdout capture (Rust)

The sidecar grace period loop now captures both stdout and stderr into a combined `early_output` vector, which is replayed into the log buffer after registration.

### Stable log viewer rendering (React)

The `logRunner` reference is stabilized via a ref-based memoization that only updates when phase, execution count, or runner version actually change. `RunnerLogViewer` is wrapped in `React.memo`.

## Files Changed

### CLI (Go)
- `client-apps/cli/internal/cli/runner/state.go` — `LogFile` field, `LogFilePath()` helper, log cleanup in `RemoveState()`
- `client-apps/cli/internal/cli/runner/start.go` — `openRunnerLogFile()`, `cappedWriter`, `io.MultiWriter` tee in `startPythonProcess`, state population in both native and Docker paths

### Desktop Sidecar (Rust)
- `client-apps/desktop/src-tauri/src/sidecar.rs` — `log_file` in state/info structs, stdout capture in grace period, `tail_runner_log_file` and `watch_runner_log_file` commands
- `client-apps/desktop/src-tauri/src/lib.rs` — command registration

### Desktop Frontend (TypeScript/React)
- `client-apps/desktop/src/hooks/tauri.ts` — `log_file` in `LocalRunnerInfo`, `invokeTailRunnerLogFile`, `invokeWatchRunnerLogFile`, `onRunnerLogFile`
- `client-apps/desktop/src/hooks/useRunnerLogs.ts` — complete rewrite with two-tier strategy and `LogSource` type
- `client-apps/desktop/src/pages/runners/RunnerLogViewer.tsx` — `React.memo`, `SourceIndicator`, `EmptyState` with four context-specific messages
- `client-apps/desktop/src/pages/runners/RunnersPage.tsx` — stable `logRunner` reference via ref-based memoization

## Benefits

- Runner logs now work for **any** local runner (CLI-started, daemon-managed, desktop-managed, or surviving a restart)
- Clear, actionable status messages replace the misleading "Waiting for output..."
- The "Live" indicator only appears when there is an active log source
- Log viewer header no longer flickers during runner list polling
- CLI startup output (stdout) is no longer lost during the grace period

## Impact

- **Desktop users**: Logs panel immediately useful instead of permanently empty
- **CLI users**: Runner output persisted to disk for the first time — enables debugging and external tooling
- **Future work**: File-based logs lay groundwork for server-side log shipping and SDK-level `RunnerLogViewer`

---

**Status**: ✅ Production Ready
