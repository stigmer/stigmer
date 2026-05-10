# Fix Desktop Windows Build — Unix Socket Platform Gates

**Date**: May 10, 2026

## Summary

The Windows CI build for the desktop app was failing because `sidecar.rs` used `tokio::net::UnixStream` — a Unix-only API — without any platform gate. This fix adds `#[cfg(unix)]` guards to all Unix-socket-dependent code and provides Windows fallbacks so the Tauri command interface remains consistent across platforms.

## Problem Statement

The `build (windows-latest)` job in the "Build and release (tag push)" workflow was failing with:

```
error[E0433]: cannot find 'UnixStream' in 'net'
  --> src/sidecar.rs:197:21
```

### Pain Points

- Every tagged release failed on Windows, blocking desktop distribution
- The control socket feature (T04) was added for Unix runners but the Tauri commands were unconditionally compiled for all targets
- Other parts of the same file already had proper `#[cfg(unix)]` guards (e.g. `libc::kill` calls), so this was an oversight in the socket additions

## Solution

Gate all Unix-domain-socket code behind `#[cfg(unix)]` and provide `#[cfg(not(unix))]` fallbacks for the two Tauri commands that the frontend invokes.

## Implementation Details

Changes in `client-apps/desktop/src-tauri/src/sidecar.rs`:

- **Import gate**: `use tokio::io::{AsyncReadExt, AsyncWriteExt}` is now `#[cfg(unix)]` since it's only consumed by `unix_http_request`
- **Internal function gates**: `default_socket_path`, `discover_socket_path`, `unix_http_request`, and `SOCKET_TIMEOUT_MS` are now `#[cfg(unix)]`
- **`query_runner_socket` command**: on non-Unix, falls back to `status_from_disk()` — the same path used on Unix when no socket is found
- **`stop_runner_via_socket` command**: on non-Unix, returns an error indicating the feature is unsupported on the platform

## Benefits

- Windows CI builds pass again for tagged releases
- Desktop distribution unblocked for all three targets (macOS, Linux, Windows)
- Consistent pattern: all platform-specific code in `sidecar.rs` now uses the same `#[cfg(unix)]` / `#[cfg(not(unix))]` strategy

## Impact

- **CI/CD**: Unblocks the Windows leg of the release pipeline
- **Desktop users**: No functional change on macOS/Linux; Windows users get disk-based runner status (socket support can be added later via named pipes if needed)

## Related Work

- Runner control socket implementation (`2026-05-09-215233-runner-control-socket-and-state-migration.md`)
- Runner startup latency socket fix (`2026-05-09-232313-runner-startup-latency-socket-fix.md`)
- Desktop runner status card (`2026-05-09-222132-desktop-runner-status-card.md`)

---

**Status**: ✅ Production Ready
