# Fix Approval Flow: Split-Commit Architecture for Full Content and Visible Options

**Date**: March 5, 2026

## Summary

Redesigned the CLI approval flow to use a split-commit architecture where full file content is committed to terminal scrollback via `tea.Println` while only the interactive question and menu remain in Bubbletea's live `View()` region. This fixes five interrelated rendering bugs: content truncation, invisible menu options, empty streaming headers, duplicate Write headers, and separator misalignment.

## Problem Statement

The approval flow crammed the entire display (expanded content + question + menu) into Bubbletea's `View()` function. When the content exceeded the terminal height, Bubbletea's internal cursor math broke, causing cascading visual failures.

### Pain Points

- **Content truncated**: Users saw "+32 more lines" during approval instead of the full file content they needed to review
- **Menu options invisible**: Yes/Skip/Reject choices were not displayed — only the hint line "1/1-3 select · esc/ctrl+c exit" was visible
- **Empty Write path during streaming**: `Write()` showed with no file path while content streamed, then a second `Write(filename)` header appeared after streaming
- **Duplicate headers**: Two Write headers visible after streaming completes (one empty, one with path)
- **\r\n line endings in View()**: `RenderMenu` used `\r\n` which is correct for direct terminal writes but causes options to overwrite each other in Bubbletea's `View()` function

## Solution

Split the approval display into two rendering regions:

1. **Scrollback** (via `tea.Println`): Full expanded content — separator + header + ALL file content + separator — committed permanently to terminal history with no height limit
2. **Live View** (via `View()`): Only the question line + approval menu (≈6 rows) — always fits within the terminal, always visible, cleanly erasable after decision

This mirrors the pattern already established by the AI output consolidation (committed complete lines via `Println`, partial line in `View()`).

## Implementation Details

### Message Type Restructuring

Split `approvalStartMsg` and `approvalShowMsg` from a single `content` field into `expandedContent` (for scrollback) + `question` (for View). Added `streamingHeaderUpdateMsg` for dynamic header updates when the tool's primary arg becomes available mid-stream.

### Handler Changes

`handleApprovalStart` and `handleApprovalShow` now atomically: clear the streaming view, commit expanded content via `tea.Println`, and render only the question + menu in `View()`. Both also clear AI streaming state (`aiStreamActive`/`aiStreamPartial`) to ensure approval takes visual priority.

### Full Content View

Added `buildFullExpandedView` method that renders separator + header + ALL content lines + separator without any truncation. The Bubbletea path uses this for the scrollback commit. The existing truncated `buildExpandedView` is retained for streaming preview.

### Dynamic Streaming Headers

Added `lastStreamHeader` tracking on `inlineRenderer`. On each `ToolStreamDeltaEvent`, the header is rebuilt — if the primary arg has appeared (e.g., file path now populated), a `streamingHeaderUpdateMsg` updates the header in-place without resetting accumulated content.

### Menu Line Endings

Added `RenderMenuForView()` using `\n` line endings for Bubbletea's `View()`. The existing `RenderMenu` with `\r\n` is preserved for the direct terminal write path used by `PromptWithLineCount`.

### Enhanced Rejection Connector

`buildApprovalConnector` now produces descriptive rejection text matching Claude Code style: "User rejected create to config.go" instead of generic "Rejected".

## Benefits

- **Full content always visible**: No more "+N more lines" truncation during approval review — users can scroll up to see the entire file
- **Menu always rendered**: Yes/Skip/Reject options are always visible regardless of content length
- **Clean transitions**: No rendering artifacts during streaming → approval transition
- **Dynamic headers**: File path appears in the streaming header as soon as it's available, eliminating the empty `Write()` followed by `Write(filename)` duplicate
- **Descriptive rejections**: Post-decision compact view tells users exactly what was rejected and where

## Impact

- **13 files modified** across `cmd/stigmer/root/`, `pkg/approval/`, and `pkg/toolrender/`
- **+330 / -58 lines** net change including comprehensive test updates
- All existing tests updated and passing; new tests added for split-commit behavior, `streamingHeaderUpdateMsg`, `RenderMenuForView`, and enhanced connector text
- Zero breaking changes to external APIs — all changes are internal to the rendering pipeline

## Related Work

- Builds on the AI output consolidation through Bubbletea (`2026-03-05-094822-consolidate-ai-output-through-bubbletea.md`) which established the `Println` + `View()` split pattern
- Extends the expand/collapse toggle system (Phase 3) by keeping history records lightweight (compact-only, no full expanded replay)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
