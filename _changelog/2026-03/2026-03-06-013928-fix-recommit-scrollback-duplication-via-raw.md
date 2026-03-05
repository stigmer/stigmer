# Fix Recommit Scrollback Duplication via tea.Raw

**Date**: March 6, 2026

## Summary

Eliminated the persistent scrollback duplication bug where old content survived a recommit (subject update, recent sessions, Ctrl+O toggle) because Bubbletea v2's `ClearScreen` + `Println` sequence has a fundamental timing flaw. Replaced the flawed pattern with an atomic `tea.Raw` + `tea.ClearScreen` approach and added debouncing for rapid-fire recommit triggers.

## Problem Statement

When a recommit operation fired (e.g., backend resolved the session subject, or recent sessions arrived), the terminal was supposed to fully clear and re-render from scratch starting with the Stigmer header panel. Instead, old content persisted in scrollback, producing duplicates visible when scrolling up.

### Pain Points

- Scrolling up after a subject-update recommit revealed the task description appearing twice, with the Stigmer header sandwiched in between
- Multiple recommit triggers (subject + recent sessions) firing near-simultaneously could interleave their clear/write sequences
- Previous fix attempts (embedding `\033[3J` in Println payload, reordering escape sequences) addressed symptoms but not the root cause

## Solution

Replaced the `tea.Sequence(tea.ClearScreen, tea.Println(eraseScrollback + rendered))` pattern with `tea.Sequence(tea.Raw(clearAndHome + rendered), tea.ClearScreen)`, which eliminates the timing gap entirely. Added a debouncing mechanism to coalesce rapid-fire recommit triggers into a single screen refresh.

## Implementation Details

### Root Cause: Timing Flaw in ClearScreen + Println

Deep analysis of Bubbletea v2's `cursed_renderer.go` and `tea.go` revealed:

1. **`clearScreen()` only marks internal state** — sets `s.scr.MoveTo(0,0)` and `s.scr.Erase()` but defers the actual `\033[2J` write until the next `flush()` on the timer tick (~16ms later)
2. **`insertAbove()` (used by Println) writes directly to the terminal** — using `cellbuf.Width()` and `cellbuf.Height()` from the last flush (stale) and `scr.Position()` which was reset to (0,0) by clearScreen
3. **`insertAbove` runs before the deferred flush** — its scroll calculations push old content into scrollback before the clear sequences can erase it

### The Fix: Atomic Raw Write + Renderer State Reset

- **`tea.Raw("\033[2J\033[1;1H\033[3J" + content + "\n")`** — writes clear sequences and rendered content to Bubbletea's `outputBuf`. This buffer is flushed to the terminal **before** the renderer's cellbuf flush on each tick, guaranteeing atomicity.
- **`tea.ClearScreen`** — follows the Raw to reset the renderer's internal cursor position and erase flags, so the next `View()` flush renders at the correct position below the Raw content.

### Debouncing Recommit Triggers

Refactored the `renderInline` select loop: instead of calling `triggerReCommit()` inline in each case, recommit-worthy cases set a `recommitNeeded` flag. After the select, `drainRecommitTriggers()` non-blockingly absorbs any additional queued triggers, then a single `triggerReCommit()` fires.

### Active State Cleanup

`handleReCommit` now clears all active visual states (spinner, streaming, aiStream, followUp) before returning the command. This ensures `View()` returns `""` during the renderer flush that follows the Raw write.

## Files Changed

- **`run_stream_inline_history.go`** — Rewrote `buildReCommitCmd` to use `tea.Raw` + `tea.ClearScreen`; replaced `eraseScrollback` with `clearAndHome` constant
- **`run_stream_inline_bubbletea.go`** — Added active-state cleanup to `handleReCommit`
- **`run_stream_inline.go`** — Refactored select loop with `recommitNeeded` flag and `drainRecommitTriggers()` method
- **`run_stream_inline_messages.go`** — Updated doc comments to reflect the new pattern

## Benefits

- **No more scrollback duplicates** — the atomic Raw write eliminates the timing gap that allowed old content to survive
- **Single recommit per trigger burst** — debouncing prevents two `reCommitMsg` messages from interleaving their clear/write sequences
- **Clean View state** — active-state reset ensures no stale spinner/streaming content renders on top of fresh history
- **Uses only documented Bubbletea v2 APIs** — `tea.Raw`, `tea.ClearScreen`, `tea.Sequence`

## Impact

All recommit paths benefit: subject update, recent sessions, Ctrl+O toggle, and approval-transition recommits. The fix is confined to the inline renderer's recommit machinery — no changes to event handling, approval flow logic, or streaming.

## Related Work

- Previous fix attempts: `2026-03-05-234423-fix-scrollback-duplication-on-re-commit.md`, `2026-03-06-001520-fix-duplicate-write-block-in-approval-scrollback.md`
- Bubbletea v2 upgrade project: `_projects/2026-03/20260305.03.bubbletea-v2-upgrade/`

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (root cause analysis + implementation)
