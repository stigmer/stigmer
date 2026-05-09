# Runner Local Control Socket and State Directory Migration

**Date**: May 9, 2026

## Summary

Added a local control socket to the Stigmer runner process, replacing PID-based liveness probing with verified HTTP health checks over a Unix domain socket. Migrated the runner state file layout from hostname-slug keys to stable machine_id keys. These changes eliminate PID-reuse false positives, enable graceful shutdown without signal escalation, and align the on-disk file identity model with the stable machine identity introduced in T03.

## Problem Statement

The runner's cross-process coordination relied entirely on PID probing (`kill -0`), which has fundamental limitations for a platform of this scale.

### Pain Points

- **PID reuse**: `signal 0` cannot distinguish a Stigmer runner from an unrelated process that inherited the same PID after a crash, leading to false "already running" adoptions
- **No health verification**: A process responding to `signal 0` might be stuck, in the wrong org, or running an incompatible version — PID probing can't tell
- **Signal-based stop is fire-and-forget**: `SIGTERM` provides no acknowledgment that the runner received and accepted the shutdown request
- **Unstable file keys**: State files keyed by hostname-slug (`<hostname>.json`) break when the machine's hostname changes, creating orphaned state files

## Solution

Two complementary improvements, both additive and backward-compatible:

1. **HTTP-over-Unix-domain-socket control server** — Each running runner binds a Unix socket at `~/.stigmer/run/runner.sock` and serves two HTTP endpoints (`GET /status`, `POST /stop`). Other processes query this socket to get verified, live runner identity and request graceful shutdown with acknowledgment.

2. **State directory migration** — State files rename from `<hostname-slug>.json` to `<machine_id>.json` on startup, aligning file identity with the stable `machine_id` model. The migration is idempotent and safe (copy-then-remove, never overwrites existing files).

## Implementation Details

### New sub-package: `runner/controlsock`

Three production files and one test file implementing the socket server and client:

- **`server.go`**: HTTP server bound to a Unix domain socket. Creates `~/.stigmer/run/` with 0700 permissions, removes stale socket files before binding (crash recovery), sets 0600 on the socket file. `GET /status` returns live runner identity as JSON. `POST /stop` acknowledges the request, then cancels the runner's context asynchronously.
- **`client.go`**: `Ping()` queries status, `Stop()` sends graceful shutdown, `IsHealthy()` is a boolean convenience. All calls have a 2-second timeout to avoid blocking on dead sockets.
- **`types.go`**: `StatusResponse`, `StopResponse`, `ErrorResponse` — clean JSON contracts.

### State migration

- `RunnerState` gains `SocketPath string` field (omitted when empty for backward compat)
- `RunDir()` / `DefaultSocketPath()` provide the runtime artifact directory
- `MigrateStateLayout()` scans `~/.stigmer/runners/`, renames slug-keyed files to machine_id-keyed, including associated log files
- `RemoveState()` now cleans up associated socket files

### Lifecycle integration

- `startNativeRunner()` creates and starts a `controlsock.Server` before `SaveState()`, records `SocketPath` in state
- `waitForExitOrSignal()` gains a `stopCh` channel — the control socket's stop handler sends to this channel, triggering the same SIGTERM-then-SIGKILL escalation used for OS signals
- Server is shut down after the runner process exits, removing the socket file

### Socket-aware adoption and stop

- `isRunnerAlive()` prefers socket health check when `SocketPath` is present, falls back to PID probe for startup races and pre-T04 runners
- `stopNativeRunner()` attempts `controlsock.Stop()` first, falls back to SIGTERM for pre-T04 runners

## Benefits

- **Eliminates PID-reuse false positives**: Socket response proves the process is a Stigmer runner with verifiable identity (runner_id, org, machine_id)
- **Health verification**: Socket response includes uptime, version, and task queue — richer than a boolean "alive" signal
- **Graceful shutdown with acknowledgment**: `POST /stop` returns 200 before initiating shutdown, giving callers confirmation
- **Stable file identity**: machine_id-keyed state files survive hostname changes without orphaning
- **Debuggable**: `curl --unix-socket ~/.stigmer/run/runner.sock http://localhost/status` works out of the box
- **Backward compatible**: Pre-T04 runners without a socket path continue to work via PID fallback

## Impact

- **CLI users**: Transparent — `stigmer up` and `stigmer down runner` gain improved reliability
- **Desktop sidecar**: T05 will consume the socket for runner status/stop, replacing PID-based checks in `sidecar.rs`
- **Platform foundation**: Socket pattern enables future RPCs (restart, pause, logs) without protocol changes

## Related Work

- T03 (machine_id identity) — `90eabd4db` — Provides the stable identity that this socket response reports and that state migration uses as the new file key
- T05 (Desktop UI redesign) — Will consume the control socket from the Tauri sidecar
- Runner Management UX Overhaul project — `_projects/2026-05/20260509.02.runner-management-ux-overhaul/`

---

**Status**: Production Ready
**Timeline**: Session 4 of runner-management-ux-overhaul project
