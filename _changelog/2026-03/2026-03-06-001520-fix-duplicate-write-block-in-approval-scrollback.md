# Fix Duplicate Write Block in Approval Scrollback

**Date**: March 6, 2026

## Summary

Fixed a rendering bug where the HITL approval flow for `Write` tool calls displayed two "Write" blocks in terminal scrollback — a dead streaming snapshot followed by the correct expanded approval view. The root cause was a race between Bubbletea V2's `insertAbove` scrollback mechanism and the model's streaming state lifecycle.

## Problem Statement

When the agent streamed a `Write` tool call and then transitioned to the approval prompt, users saw duplicate output:

1. A partial `Write()` block with truncated content and a "more lines" indicator
2. The full `Write(filepath)` block with complete content and the approval prompt

This made the approval flow look broken and cluttered the terminal scrollback with stale content.

### Pain Points

- Confusing UX: two Write blocks for a single tool call
- The first block showed incomplete information (no filepath, truncated content)
- The duplication was non-deterministic depending on intermediate `Println` calls

## Solution

Send `streamingHideMsg` to the Bubbletea model **before** any `program.Println` calls execute during the `ToolWaitingApprovalEvent` transition. This clears `streamingActive` in the model, making `View()` return an empty string. When `insertAbove` (the mechanism behind `Println`) then pushes the current view into scrollback, it pushes nothing instead of a dead streaming snapshot.

## Implementation Details

**Root cause analysis**: Bubbletea V2's `Program.Println()` works via `renderer.insertAbove()`, which scrolls the terminal, pushing the **entire current `View()` content** into scrollback. When `ToolWaitingApprovalEvent` arrived, the pre-switch handlers in `handleEvent` (`finishAIStreamIfNeeded`, `flushPendingReads`) could call `Println` while the model still had `streamingActive=true`. This pushed a snapshot of the streaming view — the partial Write block — into scrollback. The approval flow then committed the *full* expanded view via `tea.Println()`, producing two Write blocks.

**Fix** (in `run_stream_inline.go`): Added an early interception at the top of `handleEvent`:

```go
if e, ok := event.(executiontui.ToolWaitingApprovalEvent); ok && e.ToolCallID == r.activeStreamToolID {
    if r.cfg.program != nil {
        r.cfg.program.Send(streamingHideMsg{})
    }
}
```

This leverages Bubbletea's FIFO message channel — `streamingHideMsg` is processed before any subsequent messages from `Println`, ensuring the model's view is clear before `insertAbove` runs.

**Test** (in `run_stream_inline_bubbletea_test.go`): Added `TestInlineBubbleModel_StreamingHide_BeforeApprovalStart` which verifies the exact message sequence:

1. `streamingShowMsg` → streaming active, View() has content
2. `streamingUpdateMsg` → content accumulated
3. `streamingHideMsg` → View() returns "", `streamingActive` cleared
4. `approvalStartMsg` → approval active, expanded content committed

## Benefits

- Clean, single Write block in terminal scrollback during approval
- No flickering or stale content during the streaming → approval transition
- Minimal, surgical fix (16 lines of code + 69 lines of test)
- No changes to the Bubbletea model or approval flow logic

## Impact

- **End users**: Approval flow for file-writing tools (`Write`, `EditFile`, etc.) now renders cleanly without duplicate blocks
- **Maintainability**: The fix is localized and well-documented with a detailed comment explaining the Bubbletea V2 scrollback mechanism

## Related Work

- Part of the Bubbletea V2 upgrade project (`20260305.03.bubbletea-v2-upgrade`)
- Builds on Phase 5 cleanup which documented the `insertAbove` scrollback pattern
- Related design decision: `_projects/2026-03/20260305.01.bubbletea-inline-renderer/wrong-assumptions/001-single-writer-all-through-println.md`

---

**Status**: ✅ Production Ready
**Files Changed**: 2 (1 fix + 1 test)
