# Restart Button: Stop-Then-Start Semantics

**Date**: April 27, 2026

## Summary

Fixed the desktop runner restart button to use stop-then-start semantics. When a runner's server-side phase is STOPPED but the local CLI process is still alive, clicking the restart Play button now kills the stale process before spawning a fresh one, instead of failing with a "runner is already running" conflict error.

## Problem Statement

After adding the inline restart (Play) button for stopped runners, clicking it failed when the local CLI process was still alive despite the server showing STOPPED. The CLI's `checkNameConflict` found the state file at `~/.stigmer/runners/<name>.json`, probed the PID, found it alive, and refused to start.

This happens when the server marks a runner STOPPED (heartbeat timeout or server-side stop command via the bidi stream) but the local process never received a kill signal — the stream disconnected but the process kept running.

## Solution

Changed the restart button's handler from a direct `handleStart({ name })` call to a dedicated `handleRestart(name)` callback that does stop-then-start:

1. Call `stopRunner(name)` first (swallowing errors — the process might already be dead)
2. Then proceed with the normal credential resolution and `startRunner(...)` flow

The existing `invokeStopRunner` in the Rust sidecar handles both cases: desktop-managed runners get SIGTERM directly, non-managed runners get `stigmer down runner --name <name>` which reads the state file, kills the PID, and removes the state file. Either way, by the time `startRunner` runs, the state file is gone and `checkNameConflict` passes.

## Files Changed

- `client-apps/desktop/src/pages/runners/RunnersPage.tsx` — added `handleRestart` callback, wired to `onStart` prop

---

**Status**: ✅ Production Ready
