# Restart Stopped Runners from Desktop UI

**Date**: April 27, 2026

## Summary

Added an inline "Start" button to stopped runners in the desktop app's Runners page, allowing users to restart a previously stopped runner with a single click. The feature reuses the existing start flow with the runner's name pre-filled — no backend, CLI, or SDK changes were needed because the `STOPPED -> READY` lifecycle transition was already fully supported by the platform.

## Problem Statement

When a runner stopped (heartbeat timeout or explicit stop), its row in the Runners page became inert — no action buttons were visible. The only way to bring a stopped runner back online was to click "Start Runner" in the header, manually re-enter the runner's name in the dialog, and submit. This was friction for the most common runner management operation: restarting a known runner.

### Pain Points

- Stopped runners showed no affordance for restarting — they appeared as read-only rows
- Users had to remember the runner name and re-type it in the Start Runner dialog
- The platform already supported identity-preserving restarts (`STOPPED -> READY` via `apply` + heartbeat), but the UI didn't surface this capability

## Solution

Surface the existing restart capability directly in the runner row UI. A Play button appears on every `STOPPED`-phase runner. Clicking it calls the same `handleStart({ name })` flow that the Start Runner dialog uses, with the runner's name pre-filled. The CLI's `stigmer up runner --name <same-name>` calls `apply` to reactivate the same identity and task queue, then the first heartbeat transitions the server-side phase from `STOPPED` to `READY`.

## Implementation Details

Single-file change in `RunnersPage.tsx`:

- **`RunnerRow` props**: Added `onStart: () => void` and `isLaunching: boolean` to the component interface
- **Start button**: Renders a Play icon button when `phase === RunnerPhase.STOPPED`, disabled while any runner launch is in flight (`isLaunching || isStarting`)
- **Parent wiring**: Each row receives `onStart={() => handleStart({ name: runnerName })}`, reusing the existing credential resolution and Tauri sidecar spawn flow
- **Inline error banner**: Added a dismissible error alert above the runner list that shows launch errors when the Start Runner dialog is closed — ensures errors from inline restart attempts are visible
- **Import**: Added `X` from lucide-react for the error banner dismiss button

Design decisions:
- **STOPPED only, not FAILED**: The proto defines FAILED as "requires investigation; does not auto-recover on heartbeat," so no start button for failed runners
- **No confirmation dialog**: Lightweight, easily reversible action (stop button is always available on active runners)
- **Page-level launch guard**: All start buttons are disabled during any launch operation to prevent concurrent spawns
- **Show on all stopped runners**: Not filtered by hostname — the proto explicitly supports re-claiming a runner identity from any machine

## Benefits

- One-click restart for stopped runners — eliminates the dialog round-trip
- Zero new infrastructure: no backend RPCs, no SDK hooks, no Tauri commands, no CLI changes
- Error visibility: inline error banner ensures failed restart attempts are surfaced even without the dialog open

## Files Changed

- `client-apps/desktop/src/pages/runners/RunnersPage.tsx` — only file modified

---

**Status**: ✅ Production Ready
