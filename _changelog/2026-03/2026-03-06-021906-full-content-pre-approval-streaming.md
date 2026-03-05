# Full-Content Pre-Approval Streaming and Approval Display

**Date**: March 6, 2026

## Summary

Replaced the capped pre-approval streaming model with progressive commit to scrollback, eliminating the "+ N more lines" truncation indicator and ensuring every line of tool output is visible during streaming. Broadened the streaming trigger from write/edit tools to any `IsStreaming` tool (including MCP), and improved content extraction for unknown tool types during approval display.

## Problem Statement

Two long-standing issues in the pre-approval flow made the approval experience incomplete and frustrating:

1. **Streaming truncation**: Pre-approval content was capped at `approvalContentBudget(termHeight)` lines (terminal height minus overhead). Files exceeding this budget showed a "+ N more lines" indicator, hiding the majority of the content the user was being asked to approve.

2. **Incomplete approval content for MCP tools**: The pre-approval streaming trigger only matched tools in the hardcoded `toolDisplayMap` via `IsWriteOrEditTool()`. MCP tools like `WriteFile` were excluded entirely. Additionally, unknown tool content extraction used `extractFirstArg()` which alphabetically picked the first argument — returning paths instead of file content.

### Pain Points

- Users could not review full file content before approving writes
- MCP tool writes bypassed the streaming typewriter effect entirely
- Approval prompts for unknown tools showed metadata instead of file content
- The cap existed to work around a Bubbletea inline-mode constraint where `View()` taller than the terminal causes scrollback artifacts

## Solution

Adopted the **progressive commit** architecture for pre-approval streaming, mirroring the proven pattern already used for AI text streaming (`aiStreamBuffer`). Complete lines are committed to terminal scrollback via `tea.Println` as they arrive, while `View()` renders only the current incomplete line — keeping the Bubbletea-managed region tiny regardless of content size.

## Implementation Details

### Progressive Commit in Bubbletea Model

Added `streamingProgressive` and `streamingCommittedLen` fields to `inlineBubbleModel`. When `progressive=true` (pre-approval):

- **`handleStreamingShow`**: Commits the separator + tool header to scrollback via `tea.Println` immediately. `View()` starts empty.
- **`handleStreamingUpdate`**: Compares accumulated content against `streamingCommittedLen` to identify new complete lines. Commits them to scrollback, stores only the remaining partial line for `View()`.
- **`handleStreamingHeaderUpdate`**: Ignores late updates in progressive mode (approval re-commit shows the correct header).
- **`formatStreamingView`**: Simplified to header + content assembly for non-progressive mode only. Removed all capping and width-clamping logic.

Post-approval shell streaming (`progressive=false`) retains the existing View()-based approach unchanged.

### Streaming Line Cap Removal

- Removed `maxStreamContentLines`, `streamContentLines`, `streamTruncationShown` fields from `inlineRenderer`
- Removed `renderStreamDeltaCapped`, `renderStreamOverflowUpdate`, `truncateLineWidth` methods
- `renderToolStreamDeltaDirect` simplified to always use uncapped mode
- `completeStreamingTool` (Bubbletea path) now triggers a re-commit instead of `streamingHideMsg{collapsedResult}`, atomically replacing progressively-committed scrollback with the authoritative history

### Broadened Pre-Approval Streaming Trigger

Changed the condition from:
```go
e.ToolCall.IsStreaming && toolrender.IsWriteOrEditTool(e.ToolCall.Name)
```
to:
```go
e.ToolCall.IsStreaming
```

The `IsStreaming` flag is the authoritative backend signal. Read and think tools are already intercepted upstream; task tools have their own handler.

### Improved Content Extraction for Unknown Tools

Added `extractLargestArg()` which selects the argument with the longest string value — reliably preferring file content over short metadata like paths. Replaced `extractFirstArg()` in `ExpandedApprovalContent` for unknown tool types.

### Message Type Cleanup

Replaced `maxLines int` + `width int` on `streamingShowMsg` with a single `progressive bool` flag, clarifying the semantic intent.

## Benefits

- **Full content visibility**: Every line of a file write streams to the terminal without truncation
- **MCP tool support**: Any streaming MCP tool gets the same pre-approval typewriter experience as built-in write/edit tools
- **Correct approval display**: Unknown tools show file content instead of path metadata
- **No Bubbletea overflow**: `View()` never exceeds a few rows, eliminating inline-mode scrollback artifacts
- **Simplified codebase**: Removed ~100 lines of capping, width-clamping, and truncation indicator code

## Impact

- **End users**: Can now review complete file content during pre-approval streaming and at the approval prompt for all tool types
- **MCP tool authors**: Tools that set `IsStreaming=true` automatically get progressive streaming
- **Maintainers**: Cleaner streaming architecture with a single progressive commit path instead of dual capped/uncapped logic

## Related Work

- Bubbletea v2 inline renderer migration (2026-03-05)
- Scrollback duplication fix via atomic re-commit (2026-03-06-013928)
- AI stream progressive commit pattern (established in `aiStreamBuffer`)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours
