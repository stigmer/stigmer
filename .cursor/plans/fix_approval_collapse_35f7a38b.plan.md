---
name: Fix Approval Collapse
overview: Replace the broken DEC cursor save/restore mechanism with a content viewport + deterministic row-counting erasure approach that is immune to terminal scrolling. This eliminates the persistent ghost content bug when approving or rejecting tool calls with long content.
todos:
  - id: add-height
    content: Add `Height()` function to `termctl` package
    status: completed
  - id: truncate-helper
    content: Add `TruncateContent(content, maxLines, maxWidth)` helper in `toolrender/render_approval.go`
    status: completed
  - id: cap-streaming
    content: Cap streaming content display in `initPreApprovalStreaming` and `renderToolStreamDelta`
    status: completed
  - id: fix-approval-display
    content: Rewrite `prepareApprovalDisplay` to use content viewport + EraseLines instead of cursor save/restore
    status: completed
  - id: fix-finalize
    content: Update `finalizeApproval`, `handleNonInteractiveApproval`, `handlePromptError` to always use EraseLines
    status: completed
  - id: remove-cursor-saved
    content: Remove `cursorSaved` field and all `SaveCursor`/`RestoreCursorAndClear` from approval flow
    status: completed
  - id: tests
    content: Update and add tests for content truncation, streaming cap, deterministic erasure, Height()
    status: completed
isProject: false
---

# Fix Approval Collapse: Replace Cursor Save/Restore with Content Viewport + Deterministic Erasure

## Root Cause Analysis

The approval collapse uses DEC cursor save/restore (`ESC 7` / `ESC 8`) to erase the expanded preview after the user decides. **This mechanism is fundamentally broken for a streaming CLI** because:

1. `ESC 7` saves a **screen-relative** position (row, column on the visible screen)
2. When content printed after the save causes the terminal to scroll, the saved position becomes stale
3. `ESC 8` restores to the stale position (e.g. row 40), which now points to content BELOW the original save point
4. `CSI J` (clear to end of screen) erases nothing meaningful

**Concrete example** from the user's scenario:

- Cursor is at bottom of screen (row 40 of 40). `SaveCursor` saves row=40.
- 80 lines of YAML stream in. Terminal scrolls 80 times. Saved position (row 40) now points to the last line of YAML, not the start.
- `RestoreCursorAndClear` goes to row 40 and clears 1 row. 79 lines of ghost content remain.

The `prepareApprovalDisplay` content-streamed path makes this worse: it calls `RestoreCursorAndClear` (which fails), then `SaveCursor` (which saves AFTER the ghost content), then prints the expanded view BELOW the ghost content. The user sees doubled content.

**This is not a fixable edge case in the save/restore approach.** Cursor at the bottom of the screen is the NORMAL state in a streaming CLI. Any non-trivial content triggers scrolling, and save/restore fails silently.

## Previous Fix History

1. `**EraseLines` with `DisplayRows`** (original) -- Row miscounting for long lines caused partial erasure
2. `**Unwrap()` for writer chain** -- Fixed `IsSupported` returning false through `lineCountingWriter`
3. **DEC cursor save/restore** (current) -- Silently fails when scrolling occurs

Each fix patched a symptom. The structural problem is trying to erase an unbounded amount of content from a scrolling terminal without knowing the actual screen geometry.

## Solution: Content Viewport + Deterministic EraseLines

Instead of trying to erase an unknown amount of content, **cap the displayed content so its row count is deterministic and small**, then erase with `EraseLines(exact_count)`.

### Design Principles

- **Bounded content**: The expanded approval view must never exceed `termHeight - overhead` lines, where overhead covers separators, header, question, and menu
- **Width-clamped lines**: Each content line is truncated to `termWidth - 1` columns, preventing line wrapping and making the row count equal to the line count
- **Deterministic erasure**: With known height and no wrapping, `EraseLines(N)` is exact
- **No cursor save/restore**: The `cursorSaved` field and all `SaveCursor`/`RestoreCursorAndClear` calls are removed from the approval flow entirely

### Why This Is Robust

- **Scrolling**: With capped content, the total display (content + overhead) is smaller than `termHeight`. If the cursor was near the bottom when rendering started, some scrolling still occurs, but `EraseLines(N)` with the exact row count correctly moves up from the current position and clears exactly our content. (Scroll moved our content up; `EraseLines(N)` follows it.)
- **Terminal resize**: Content was capped at render time. If the terminal narrows between render and erase, line wrapping could add rows. The width-clamped lines prevent this -- they were truncated at the original width and won't wrap even on a narrower terminal.
- **Writer wrappers**: `EraseLines` writes escape codes through the wrapper chain. No `IsSupported` gating is needed for the erase operation itself (only for the initial `canCollapse` check).

## Files to Change

### 1. `client-apps/cli/pkg/termctl/termctl.go` -- Add `Height()` function

Add a `Height(w io.Writer, defaultHeight int) int` function mirroring the existing `Width()`. Uses `term.GetSize` which returns both dimensions. Needed by the approval flow to compute the content budget.

### 2. `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` -- Update struct fields

- Remove `cursorSaved bool` field
- Add `maxStreamContentLines int` -- content line cap for the streaming path (set during `initPreApprovalStreaming`, consumed by `renderToolStreamDelta`)
- Add `streamContentLines int` -- lines of content actually displayed during streaming (excluding header)
- Add `streamTruncationShown bool` -- whether the truncation indicator is currently displayed

### 3. `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go` -- Core fix

**New constant and helper**:

```go
const approvalOverheadRows = 10

func approvalContentBudget(termHeight int) int {
    budget := termHeight - approvalOverheadRows
    if budget < 5 {
        budget = 5
    }
    return budget
}
```

`**prepareApprovalDisplay**` -- Remove all `SaveCursor`/`RestoreCursorAndClear`. Both the content-streamed and non-streamed paths:

- Compute `maxContentLines` from `approvalContentBudget(termHeight)`
- Build the expanded view with truncated content (`buildExpandedView` gains `maxContentLines` parameter)
- Return the deterministic row count

For the content-streamed path specifically:

- Use `EraseLines(streamedRows)` to erase the streamed content (which was already capped during streaming), then print the expanded view fresh. No cursor save/restore.

`**buildExpandedView**` -- Accept `maxContentLines` and `width` parameters. After `ExpandedApprovalContent(tc)`, truncate content to `maxContentLines` lines with each line clamped to `width - 1` columns. Show "... +N more lines" if truncated.

`**finalizeApproval**` -- Remove the `cursorSaved` branch. Always use `EraseLines(totalRows)` when `canCollapse`. Cap `totalRows` at `termHeight` as defense-in-depth.

`**handleNonInteractiveApproval**` -- Remove `cursorSaved` branch. For `contentStreamed`, use `EraseLines(streamedRows)`.

`**handlePromptError**` -- Remove `cursorSaved` branch. Use `EraseLines(renderedRows)`.

### 4. `client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go` -- Cap streaming content

`**initPreApprovalStreaming**`:

- Remove `termctl.SaveCursor` and `r.cursorSaved = true`
- Compute `r.maxStreamContentLines` from terminal height
- Initialize `r.streamContentLines = 0` and `r.streamTruncationShown = false`

`**renderToolStreamDelta**`:

- Before appending content, check if `streamContentLines >= maxStreamContentLines`
- If over limit: update the truncation indicator ("... +N more lines") in place (erase 1 line, re-print with updated count). Do not append more content.
- If under limit: append content as before, but truncate each line to `width - 1` columns. Increment `streamContentLines` for each newline.

`**renderToolWaitingApproval**` (in `run_stream_inline.go`):

- The `streamedRows` count now accurately reflects the capped, width-truncated content

`**clearStreamingState**`: Reset the new fields.

### 5. `client-apps/cli/pkg/toolrender/render_approval.go` -- Content truncation helper

Add a `TruncateContent(content string, maxLines, maxWidth int) string` function:

- Splits content by newlines
- Truncates to `maxLines` lines
- Each line clamped to `maxWidth` visible characters (using `ansi.StringWidth` and `runewidth`-aware truncation)
- Appends "... +N more lines" footer if truncated

This is used by both `buildExpandedView` and the streaming content path.

### 6. Test Updates

- `run_stream_inline_approval_test.go`: Remove all `cursorSaved` assertions. Add tests for content truncation in `buildExpandedView`. Add test for streaming content capping. Add test that `finalizeApproval` uses `EraseLines` (verify ANSI sequences in output buffer).
- `run_stream_inline_streaming_test.go`: Add test for `maxStreamContentLines` enforcement. Test that long streaming content is capped and truncation indicator is shown.
- `toolrender/render_approval_test.go`: Add tests for `TruncateContent` with various line counts and widths.
- `termctl/termctl_test.go`: Add test for new `Height()` function.

## Key Decision: No Alternate Screen Buffer

Alternate screen (`CSI ?1049h`) was considered -- it would be 100% reliable (no row counting needed). It was rejected because:

- The user's expectation is **in-place replacement** ("the question will disappear and the summarized one should come up"), not a full-screen switch
- It disrupts the streaming UX (switching mid-stream is jarring)
- It adds complexity (emergency restore on crash, `lineCountingWriter` interaction, subject updater interference)
- Content viewport + deterministic erasure achieves the same reliability for this use case

## Risks and Mitigations

- **Risk**: `DisplayRows` accuracy for the overhead rows (header, question) which contain styled text. **Mitigation**: The overhead is small (8-10 rows). Even a 1-row error is acceptable -- at worst 1 row of ghost content or 1 row of erased previous content. The content viewport eliminates the 80+ line ghost content scenario.
- **Risk**: Terminal resize between rendering and erasure. **Mitigation**: Width-clamped lines don't wrap even on a narrower terminal. Height changes can't add rows to existing content.
- **Risk**: `EraseLines` no-op on non-TTY. **Mitigation**: Same as current -- `canCollapse` check gates all erasure. Non-TTY gracefully degrades (content stays in scrollback).

