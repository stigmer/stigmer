# Fix Runner Start Failure from Desktop App

**Date**: April 30, 2026

## Summary

Fixed two compounding bugs that prevented a desktop-managed runner from being started (or restarted) after the cursor-runner cloud-availability fix. The cursor-runner's Node.js bootstrap was blocking the main startup path for up to 90 seconds, delaying the heartbeat stream that makes the server recognize the runner as RUNNING. Simultaneously, a React polling race condition killed the UI's refetch loop before the runner could transition out of STOPPED.

## Problem Statement

After the cloud-availability fix enabled `IsCursorRunnerAvailable` to return `true` in cloud mode, clicking "Start" on a stopped runner in the desktop app appeared to do nothing — the runner stayed at "Stopped" indefinitely.

### Pain Points

- The cursor-runner bootstrap (Node.js download + `npm install`) ran synchronously inside `startNativeRunner()`, blocking `SaveState()` and the heartbeat stream for 40–90 seconds on first run
- The sidecar's 8-second grace period expired during the bootstrap, returning success to the frontend while the server-side runner remained STOPPED
- A `useEffect` in `RunnersPage.tsx` aggressively overrode the `hasTransitional` polling flag based on server data, killing the 5-second refetch interval before the runner had a chance to transition

## Solution

Two targeted fixes that address the Go CLI startup path and the React frontend polling logic independently.

## Implementation Details

### Fix 1: Async cursor-runner bootstrap (Go CLI)

Introduced a `cursorHandle` type in `start.go` that provides mutex-protected access to a cursor-runner process started asynchronously. The execution order changed from:

```
Python start → cursor-runner bootstrap (BLOCKS 40-90s) → SaveState → heartbeat
```

to:

```
Python start → SaveState → heartbeat → [goroutine: cursor-runner bootstrap → start → update state]
```

The goroutine updates the on-disk state file with the cursor-runner PID once the process is ready. The shutdown path uses `cursorHandle.shutdown()` to SIGTERM the process (with graceful timeout + SIGKILL fallback), correctly handling the case where the goroutine hasn't finished bootstrapping yet.

### Fix 2: Grace-period polling (React frontend)

Added a `restartGraceRef` that records the timestamp when `handleStart` or `handleRestart` completes. The `useEffect` that manages `hasTransitional` now checks whether the 30-second grace period is active before disabling polling. A cleanup timer automatically expires the grace period and stops polling once elapsed.

## Benefits

- Runner heartbeat now starts within ~3 seconds of CLI launch (well within the 8-second sidecar grace period)
- The UI continues polling for 30 seconds after a start attempt, ensuring it picks up the RUNNING transition
- The cursor-runner bootstrap no longer delays the primary agent-runner functionality
- No behavioral change for production cached builds where `IsReady()` is a fast no-op

## Impact

- **Desktop app users**: Runners start reliably on first click, including on first-ever run where Node.js must be downloaded
- **CLI users**: `stigmer up runner` in cloud mode no longer blocks on cursor-runner bootstrap before the heartbeat begins
- **Cursor-runner**: Still starts, just asynchronously — no functionality lost

## Related Work

- [Fix cursor-runner cloud availability](_changelog/2026-04/2026-04-30-201753-fix-cursor-runner-cloud-availability.md) — the change that introduced `IsCursorRunnerAvailable` returning `true` in cloud mode, which exposed these latent issues

---

**Status**: ✅ Production Ready
