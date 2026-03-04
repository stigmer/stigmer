# Esc as Cancel Shortcut in TUI

**Date**: March 3, 2026

## Summary

Mapped the Esc key to the existing cancel-confirm flow in the execution TUI, making "stop" behavior match the universal terminal convention. Esc now enters the same two-step cancel confirmation as the `c` key, with no new model state or architectural changes required.

## Problem Statement

During a running execution, pressing Esc did nothing — it fell through to the viewport as an unhandled key. Users reflexively reach for Esc to stop a running operation, as established by Codex CLI, Copilot CLI, and most terminal applications.

### Pain Points

- Esc did nothing during normal execution — a dead key in the most common "stop" scenario
- Users had to know the non-obvious `c` key binding to cancel
- Discoverability gap: the footer showed `c cancel` but not the universally expected Esc

## Solution

Added `msg.Type == tea.KeyEsc` as an alternative trigger alongside `msg.String() == "c"` at the cancel key check in `handleKeyPress`. All existing guard conditions (`!m.done`, `!m.cancelling`, `activeCancelFn != nil`) apply identically. The existing `handleCancelConfirmKey` handler already accepts Esc as a dismiss key (same as `n`), producing a natural two-step pattern: Esc to enter cancel, Esc again to back out.

## Implementation Details

- **`update.go`**: Single-line condition expansion — added `|| msg.Type == tea.KeyEsc` to the cancel key check
- **`view.go`**: Updated four footer hint strings from `c cancel` to `Esc/c cancel` across all running states (scroll paused with/without expandable blocks, normal with/without expandable blocks)
- **`help.go`**: Updated the "Execution Control" section binding label from `c` to `Esc / c`
- **`update_test.go`**: Added `newTestModelWithCancel` helper and 7 new tests covering every Esc interaction state

## Benefits

- Esc is now the primary cancel key, matching user muscle memory from other terminal tools
- Zero new model fields or state — reuses existing `cancelConfirm` bool and `handleCancelConfirmKey`
- The Esc → Esc pattern (enter cancel, then dismiss) is an elegant "I changed my mind" escape hatch
- Footer and help panel accurately reflect the new binding

## Impact

- **Users**: Esc now works as expected during running executions — no more dead key
- **Existing behavior preserved**: Esc during input (exits session), help (dismisses), cancel-confirm (dismisses), and approval (navigation fallthrough) are all unchanged
- **Test coverage**: 7 new tests validate every state transition involving Esc and cancel

## Related Work

- Phase 1.1: Fix approval not surfaced on resume (`2026-03-03-204258`)
- Phase 1.2: Context-cancellable approval flow (`2026-03-03-205941`)
- Phase 1.3: Actionable stream error messages (`2026-03-03-211329`)

---

**Status**: ✅ Production Ready
