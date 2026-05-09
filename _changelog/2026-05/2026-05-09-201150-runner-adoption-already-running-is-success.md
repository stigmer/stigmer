# Runner Adoption: "Already Running" Is Now Success

**Date**: May 9, 2026

## Summary

Fixed a critical UX bug where clicking "Start Runner" in the Desktop app showed a red error banner when a runner was already active. The system now treats "already running" as a success state (adoption) instead of an error, closing the dialog gracefully and optionally showing a toast confirmation.

## Problem Statement

When a user clicked "Start Runner" in the Stigmer Desktop app and a runner was already active on their machine, the CLI returned exit code 1 with a multi-line error message, the Tauri sidecar surfaced it as a failure, and the Desktop showed a red `ErrorBanner` saying the runner was "already running" with a suggestion to use `--name`. This confused users whose intent ("use this computer for Stigmer runs") was already satisfied.

### Pain Points

- User's goal (computer available for runs) was already met, but presented as an error
- The "fix" suggestion (`--name <name>`) was irrelevant — users don't want multiple runners
- Repeated clicks on "Start Runner" produced the same error, eroding trust
- The Tauri sidecar also had a separate error for runners already in its ProcessManager
- CLI exiting 0 during the grace period caused a ghost entry in ProcessManager (dead child registered as managed)

## Solution

Three-layer fix, each defensively correct:

1. **CLI** — Replace `checkNameConflict` with `checkOrAdopt`. When the runner is alive and org/endpoint are compatible, print a success message and exit 0. Only error for real conflicts (org or endpoint mismatch).

2. **Tauri sidecar** — Two paths to success:
   - If the runner is already in the Desktop's ProcessManager: return `Ok` immediately (no CLI spawn needed)
   - If the CLI exits 0 during the 8-second grace period: return `Ok` without registering the dead child (prevents ghost entries and orphaned async watchers)

3. **Desktop UI** — Show a "Connected to existing runner" toast via sonner when the start operation succeeds and the runner was already in the local list (adoption indicator)

## Implementation Details

### CLI: `checkOrAdopt` (`start.go`)

New function signature with three outcomes:
- `(*RunnerState, nil)` — adopt (runner alive + compatible)
- `(nil, nil)` — no conflict, proceed with fresh start
- `(nil, error)` — real conflict (org/endpoint mismatch)

Comparison logic is defensive: empty org or endpoint in the state file defaults to adoption (handles legacy state files). Only errors when both the override AND the state value are non-empty and differ.

### Tauri Sidecar (`sidecar.rs`)

The "already managed" early-return changed from `Err(...)` to `Ok(runner_name)`. The grace-period exit-0 handling adds an early `return Ok(runner_name)` before the ProcessManager registration block, ensuring dead CLI children are never tracked.

### Desktop UI (`RunnersPage.tsx`)

Added `import { toast } from "sonner"` and a single check after `startRunner()` succeeds: if `localRunners.has(runnerName)`, show an adoption toast. The `localRunners` dependency was added to the `handleStart` callback deps array.

## Benefits

- Users see success instead of a confusing error when their intent is already satisfied
- Repeated "Start Runner" clicks are idempotent and harmless
- Real conflicts (different org, different endpoint) still produce clear, actionable errors
- No ghost entries in ProcessManager for processes the Desktop doesn't own
- Foundation for Phase 1's idempotent `stigmer runner ensure` command

## Impact

- **Desktop users**: Immediate improvement — the most common runner UX complaint is fixed
- **CLI users**: `stigmer up` now exits 0 when the runner is already active (same behavior from terminal)
- **Architecture**: ProcessManager only tracks processes it owns; adopted runners are tracked via filesystem state files (correct separation of concerns)

## Related Work

- Part of the Runner Management UX Overhaul project (`20260509.02.runner-management-ux-overhaul`)
- Phase 0 of a 7-phase plan; subsequent phases add `machine_id`, control socket, UI redesign, and service integration
- Research report: `_projects/2026-05/20260509.02.runner-management-ux-overhaul/research.runner-management-ux/`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes implementation)
