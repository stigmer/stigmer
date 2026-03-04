# Fix Approval Separator Width and Streaming Header Path

**Date**: March 5, 2026

## Summary

Fixed three interrelated UX defects in the CLI's tool call approval flow: the hardcoded 24-character separator line, the missing file path in the `Write()` streaming header, and broken newline alignment before the bottom separator.

## Problem Statement

When a write/edit tool call required user approval, the pre-approval display had three visual issues that degraded the experience.

### Pain Points

- The horizontal separator between streamed content and the approval menu was only 24 characters wide regardless of terminal width, looking conspicuously short on normal-width terminals.
- The `Write()` tool header during streaming showed no file path (`Write()` instead of `Write(path/to/file.yaml)`) because the backend populates `tc.Args` only after the tool call argument JSON is fully parsed, which happens after streaming completes.
- When streamed content didn't end with a newline, the bottom separator rendered on the same line as the last content character.

## Solution

Made `ApprovalSeparator` width-aware and changed `prepareApprovalDisplay` to erase-and-rerender the expanded view at approval time using complete Args.

The key insight: by the time the approval prompt appears, the `ToolWaitingApprovalEvent` has already delivered the complete `ToolCallInfo` with fully populated Args (including the file path). Rather than patching the streaming header retroactively, the renderer erases the incomplete streaming output via cursor restore and re-renders the full expanded view with the correct header and terminal-width separators.

## Implementation Details

### `render_approval.go`
- Removed `approvalSeparatorWidth = 24` constant.
- Changed `ApprovalSeparator()` to `ApprovalSeparator(width int)` with a fallback to 80 for zero/negative width.

### `run_stream_inline_streaming.go`
- Updated `renderStreamHeader` to compute terminal width first and pass it to `ApprovalSeparator(width)`.

### `run_stream_inline_approval.go`
- `prepareApprovalDisplay`: When content was streamed and cursor control is available, erases the incomplete streaming output via `RestoreCursorAndClear`, re-saves the cursor, and renders the full expanded view from `buildExpandedView(tc, width)` where `tc` has complete Args with the file path.
- `buildExpandedView`: Added `width int` parameter, passed to `ApprovalSeparator(width)`.
- Both the streamed and non-streamed paths in `prepareApprovalDisplay` now use the same `buildExpandedView` rendering, eliminating the divergent code paths.

### Test updates
- `render_approval_test.go`: Replaced fixed-width separator tests with `TestApprovalSeparator_MatchesRequestedWidth` (multiple widths) and `TestApprovalSeparator_DefaultsOnZeroWidth`.
- `run_stream_inline_approval_test.go`: Updated 4 `buildExpandedView` calls to pass width.
- `run_stream_inline_streaming_test.go`: Renamed `TestInteractiveApproval_ContentStreamed_AddsSeparator` to `TestInteractiveApproval_ContentStreamed_ReRendersWithPath` and added `TestPrepareApprovalDisplay_StreamedPath_SetsCursorSaved`.

## Benefits

- Separator lines now span the full terminal width, matching the visual conventions of established CLI tools.
- The `Write(path/to/file)` header is always present when the approval prompt appears, giving the user immediate context about which file is being created.
- The newline alignment issue is eliminated by the erase-and-rerender approach, since `buildExpandedView` ensures proper newlines between content and separators.
- Eliminated divergent rendering paths in `prepareApprovalDisplay` (streamed vs non-streamed now share the same `buildExpandedView` call).

## Impact

- **CLI users**: Approval prompts now display correctly at all terminal widths with file paths visible in the header.
- **Codebase**: 6 files changed, 73 insertions, 41 deletions. No new dependencies.
- **Backward compatibility**: No breaking changes. The `ApprovalSeparator` signature change is internal to the CLI.

---

**Status**: ✅ Production Ready
