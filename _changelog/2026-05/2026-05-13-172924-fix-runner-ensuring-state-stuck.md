# Fix Runner "Ensuring" State Getting Stuck Indefinitely

**Date**: May 13, 2026

## Summary

Fixed the Desktop runner startup UI getting permanently stuck on "Starting runner... Setting up runtime environment..." by adding a 120-second timeout to the auto-ensure lifecycle, detecting CLI process exit during startup, and improving the EnsuringCard UX with escalating warnings and actionable buttons.

## Problem Statement

After the previous startup latency fix (`ff62e39a6`), the runner startup could still get stuck indefinitely in the "ensuring" state. The `useAutoEnsure` hook relied entirely on `localStatus.running` becoming `true` via the socket/disk polling, with no fallback if that never happened.

### Pain Points

- State machine dead-end: after `onEnsure()` resolved, the hook waited forever for `localStatus.running` with no timeout
- CLI crashes after the 8s Tauri grace period were invisible: `localStatus.running` was already `false`, so the stopped event caused no state change
- No user-actionable escape from the spinner: users had to close and reopen the app
- No visibility into what the CLI was actually doing during bootstrap

## Solution

Three-layer fix addressing the timeout gap, failure detection, and UX:

1. **Ensure timeout (120s)** in `useAutoEnsure` — transitions to "error" if `localStatus.running` doesn't become `true` after `onEnsure()` resolves
2. **CLI exit detection** — subscribes to `runner:stopped` Tauri event while in "ensuring" state for immediate failure surfacing
3. **EnsuringCard UX overhaul** — escalating messages, Retry/Cancel buttons after 60s, live bootstrap progress from CLI stderr

## Implementation Details

### Ensure Timeout (`useAutoEnsure.ts`)

Added `ENSURE_TIMEOUT_MS = 120_000` constant. After `onEnsure()` resolves in the "ensuring" effect, a `setTimeout` starts. If the state is still "ensuring" when the timer fires, it transitions to "error" with a descriptive message. The timer is cleared whenever state leaves "ensuring" (via a dedicated cleanup effect) and in the effect's own cleanup function to prevent stale firings.

### CLI Exit Detection (`useAutoEnsure.ts`)

Added a new `useEffect` that subscribes to the `onRunnerStopped` Tauri event while `state === "ensuring"`. When the sidecar CLI process terminates (non-zero exit code or clean exit before ready), the hook immediately transitions to "error" with a message referencing the exit code. This covers the scenario where the CLI dies after the 8s grace window — previously the state machine had no way to detect this since `localStatus.running` was already `false` and wouldn't change.

### EnsuringCard UX (`ThisMachineCard.tsx`)

- Added `ENSURING_STALL_THRESHOLD_S = 60` — after this threshold, the card's appearance changes: spinner swaps to `AlertTriangle` warning icon, background shifts to `bg-muted-subtle`, subtitle shows "Taking longer than expected..."
- Retry and Cancel buttons appear after 60s, wired to the existing `onRetry` and `onDisable` callbacks from the auto-ensure state machine
- Added `bootstrapStatus` prop that displays live CLI progress lines (e.g., "Bootstrapping Python runtime", "Installing dependencies") with elapsed time

### Bootstrap Progress Streaming (`RunnersPage.tsx`)

Added a `bootstrapStatus` state variable that subscribes to `runner:log` events during the ensuring phase. Filters for meaningful stderr lines from the CLI (ignoring JSON output and debug noise), strips formatting characters, and passes the latest status to `ThisMachineCard` for display in the `EnsuringCard` subtitle.

## Benefits

- Runner startup can never get stuck indefinitely — 120s hard timeout with Retry/Cancel
- CLI process failures are surfaced immediately instead of leaving a perpetual spinner
- Users get actionable options (Retry, Cancel) after 60s instead of waiting helplessly
- Live bootstrap progress gives visibility into what's happening during first-run setup
- Error messages include specific context (exit codes, timeout details) to aid debugging

## Impact

- **Desktop app users**: No more infinite "Starting runner..." spinners; clear escape hatches and error messages
- **First-time users**: Better onboarding experience with live bootstrap progress feedback
- **Runner UX**: Completes the reliability story started with the startup latency fix (`ff62e39a6`)
- **Files changed**: 3 files, ~208 insertions, ~24 deletions

## Related Work

- `ff62e39a6` — Previous fix: urgent polling, socket half-close, progressive feedback
- `_changelog/2026-05/2026-05-09-232313-runner-startup-latency-socket-fix.md` — Prior changelog
- `_changelog/2026-05/2026-05-10-155436-fix-cursor-runner-bootstrap-desktop-sidecar.md` — Related sidecar PATH fix

---

**Status**: Production Ready
**Timeline**: Single session
