# Web Console: Runner Launch Feedback and Desktop Banner Fix

**Date**: April 27, 2026

## Summary

Fixed two interconnected UX failures on the web console Runners page: the "Launch Local Runner" button appeared to do nothing because the `stigmer://` deep link handoff was entirely fire-and-forget with no user feedback, and the desktop download banner/promo was permanently suppressed by one-way localStorage latches with no recovery path.

## Problem Statement

Users clicking "Launch Local Runner" on the web console saw no visible response. The button dispatched a `stigmer://launch-runner?token=...` URL to the OS, but provided zero feedback about whether the desktop app received it, was installed, or was running. Meanwhile, the "Stigmer Desktop" download promo that would have helped users install the app was permanently hidden by stale localStorage signals (`stigmer:desktop-downloaded` or `stigmer:has-local-runner`).

### Pain Points

- "Launch Local Runner" button appeared broken — no toast, no loading state beyond the ~100ms API call, no timeout detection
- Desktop download promo permanently hidden after any prior download or local runner detection, even if the desktop app was later uninstalled
- The `isLocalHostname` heuristic missed macOS `.local` mDNS hostnames (e.g., `Sureshs-Mac-Studio.local`), so the hostname-based "local runner detected" signal never fired for Mac users
- The two issues compounded into a dead end: no download path available, and no feedback when the deep link failed

## Solution

Added a complete launch feedback lifecycle to the web console and fixed the desktop promo suppression logic.

## Implementation Details

### Launch feedback state machine (`RunnersSection.tsx`)

Replaced the fire-and-forget launch with a four-phase state machine:
- **idle** — default state, button shows "Launch Local Runner"
- **awaiting** — deep link dispatched, loading toast shown, runner list polls every 3s
- **succeeded** — new runner ID detected in the polled list, success toast shown
- **timed-out** — 15 seconds elapsed without a new runner, warning toast shown with "Download Desktop" action

The detection uses React's sanctioned "setState during render" pattern to transition from `awaiting` to `succeeded` without violating the `react-hooks/set-state-in-effect` lint rule. Toasts are fired from a separate effect driven by the outcome state.

### Desktop promo override

The `DesktopAppPromo` component now shows when `launchTimedOut` is `true`, overriding the stale `useHasDesktopSignal()` localStorage latch. This ensures the download option surfaces exactly when the user needs it.

### `.local` mDNS hostname coverage

`isLocalHostname()` now matches `.local` suffixed hostnames (standard macOS/Bonjour local network names) in addition to `localhost`, `127.0.0.1`, `::1`, and private IP ranges.

### SDK hook enhancement (`useLaunchLocalRunner`)

Added `lastLaunchResult` to the hook's return type — persists the `LaunchLocalRunnerResult` (URL + token expiry) after a successful dispatch so consumers can build their own feedback loops without capturing the promise return value. `clearError()` now also resets `lastLaunchResult`.

## Files Changed

- `client-apps/web/src/domain/runner/RunnersSection.tsx` — Launch feedback state machine, promo override, hostname fix
- `sdk/react/src/runner/useLaunchLocalRunner.ts` — `lastLaunchResult` state + `clearError` reset
- `sdk/react/src/runner/__tests__/useLaunchLocalRunner.test.tsx` — Tests for `lastLaunchResult` and clearError behavior

## Benefits

- Users get immediate, continuous feedback when launching a local runner from the browser
- Failed launches surface a clear recovery path (download the desktop app) instead of silent failure
- Mac users' `.local` hostnames are correctly classified for banner suppression
- Platform builders using `useLaunchLocalRunner` get `lastLaunchResult` for building custom feedback UIs

## Impact

Affects all web console users who manage runners. The SDK hook change is additive (new field, no breaking changes) and benefits platform builders embedding runner management.

---

**Status**: ✅ Production Ready
