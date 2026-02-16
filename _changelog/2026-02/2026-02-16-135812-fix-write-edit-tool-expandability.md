# Fix Write/Edit Tool Expandability in Execution TUI

**Date**: February 16, 2026

## Summary

Write and Edit tool calls in the CLI execution TUI were not expandable — they showed only a static header with no ability to preview or inspect their content. This change fixes two independent bugs: running tools finalized via DoneEvent were never converted to expandable blocks, and write/edit tools had no content preview configured. After this fix, all file-modifying tools (write, edit, create) show expandable 3-line previews with syntax highlighting, matching the existing Read tool experience.

## Problem Statement

When watching agent executions in the CLI TUI, tool calls for Write and Edit operations appeared as non-expandable single-line entries (e.g., `📝 Write: agent-drafter/SKILL.md ✓`), while Read tools showed rich expandable previews with file content, line counts, and syntax highlighting.

### Pain Points

- **Write/Edit tools were not expandable**: No `▶` indicator, no ability to press Enter to expand, no content preview — users had no visibility into what was written or edited
- **Race condition in tool finalization**: When execution completed, tools still tracked as "running" were finalized by just replacing `⏳` with `✓` via string substitution, but the block was never promoted to an expandable type
- **No content source for write tools**: Even on the proper ToolCompletedEvent path, write tools had `previewNone` configured, so both collapsed and expanded views showed only the header
- **Content was in args, not result**: For write/edit tools, the interesting content (what was written) lives in the tool arguments (`contents`, `new_text`), not in `tc.Result` which is typically a confirmation message

## Solution

Two-pronged fix addressing the block lifecycle bug and the missing content configuration:

1. **Store ToolCallInfo on running blocks** so DoneEvent finalization can create proper expandable blocks
2. **Add content resolution from args** so write/edit tools display their content via the same preview infrastructure as read tools

## Implementation Details

### Bug 1: Running tool block finalization (executiontui)

Added a `toolCall *toolrender.ToolCallInfo` field to `contentBlock` in `blocks.go`. When a `ToolRunningEvent` creates a running block, the tool call info is stored alongside it. The new `finalizeRunningTools()` method (extracted from three duplicate loops in DoneEvent, StreamErrorEvent, and handleStreamClosed) checks for stored tool call info and creates a proper expandable block with both preview and full content — matching exactly what `ToolCompletedEvent` produces.

### Bug 2: Write/Edit tool content support (toolrender)

Added `contentArgField` and `contentArgFallbacks` to `toolDisplayInfo` — these specify which arg fields contain displayable content for tools where the interesting data is in the arguments rather than the result.

The `resolveDisplayContent()` helper returns `tc.Result` for most tools, falling back to the configured arg field for write/edit tools. This is used by `renderKnown`, `renderKnownHeader`, and `RenderExpanded` so that the full preview/expand infrastructure works for file-modifying tools.

Tool configurations updated:
- `write`, `write_file`, `create_file`, `overwrite_file`: content from `contents` arg (fallbacks: `content`, `file_content`)
- `edit`, `edit_file`: content from `new_text` arg (fallbacks: `new_string`, `replacement`, `content`)

All configured with `previewFileContent` — showing 3-line gutter-bordered previews with syntax highlighting when collapsed, and full content when expanded.

## Benefits

- **Full content visibility**: Users can now expand Write and Edit tool calls to see exactly what the agent wrote or edited, with syntax highlighting
- **Consistent UX**: All file-related tools (read, write, edit) now share the same expandable preview pattern
- **Reliable expandability**: Tools finalized via DoneEvent are now properly expandable instead of static text — eliminates the race condition that left the last tool in a non-expandable state
- **Framework-agnostic**: Arg fallback chains (`contents`/`content`/`file_content` and `new_text`/`new_string`/`replacement`/`content`) handle naming variance across agent frameworks

## Impact

- **CLI execution TUI**: All file-modifying tool calls are now expandable with content previews
- **Agent runner**: The edit tool was also added to the auto-publish artifact safety net (companion commit)

## Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/pkg/executiontui/blocks.go` | Add `toolCall` field, update `newRunningToolBlock` signature |
| `client-apps/cli/pkg/executiontui/handle_events.go` | Extract `finalizeRunningTools()`, pass ToolCallInfo to running blocks |
| `client-apps/cli/pkg/toolrender/render.go` | Add `contentArgField`/`contentArgFallbacks` to `toolDisplayInfo`, update write/edit entries, update `RenderExpanded` |
| `client-apps/cli/pkg/toolrender/render_known.go` | Add `resolveDisplayContent` and `buildSuffixWithContent` helpers, update `renderKnown` and `renderKnownHeader` |

---

**Status**: ✅ Production Ready
