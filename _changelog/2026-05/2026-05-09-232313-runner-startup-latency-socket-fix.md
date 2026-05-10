# Runner Startup Latency and Socket Health Fix

**Date**: May 9, 2026

## Summary

Fixed two UX issues in the Desktop runner startup flow: the "Starting runner..." state getting stuck for 50-80 seconds due to slow poll intervals during bootstrap, and the persistent "socket unreachable" health warning caused by a half-close race condition in the Rust Unix socket client.

## Problem Statement

After clicking "Enable" to start a local runner, the Desktop UI would show "Starting runner... Connecting this computer to your organization" for an extended period (sometimes 50-80 seconds) before transitioning to the active state. Once active, a persistent "Local health check failed — socket unreachable" warning appeared even though the runner was functioning correctly.

### Pain Points

- Users thought the app was stuck/broken during first-time runner startup
- No progress feedback during Python runtime bootstrap (which takes 30-60s on first run)
- Health warning appeared immediately on transition to active state, including during the normal startup window where socket isn't yet available
- The Rust `writer.shutdown()` (half-close) pattern caused Go's `net/http` server to occasionally drop the connection on macOS before responding

## Solution

Four targeted fixes addressing both latency perception and socket communication:

1. **Accelerated polling during startup** — 2s interval instead of 10s while ensuring
2. **Fixed Rust Unix socket client** — Removed half-close pattern, use single stream write-then-read
3. **Progressive startup feedback** — Elapsed timer and contextual messages during bootstrap
4. **Grace period for health warning** — 30s delay before showing socket warning after becoming active

## Implementation Details

### Urgent Polling Mode (`useLocalRunnerStatus.ts`)

Added `URGENT_POLL_MS` (2s) and a `setUrgent()` method. When the auto-ensure state machine enters "ensuring", the page component activates urgent mode, causing the polling effect to restart with the faster interval. This cuts up to 8 seconds off the perceived startup wait by detecting the runner state file sooner.

### Rust Socket Client Fix (`sidecar.rs`)

Replaced the split-stream + `shutdown(SHUT_WR)` pattern with a single `UnixStream` that writes the HTTP request then reads until the server closes the connection. The `Connection: close` header ensures the Go server closes after responding, which unblocks `read_to_end`. This eliminates a race condition where the half-close signal could arrive at the Go server before it wrote its response.

### Bootstrap Progress UX (`ThisMachineCard.tsx`)

The `EnsuringCard` component now tracks elapsed time:
- 0-10s: "Connecting this computer to your organization."
- 10-30s: "This may take a minute on first run..."
- 30s+: "Setting up runtime environment... 45s elapsed"

### Health Warning Grace Period (`ThisMachineCard.tsx`)

The `ActiveCard` component suppresses the "socket unreachable" warning for 30 seconds after mounting. This covers the normal window where disk-state detection precedes socket availability during fresh starts.

## Benefits

- Startup perceived latency reduced by ~8-10s (urgent 2s polls vs 10s inactive polls)
- Eliminated confusing health warning during normal startup transitions
- Users get reassurance that first-time setup is expected to take time
- Socket communication reliability improved on macOS

## Impact

- **Desktop app users**: Smoother first-run experience, no false-alarm warnings
- **Runner UX**: Consistent with the "invisible runner lifecycle" goal from Phase 0-6
- **Files changed**: 4 files, 68 insertions, 16 deletions

---

**Status**: ✅ Production Ready
**Timeline**: Single session fix
