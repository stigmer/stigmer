# Fix Inline Rendering: Program Restart Re-commit and Single-Line Plan

**Date**: March 7, 2026

## Summary

Replaced the broken `tea.Raw` + `tea.ClearScreen` re-commit mechanism with a foolproof program-restart approach, and switched the plan display from a dynamic-height multi-line View() to a constant-height single-line current task. These two changes eliminate the Ctrl+O blank screen bug and the todo-items-overwriting-scrollback bug at their root causes.

## Problem Statement

Two critical display bugs plagued the inline renderer:

### Pain Points

- **Ctrl+O losing separator and prompt**: After pressing Ctrl+O to toggle expand/collapse, the separator line and `>` cursor prompt at the bottom of the screen would disappear. The root cause: `tea.ClearScreen` emits physical escape sequences (`MoveTo(0,0)` + `Erase`) into the renderer buffer, which flushes *after* `tea.Raw`'s history write — effectively erasing the just-written content. No ordering of Raw/ClearScreen/Println within Bubbletea avoids this fundamental conflict.

- **Todo items overwriting the first message**: The `planDisplay` in View() caused the view height to dynamically grow when new todos arrived. The inline renderer, using stale (shorter) height calculations for cursor positioning, would overwrite previously committed scrollback content when redrawing the taller View().

## Solution

**Issue 1 — Program restart for re-commit**: Instead of fighting Bubbletea's internal buffer ordering, the re-commit now synchronously stops the old program, writes history directly to the terminal (with no Bubbletea involved), and starts a fresh program instance with state pre-loaded. This guarantees a clean slate: the new renderer's cursor tracking starts from scratch at the correct physical cursor position.

**Issue 2 — Single-line plan in View()**: The multi-line `planDisplay` field is replaced by a single-line `currentTask` showing only the in-progress todo. The full plan is stored in history and rendered in scrollback only when expanded mode is active (Ctrl+O). This makes View() height constant, eliminating the root cause of the overwrite.

## Implementation Details

### Part 1: Single-Line Plan

- `renderComposedView` now shows `"  [-] <currentTask>"` instead of the full plan
- `kindTodoUpdate` renders its full text in expanded mode via `renderCommittedItem`, returns empty in collapsed mode
- `currentTaskMsg` simplified to carry only `task` (removed `planDisplay` field)
- `renderTodoUpdate` stops building `displayBuf`, tracks `trackedCurrentTask` on the renderer

### Part 2: Program Restart Re-commit

- Added `programFactory` to `inlineRenderConfig` — a closure that creates fresh Bubbletea programs with the same channels and output writer
- Wired up `programFactory` in both `streamAgentInline` and `resumeSession`
- New `performReCommit` method: Quit + Wait on old program → `fmt.Fprint(clearAndHome + history)` → start new program with pre-loaded state (currentTask, termWidth, follow-up input if active)
- New `performReCommitWithApproval` variant: same flow but also writes expanded tool view and pre-loads approval state (question, menu selection, decision channel) into the new model
- `triggerReCommit` now calls `performReCommit` directly
- Approval flow restructured: streaming→approval transitions use `performReCommitWithApproval`; Ctrl+O during approval prompt creates a new decision channel and restarts the program

### Dead Code Removed

- `reCommitPending` field and its View() suppression check
- `handleReCommit`, `handleReCommitDone`, `handleApprovalReRender` model handlers
- `buildReCommitCmd` (the broken tea.Raw + tea.ClearScreen + tea.Sequence)
- `reCommitMsg`, `reCommitDoneMsg`, `approvalReRenderMsg` message types
- `reCommitPayload` from `approvalStartMsg` and `approvalShowMsg`
- `planDisplay` field from the model

### Files Changed

| File | Change |
|------|--------|
| `run_stream_inline_types.go` | Add `programFactory`, `trackedCurrentTask`, `trackedInputBarMode`, `followUpSendCh` |
| `run_stream.go` | Wire up `programFactory` closure |
| `run_session.go` | Wire up `programFactory` closure |
| `run_stream_inline_history.go` | Replace `buildReCommitCmd` with `performReCommit`/`performReCommitWithApproval`; update `kindTodoUpdate` rendering |
| `run_stream_inline_bubbletea.go` | Remove `reCommitPending`, dead handlers, `planDisplay`; simplify approval handlers |
| `run_stream_inline_approval.go` | Restructure to use `performReCommitWithApproval`; add `waitForApprovalDecision` |
| `run_stream_inline_render.go` | Simplify `renderTodoUpdate`; track `currentTask` on renderer |
| `run_stream_inline_messages.go` | Remove dead message types; simplify `currentTaskMsg` |
| `run_stream_inline.go` | Track `followUpSendCh`; update comment |
| `run_stream_inline_test.go` | Update comment |
| `*_test.go` | Update/rewrite tests for new re-commit approach |

## Benefits

- **Zero flush-ordering races**: Direct terminal writes happen with no Bubbletea program running. No `tea.Raw` vs `tea.ClearScreen` vs `tea.Println` conflicts possible.
- **Fresh renderer on every re-commit**: Cursor tracking is always correct because the new program starts from scratch at the physical cursor position.
- **Constant View() height**: Single-line `currentTask` never causes height jumps. The inline renderer's positioning math is always stable.
- **Net code reduction**: 197 lines added, 341 lines removed — simpler, more maintainable re-commit path.

## Impact

- **Users**: Ctrl+O toggle now works reliably in all states (idle, streaming, follow-up, approval). The separator and prompt always reappear in collapsed mode. Todo items no longer overwrite the first message content.
- **Developers**: The re-commit mechanism is now straightforward (stop → write → start) with no Bubbletea internal buffer knowledge required.

## Related Work

- [2026-03-07-072503] fix-ctrl-o-blank-screen-and-ai-truncation — previous partial fix that this supersedes
- [2026-03-06-013928] fix-recommit-scrollback-duplication-via-raw — earlier Raw-based approach
- [2026-03-05-222122] unblock-ctrl-o-during-follow-up-prompt — Ctrl+O keybinding foundation

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (root cause analysis + implementation)
