# Shell Tool Compact Rendering (Phase 2.3)

**Date**: March 4, 2026

## Summary

Added compact inline rendering for shell/execute tool calls in the Stigmer CLI. Shell completions now display as a bullet-style header with the command, followed by truncated output lines — replacing the verbose emoji-badge gutter-bordered format. This is the third tool family (after read and write/edit) to graduate to compact rendering.

## Problem Statement

Shell tool calls in inline mode used the legacy `RenderWithBadge` format: emoji icon, colon-separated label, gutter-bordered content preview with `│` borders. This format was designed for the alt-screen TUI where space is constrained, but in inline mode it produced noisy, multi-line blocks that cluttered scrollback.

### Pain Points

- Shell tool output occupied 5+ lines per call (icon + header + gutter preview + "more lines" indicator)
- Emoji badges (`🖥`, `✓`, `⏳`) added visual noise without information value
- Gutter borders (`│`, `⋮`) consumed horizontal space and broke visual rhythm with compact read/write tools
- No command truncation — long `find` or `curl` commands produced wide, unreadable headers

## Solution

Extended the graduated compact rendering system (`RenderCompact` / `RenderCompactRunning`) to handle shell and execute tools. Shell tools now render with the same bullet-style visual language as read and write tools, with output-specific truncation.

## Implementation Details

- **`renderCompactShell`**: New function producing header + truncated output. Commands truncated to 60 chars via `firstLine` + `truncate`. Output cleaned through existing `resolveDisplayContent` → `CleanShellResult` pipeline. Up to 3 output lines shown with smart cutoff (show 4 if exactly 4 lines, otherwise truncate with `… +N more lines` footer).
- **`isShellLabel`**: Internal predicate covering "Shell" and "Execute" labels (mapped from 6 tool names: `shell`, `bash`, `execute`, `execute_command`, `run_command`, `terminal`).
- **`firstLine`**: Defensive helper extracting the first line from potentially multi-line command strings before truncation.
- **`hasCompactRenderer`** updated to include "Shell" and "Execute", enabling automatic compact running state (`● Shell(cmd) …`).
- **`RenderCompactRunning`** refactored: shell tools use command truncation instead of hyperlinked file paths.
- **No exit code display**: Confirmed design decision — `ToolCallInfo` has no `ExitCode` field, and parsing from result strings would couple the renderer to backend text format. Structure communicates state (output lines = success, `✗` = failure).

## Benefits

- Shell tool calls reduced from 5+ lines to 2-4 lines in typical usage
- Consistent visual language across read, write/edit, and shell tools
- Long commands no longer produce unreadable wide headers
- Legacy format labels (`Exit code: 0\nSTDOUT:\n...`) automatically cleaned
- Zero changes to inline renderer (`run_stream_inline.go`) — graduated routing pattern works as designed

## Impact

- **End users**: Cleaner, more scannable inline output when agents run shell commands
- **Maintainers**: Shell tools follow established compact rendering patterns; next tool families (Phase 2.4) follow the same template
- **Test coverage**: 25 new test functions covering all shell compact rendering paths

## Related Work

- Phase 2.1: Read tool compact rendering (`5a87c60c`)
- Phase 2.1b: Read consecutive-event grouping (`7b3ad46e`)
- Phase 2.2: Write/edit tool compact rendering (`3dfcef8e`)
- Phase 2.4 (next): Other tools compact rendering (glob, search, delete, think)

---

**Status**: ✅ Production Ready
