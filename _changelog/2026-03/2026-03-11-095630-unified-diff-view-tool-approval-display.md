# Unified Diff View for Tool Approval Display

**Date**: March 11, 2026

## Summary

Added git-diff-style unified diff rendering to the CLI's tool approval display for both edit and write tools. Instead of showing the raw new content, users now see exactly what lines are being added, removed, or changed — colored in green/red with context lines, matching the familiar `git diff` format.

## Problem Statement

When the CLI prompted for approval on an edit or write tool call, the expanded view dumped the entire `new_text` or `content` as plain text. There was no way to see **what changed** — only what the new content would be. For large files with a single-line change, the user had to mentally diff the old and new content to understand the edit.

### Pain Points

- Edit tool approvals showed the full replacement text with no indication of what lines changed
- Write tool approvals showed the full new content with no comparison against the existing file
- Large file edits required scrolling through hundreds of unchanged lines to find the actual change
- No visual distinction between added, removed, and unchanged lines

## Solution

Two-layer architecture separating diff computation/styling (pure, zero I/O) from file reading (TUI layer):

- **Edit tools**: `old_text` and `new_text` are already in `ToolCall.args` from the backend. The diff is computed purely from these args — no filesystem access needed.
- **Write tools**: The CLI reads the existing file from disk using the already-available `workspaceRoots` and `sandboxRoot`, then computes the diff against the new content. Gracefully degrades to raw content when the file is inaccessible (remote sandbox, new file, permission denied).

## Implementation Details

### New: `toolrender/diff.go`

Core diff rendering module with zero I/O:

- `FormatDiff(oldText, newText)` — computes unified diff via `go-difflib` with 3 context lines, applies ANSI coloring per line type. Skips `---`/`+++` file headers since the path is already in the tool header.
- `FormatDiffPreview(oldText, newText, maxLines)` — truncated, indented diff for collapsed post-decision previews.
- `IsEditTool`, `IsWriteTool`, `IsCreateTool` — label-based predicates splitting the existing `IsWriteOrEditTool` into distinct categories.
- `ToolFilePath` — extracts the file path from tool args using `toolDisplayMap` field configuration.

Color scheme: removed lines (red/color 1), added lines (green/color 2), context lines (dim/color 8), hunk markers (dim+bold).

### Modified: `toolrender/render_approval.go`

- `ExpandedApprovalContent` detects edit tools and extracts `old_text`/`new_text` from args for diff rendering, with graceful fallback when `old_text` is missing.
- `ExpandedApprovalContentWithExisting` — new function for write tools where existing content is provided by the TUI layer.
- `RenderApprovalResult` routes through `resolveApprovalPreview` which produces diff previews for both edit and write tools in collapsed post-decision results.
- `RenderApprovalResultWithOldContent` — new function for write tool collapsed results with diff preview.

### Modified: TUI Layer (`run_stream_inline_approval_display.go`)

- `resolveExpandedContent` — orchestrates content resolution: reads existing file for write tools, delegates to diff-aware toolrender functions.
- `resolveAndReadExistingFile` — resolves relative path against workspace roots and sandbox root, reads file from disk. Returns empty on any failure.
- `formatCollapsedResult`, `printCollapsedResult`, `recordApproval` — propagate `existingContent` through `waitingApprovalState` and `committedItem` for both live rendering and history re-renders.

### Modified: `render_compact.go`

- `ResolveFilePath` — new exported wrapper around the private `resolveWorkspacePath`, enabling the TUI layer to resolve tool file paths for reading.

### Dependency

- `go-difflib` promoted from indirect to direct dependency (already in module graph via testify).

## Benefits

- Users can instantly see what an edit/write tool will change without manually diffing
- Large file edits with small changes produce compact diffs (3 context lines) instead of hundreds of lines
- Familiar git-diff color scheme (red/green) requires no learning curve
- Edit tools work purely from args — no filesystem access, no latency
- Write tool diffs gracefully degrade when files aren't locally accessible

## Impact

- **End users**: Significantly improved approval UX for all edit and write tool calls. The approval prompt now answers "what will change?" instead of just "what will the new content be?"
- **Codebase**: Clean separation of concerns — diff logic is pure (testable without I/O), file reading is in the TUI layer only. 15 new unit tests for diff rendering, 8 new tests for approval integration.

## Related Work

- [Expandable HITL Approval Content](2026-03-03-084312-expandable-hitl-approval-content.md) — original expanded approval view
- [Show Full Content in Approval Expanded View](2026-03-07-101936-show-full-content-in-approval-expanded-view.md) — pre-approval content display
- [Full Content Pre-Approval Streaming](2026-03-06-021906-full-content-pre-approval-streaming.md) — streamed content before approval

---

**Status**: ✅ Production Ready
