# Daemon Server-Only Mode

**Date**: April 22, 2026

## Summary

Refactored the CLI daemon lifecycle to support a server-only mode where only the control plane (Temporal + stigmer-server + web console) starts, excluding both workflow-runner and agent-runner. This is the foundational change enabling `stigmer up server` and standalone `stigmer up runner` in upcoming tasks.

## Problem Statement

The daemon's `buildComponents()` function unconditionally assembled all three child processes (stigmer-server, workflow-runner, agent-runner) into a single list. There was no way to start the control plane without also starting the runners. This monolithic startup was the primary barrier to independent runner lifecycle management.

### Pain Points

- `stigmer server` always started both the control plane and runners as a single unit
- No way to run the control plane independently for users who want to manage runners separately
- Python runtime bootstrap was unconditional — even if only the server was needed, the agent-runner Python venv had to be prepared
- Cloud users who want to register their local machine as a runner had no path to connect to a remote control plane without also starting a local one

## Solution

Added a `ServerOnly` mode flag that flows through three layers:
1. `StartOptions.ServerOnly` — caller intent (CLI command layer)
2. `STIGMER_SERVER_ONLY` environment variable — inter-process communication to the daemon
3. `buildComponents(..., serverOnly)` — component assembly filter

When `ServerOnly` is true, Python runtime bootstrap is skipped entirely, runner-specific environment variables are omitted, and `buildComponents` returns only the stigmer-server component.

## Implementation Details

### Files Modified

| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/daemon/daemon.go` | Added `ServerOnly bool` to `StartOptions`; conditional Python bootstrap; conditional runner env vars; `STIGMER_SERVER_ONLY` env propagation; `ServerOnly` in `StartupConfig` save |
| `client-apps/cli/internal/cli/daemon/daemon_process.go` | Added `serverOnly bool` param to `buildComponents`; early return with only stigmer-server when true; `RunDaemonProcess` reads env flag |
| `client-apps/cli/internal/cli/daemon/startup_config.go` | Added `ServerOnly bool` to `StartupConfig` struct for diagnostic visibility |

### Design Decisions

- **Zero default risk**: `ServerOnly` defaults to `false`, so all existing callers (`stigmer server`, `EnsureRunning`) are completely unaffected
- **No callers wired yet**: This task only adds the capability. Wiring `stigmer up server` with `ServerOnly: true` is T03 scope
- **Python bootstrap skip**: In server-only mode, the 10-minute-timeout Python venv preparation is skipped entirely — the daemon starts faster and with no Python dependency
- **Env var communication**: The daemon process (spawned via `stigmer internal-daemon`) receives the mode via `STIGMER_SERVER_ONLY=true` in its environment, maintaining the existing env-based config pattern

## Benefits

- Daemon can now start the control plane independently of runners
- Server-only startup is faster (no Python venv bootstrap)
- Foundation for `stigmer up server` (T03) and standalone runner lifecycle (T04)
- Forward-compatible with multi-runner management (T05) and embedded runner identity (T06)

## Impact

- **OSS-only**: The daemon and CLI are OSS constructs; no cloud changes needed
- **No proto changes**: The Runner resource model is untouched
- **No behavioral changes**: Existing `stigmer server` flow is identical

## Related Work

- Part of project `20260422.01.runner-ux-cli-restructure` (T02 of 8 tasks)
- Depends on: Runner as a Resource (Sessions 1-18 of `20260420.01`)
- Enables: T03 (`stigmer up`/`stigmer down` commands), T04 (standalone runner lifecycle)

---

**Status**: ✅ Production Ready
**Scope**: 3 files, +55/-20 lines
