# Fix Approval Collapse Erasure and Upgrade Follow-up Prompt UX

**Date**: March 5, 2026

## Summary

Replaced the fragile `DisplayRows`-based row counting in the approval collapse flow with ANSI cursor save/restore, eliminating the persistent partial-erasure bug where write tool expanded previews were only half-erased after approval. Additionally upgraded the follow-up input prompt from a bare `>` marker to a three-section layout with separator, keyboard hints, and styled prompt, matching the Claude Code-style conversational input UX.

## Problem Statement

Two user-facing UX issues in the CLI inline renderer:

### Pain Points

- **Partial collapse on write tool approval**: After approving a write tool, only the bottom half of the expanded preview was erased. The top portion (separator + header + first N lines of content) remained as ghost content above the collapsed result. Root cause: `DisplayRows` underestimated actual terminal rows because long lines wrapping at the terminal edge created more visual rows than the width-based calculation predicted.
- **Minimal follow-up prompt**: The follow-up input prompt was a bare `> ` symbol with no visual separation from the preceding output, no keyboard hints, and no boundary between the AI output region and the user input region. This fell short of the three-section conversational layout (output / input / hints) that modern CLI agents like Claude Code provide.

## Solution

### Issue 1: Cursor Save/Restore for Approval Collapse

Instead of computing row counts (inherently fragile due to terminal wrapping, resize, and width detection variance), the approval flow now saves the cursor position before rendering the expanded preview and restores it after the user decides. The restore also clears everything from the saved position to the end of the screen, guaranteeing complete erasure regardless of content wrapping.

**Key design decision**: Uses DEC-style save/restore (`ESC 7` / `ESC 8`) rather than SCO-style (`CSI s` / `CSI u`). The session header subject updater already uses SCO-style for in-place header updates. Most modern terminals (iTerm2, Terminal.app, Alacritty, kitty, WezTerm, Windows Terminal) maintain independent save slots for DEC and SCO, avoiding conflicts between the two concurrent save/restore users.

### Issue 2: Three-Section Follow-up Prompt

The follow-up prompt now renders:

```
────────────────────────────────────────
  enter send · ctrl+c exit
> [cursor]
```

The hint sits above the prompt so that Enter's terminal echo doesn't overwrite it — no cursor repositioning sequences needed. After the user submits input, all four rows (separator + hint + prompt + cursor-after-enter) are erased and replaced with the styled user message block.

## Implementation Details

### termctl Package

- Added `SaveCursor(w)` — emits DEC `ESC 7`, no-op on non-TTY writers
- Added `RestoreCursorAndClear(w)` — emits DEC `ESC 8` + `CSI J`, no-op on non-TTY writers

### Approval Flow (run_stream_inline_approval.go)

- `prepareApprovalDisplay` saves cursor before rendering the expanded view (non-streaming path)
- `finalizeApproval` uses `RestoreCursorAndClear` when `cursorSaved` is true, falls back to `EraseLines` otherwise
- `handleNonInteractiveApproval` uses restore for content-streamed case
- `handlePromptError` uses restore for the error fallback path
- `cursorSaved` is unconditionally reset to `false` at the end of every path

### Streaming (run_stream_inline_streaming.go)

- `initPreApprovalStreaming` saves cursor before rendering separator + header (streaming path)

### State Tracking (run_stream_inline.go)

- Added `cursorSaved bool` field to `inlineRenderer`

### Follow-up Prompt (run_stream_inline_followup.go, run_display.go)

- Added `followUpHintStyle` (dim italic, color "8") for keyboard hints
- Added `followUpSepWidth` (40) and `followUpPromptRows` (4) constants
- `readFollowUpInput` renders separator + hint + prompt marker
- `runInlineFollowUpLoop` erases 4 rows (up from 2) after input

### Tests

- 4 new cursor-save/restore tracking tests in approval tests
- `initPreApprovalStreaming` test verifies `cursorSaved` flag
- Follow-up prompt test verifies separator and hint text in output
- All 69 tests in the package pass

## Benefits

- **Complete erasure guaranteed**: The cursor save/restore approach eliminates the entire class of row-miscounting bugs — no more ghost content after approval, regardless of terminal width, content wrapping, or resize
- **Graceful degradation**: On non-TTY writers and dumb terminals, save/restore is a no-op and the existing `EraseLines` fallback is preserved
- **Better conversational UX**: The three-section follow-up prompt gives users clear visual cues for where to type and what keyboard shortcuts are available
- **No new dependencies**: Uses lipgloss and termctl already in the tree

## Impact

- **End users**: Write/edit tool approvals now cleanly collapse without leftover ghost content; the follow-up prompt is more discoverable and informative
- **Maintainers**: The save/restore approach is simpler to reason about than `DisplayRows` calculations — fewer edge cases, no width arithmetic
- **Architecture**: DEC/SCO save-slot separation is documented in termctl for future developers working with cursor control

## Related Work

- [Fix approval collapse broken by writer wrapper](2026-03-04-122722-fix-approval-collapse-broken-by-writer-wrapper.md) — addressed `termctl.IsSupported` failing through `lineCountingWriter`, restoring collapse but not fixing the row count
- [Styled user messages and input prompt](2026-03-04-123306-styled-user-messages-and-input-prompt.md) — introduced the `promptStyle` and `humanMsgStyle` used by this change
- [Fix AI stream duplication and write tool path](2026-03-05-003040-fix-ai-stream-duplication-and-write-tool-path.md) — concurrent fix for streaming rendering issues

---

**Status**: ✅ Production Ready
**Files changed**: 10 (6 production, 4 test)
