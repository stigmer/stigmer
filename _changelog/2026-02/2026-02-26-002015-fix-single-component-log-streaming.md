# Fix Single-Component Log Streaming Resilience

**Date**: February 26, 2026

## Summary

Fixed `stigmer server logs --component <name>` to behave like `stern` / `kubectl logs -f` by surviving container restarts and log file replacements. Previously, passing `--component` would cause the command to exit when the underlying container stopped or the server restarted, while the default all-components mode handled these scenarios gracefully.

## Problem Statement

Running `stigmer server logs` without `--component` streamed logs continuously and reconnected automatically through server restarts — matching the experience of `stern` or `kubectl logs -f`. However, when `--component` was explicitly passed (e.g., `--component agent-runner`), the command would return to the shell prompt as soon as the Docker container stopped or the log file was replaced.

### Pain Points

- `stigmer server logs --component agent-runner` exited when the Docker container restarted, requiring the user to manually re-run the command
- File-based log streaming (for non-Docker components) did not detect when the server replaced the log file with a new one (different inode), leaving the tailer stuck on a stale file descriptor
- Inconsistent behavior between default mode and `--component` mode was confusing

## Solution

Aligned the single-component code path with the resilience features already present in the all-components streaming code (`tailDockerLogs` and `tailLogFile` in `streamer.go`).

## Implementation Details

Two functions in `server_logs.go` were updated:

**`streamDockerLogs()`** — Docker container reconnection:
- Refactored into a retry loop around a new `runDockerLogs()` helper
- When `--follow` is true, the loop retries `docker logs -f` after the container stops, with 500ms back-off
- After reconnecting, uses `--tail 0` to avoid duplicating previously-shown lines

**`streamLogs()`** — File replacement detection via inode:
- Added inode tracking using `syscall.Stat_t` (matching `tailLogFile()` in `streamer.go`)
- On each EOF poll, stats the path (not the open fd) and compares inodes
- If the inode changed (file replaced on server restart), closes the old handle and reopens the new file from the beginning
- If the file is temporarily deleted, waits for it to reappear
- Retains existing truncation detection as a fallback

## Benefits

- `stigmer server logs --component agent-runner` now streams continuously through server/container restarts
- Consistent behavior regardless of whether `--component` is passed
- Matches the UX of `stern` and `kubectl logs -f` that developers expect

## Impact

All CLI users who use `--component` to focus on a single service's logs. No API or configuration changes — purely behavioral fix in the CLI.

## Related Work

- Existing resilience logic in `internal/cli/logs/streamer.go` (`tailDockerLogs`, `tailLogFile`) that already handled these cases for the all-components mode

---

**Status**: ✅ Production Ready
