# Fix AI Stream Gap and Markdown Rendering in CLI TUI

**Date**: March 7, 2026

## Summary

Fixed two rendering bugs in the Stigmer CLI's inline TUI that affected the visual quality of AI streaming responses. After a tool completion, the subsequent AI message appeared flush against the tool block with no visual gap. Additionally, AI messages containing markdown were displayed as raw text during streaming instead of being rendered with glamour formatting.

## Problem Statement

The inline TUI streams AI responses token-by-token through Bubbletea. Two distinct rendering paths exist: committed scrollback lines (processed through `writeToScrollback` with full gap and formatting logic) and transient partial content (shown live in `View()` with no gap or markdown logic).

### Pain Points

- After a tool call completes, the first AI streaming tokens appear directly below the tool block with no visual separation, making the output feel cramped and harder to scan
- AI responses containing markdown (headers, code blocks, lists, bold text) render as raw markdown syntax during streaming, only getting glamour-formatted in the history record but never replacing the raw scrollback lines

## Solution

Two targeted changes in `renderAIStreamStart` and `renderAIStreamEnd` within `run_stream_inline_aistream.go`, both leveraging existing infrastructure rather than introducing new mechanisms.

## Implementation Details

### Gap fix — `renderAIStreamStart`

Before any streaming content is emitted, check `needsLeadingGap(r.lastScrollbackKind, kindAIStreamLine)`. When the previous scrollback item was a dense block (tool completion, read group), emit a blank line to scrollback via `statusf("\n")` and update `r.lastScrollbackKind` to `kindAIStreamLine`. This prevents a double gap when `commitAIStreamLines` later processes the first complete line through `writeToScrollback`, which runs the same `needsLeadingGap` check.

### Markdown re-commit — `renderAIStreamEnd`

After `recordAIMessage` stores the glamour-rendered version in history, check `mdrender.HasMarkdown(e.Content)`. When true, reset `r.lastScrollbackKind` via `lastKindFromHistory(r.history)` and call `triggerReCommit()` to atomically replace the raw scrollback with the rendered version. This reuses the same re-commit path as the Ctrl+O expand toggle — no new clearing or rendering mechanism needed. Plain-text responses stream without any re-commit overhead.

## Benefits

- Consistent visual spacing between tool completions and AI responses, matching the gap behavior of non-streamed messages
- Markdown-rich AI responses (code blocks, headers, lists) render with proper ANSI formatting in the terminal, matching the quality of non-streamed `renderAIMessage`
- Zero overhead for plain-text responses — the re-commit only triggers when `HasMarkdown` detects markdown syntax
- No new infrastructure — both fixes compose existing helpers (`needsLeadingGap`, `statusf`, `triggerReCommit`, `lastKindFromHistory`)

## Impact

All CLI users who interact with agents that produce tool calls followed by markdown-rich responses will see improved visual quality. The change is confined to a single file (`run_stream_inline_aistream.go`) with no API or behavioral changes visible to other components.

## Related Work

- Ctrl+O expand/collapse toggle that introduced the `triggerReCommit` infrastructure
- `needsLeadingGap` / `needsTrailingGap` gap logic in `run_stream_inline_history.go`
- `mdrender.HasMarkdown` / `mdrender.Render` glamour rendering in `pkg/mdrender/render.go`

---

**Status**: ✅ Production Ready
