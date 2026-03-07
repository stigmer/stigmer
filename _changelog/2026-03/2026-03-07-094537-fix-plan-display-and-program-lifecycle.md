# Fix Plan Display in View() and Program Lifecycle on Session Exit

**Date**: March 7, 2026

## Summary

Two interrelated fixes to the inline rendering system: (1) the plan/todo summary is now properly displayed in the View() bottom bar with expand hint, and the full plan appears at the bottom of expanded scrollback; (2) the BubbleTea program reference is correctly propagated through the render/follow-up chain so `stopInlineProgram` shuts down the active program, preventing terminal corruption on session exit.

## Problem Statement

### Pain Points

- **Plan display gaps**: The plan summary (current task + completion count) was not shown in the collapsed View() bar, leaving users with no visibility into plan progress without expanding. In expanded mode, the plan appeared inline with other events rather than at the bottom, making it hard to find.
- **Terminal corruption on exit**: After any Ctrl+O toggle (or subject/recent-sessions update) triggered a `performReCommit`, the original BubbleTea program was replaced by a new one via `programFactory`. However, the caller still held the original (now-dead) program reference. On session exit, `stopInlineProgram` was called on the dead program (no-op), leaving the replacement program running in raw terminal mode. The epilogue output (`displaySessionExitLine`) then wrote `\n` which in raw mode is just LF (no carriage return), producing a staircase/offset effect.

## Solution

### Plan Display

- Added `todoTotal`, `todoCompleted`, and `expandMode` fields to `inlineBubbleModel`.
- `renderComposedView` now shows the current in-progress task and a plan summary ("Plan: 2/5 todos completed (ctrl+o to expand)") in the View() bar — but only when not in expanded mode (to avoid duplication).
- `renderHistoryBatch` defers `kindTodoUpdate` items to the end of the batch so the plan always appears below all messages/tool output in expanded scrollback.
- `renderCommittedItem` returns full plan text in expanded mode and empty string in collapsed mode.
- `performReCommit` and `performReCommitWithApproval` transfer `todoTotal`, `todoCompleted`, and `expandMode` to the new program.

### Program Lifecycle

- Added `program *tea.Program` field to `renderResult` so `renderInline` returns the active program.
- All 7 return points in `renderInline` and `completeFollowUp` set `program: r.cfg.program`.
- `runInlineFollowUpLoop` returns a 4th value (`latestProgram`) and keeps `cfg.program` in sync between follow-up iterations.
- Both callers (`streamAgentInline`, `resumeSession`) use the returned `activeProgram` for `stopInlineProgram` instead of the stale original.

## Implementation Details

### Files Changed (11 files, +142 / -63)

| File | Change |
|------|--------|
| `run_stream_inline_bubbletea.go` | Added `todoTotal`, `todoCompleted`, `expandMode` to model; updated `renderComposedView` for plan summary; clear plan on `textInputHideMsg` |
| `run_stream_inline_messages.go` | Extended `currentTaskMsg` with `todoTotal`/`todoCompleted` |
| `run_stream_inline_render.go` | `renderTodoUpdate` now tracks completion counts; sends extended `currentTaskMsg` |
| `run_stream_inline_types.go` | Added `program` to `renderResult`; added `trackedTodoTotal`/`trackedTodoCompleted` to renderer |
| `run_stream_inline_history.go` | Deferred `kindTodoUpdate` to end of batch; added `todoTotal`/`todoCompleted` to `committedItem`; transfer `expandMode` during re-commit |
| `run_stream_inline.go` | Set `program: r.cfg.program` in all return points |
| `run_stream_inline_followup.go` | Return 4th value `latestProgram`; sync `cfg.program` between iterations |
| `run_stream.go` | Use `activeProgram` from loop return |
| `run_session.go` | Use `activeProgram` from loop return |
| `run_stream_inline_followup_test.go` | Updated 5 test calls for new return signature |
| `run_stream_inline_history_test.go` | Updated assertions for deferred plan and collapsed-mode behavior |

## Benefits

- **Visible plan progress**: Users see current task and completion summary at a glance in the collapsed bar without needing to expand.
- **Clean expanded view**: Plan appears at the bottom of expanded scrollback, easy to find after all messages.
- **No terminal corruption**: Session exit (Ctrl+C, normal completion) correctly stops the active BubbleTea program regardless of how many re-commits occurred, restoring the terminal cleanly.
- **Multi-execution correctness**: Program reference stays in sync across follow-up iterations within a session.

## Impact

All users of inline session rendering (both `stigmer run` and `stigmer session resume`) benefit. The fixes apply to TTY mode where BubbleTea manages the terminal.

## Related Work

- `2026-03-07-085926-fix-inline-rendering-program-restart-recommit.md` — introduced the program-restart re-commit approach that surfaced the program lifecycle issue.
- `2026-03-07-072503-fix-ctrl-o-blank-screen-and-ai-truncation.md` — earlier fix for Ctrl+O blank screen.

---

**Status**: ✅ Production Ready
