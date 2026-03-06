# Expanded Renderers for Tool Call Toggle (Phase 2)

**Date**: March 5, 2026

## Summary

Added expanded rendering functions to the `toolrender` package and wired them into the re-commit infrastructure, enabling the existing clear+re-commit mechanism from Phase 1 to replay session history in either compact or expanded mode. This is the rendering foundation for the upcoming Ctrl+O expand/collapse toggle feature.

## Problem Statement

Phase 1 established the event history retention and clear+re-commit mechanism, but it could only re-render in compact mode. For the expand/collapse toggle to work, every tool type needs an expanded rendering path that shows full output without truncation limits.

### Pain Points

- Shell tool calls truncate output to 3 lines — users can't see full command results without scrolling to the AI message
- Read groups cap at 3 visible entries — users can't see which files the agent read without counting
- Think tool truncates thoughts to 3 lines — users miss the agent's full reasoning
- Discovery tools show only a count ("Found 12 matches") — users can't see which files matched
- Unknown/MCP tools truncate to 3 result lines — users lose context from external tool output

## Solution

Two new public functions in the `toolrender` package (`RenderExpanded`, `RenderReadGroupExpanded`) provide expanded rendering for every tool type. An `expanded bool` parameter is threaded through the re-commit path so the clear+re-commit mechanism can choose between compact and expanded mode.

## Implementation Details

### New Expanded Renderers (`render_expanded.go`)

`RenderExpanded(tc ToolCallInfo, opts CompactOptions) string` routes by tool type:

- **Shell**: Same header (truncated command), ALL output lines (no `maxShellOutputLines` cap)
- **Think**: Same header, ALL thought lines (no `maxThinkLines` cap)
- **Discovery**: Same header, individual result entries instead of count summary
- **Unknown/MCP**: Same header + input args, ALL result lines (no `maxUnknownOutputLines` cap)
- **Read/Write/Delete**: Delegates to compact (identical — no truncation to lift)

`RenderReadGroupExpanded(reads []ToolCallInfo, opts CompactOptions) string` shows ALL entries in a read group. Same format as compact entries (hyperlinked path + line count), no file content. Lifts the `maxVisibleInGroup` (3) cap.

### Re-Commit Wiring

`expanded bool` parameter added to:
- `renderCommittedItem` — dispatches to expanded renderers when true
- `renderToolCompactItem` / `renderReadGroupItem` — call `RenderExpanded`/`RenderReadGroupExpanded` when expanded
- `reCommitHistory` — passes expanded to `renderCommittedItem`
- `reCommitMsg` — carries expanded flag from renderer to Bubbletea model
- `handleReCommit` — passes through to `reCommitHistory`

### Test Coverage

- 41 tests in `render_expanded_test.go` covering all tool types
- 7 expanded variants in `run_stream_inline_history_test.go`
- All 14 existing history tests updated for the new parameter
- Key behavioral tests: compact truncates while expanded shows all, headers match between modes, read/write/delete produce identical output in both modes

## Benefits

- **Foundation for Ctrl+O toggle**: Phase 3 only needs to add state management and keybinding — all rendering is ready
- **Zero behavioral change**: Normal rendering (`expanded: false`) produces identical output to the previous commit
- **Comprehensive test coverage**: 48 new tests validate both the rendering functions and the re-commit wiring
- **Clean separation**: Expanded renderers share header-building and error-handling helpers with compact, minimizing duplication

## Impact

- **CLI inline renderer**: Re-commit mechanism can now reconstruct session display in either mode
- **toolrender package**: New public API surface (`RenderExpanded`, `RenderReadGroupExpanded`) extends the rendering vocabulary
- **Users (upcoming)**: Will be able to toggle between compact and expanded views of tool call output

## Related Work

- Phase 1: Event history retention and subject update ([changelog](2026-03-05-070144-event-history-retention-and-subject-update.md))
- Phase 3 (next): Ctrl+O keybinding wiring — adds `expandMode` state and stdin ownership change
- Bubbletea migration (Phases 1-7): Foundation that made the event-driven re-commit architecture possible

---

**Status**: Production Ready
**Timeline**: ~1 hour (Phase 2 of 5)
