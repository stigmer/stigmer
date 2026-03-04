# Compact Read Tool Rendering (Phase 2.1)

**Date**: March 4, 2026

## Summary

Replaced the verbose multi-line gutter-bordered read tool display with a compact two-line format featuring OSC 8 clickable file paths. Read tool calls in inline mode now render as `● Read(path) / Read N lines` instead of a 5+ line block with syntax-highlighted content previews, dramatically reducing terminal noise during agent sessions.

## Problem Statement

The inline renderer used the same verbose `RenderWithBadge` format for all tool calls, including reads. A single read tool produced 5+ lines of output: an icon header with metadata, three lines of syntax-highlighted content behind a gutter border, and a "N more lines" indicator. During typical agent sessions that involve 10-30 reads, this created a wall of text that obscured the agent's actual reasoning.

### Pain Points

- Read tools are reconnaissance — users rarely care *what* was read, only *that* it happened
- 5+ lines per read tool multiplied by 10-30 reads per session = overwhelming terminal noise
- File content previews weren't actionable (too short to be useful, too long to skim)
- Both `ToolRunningEvent` and `ToolCompletedEvent` were rendered for reads, creating redundant output
- File paths were plain text — no way to quickly open the file the agent just read

## Solution

Introduced a compact rendering path (`RenderCompact`) for inline mode that produces a terse two-line format for read tools with clickable OSC 8 hyperlinks on file paths. Non-read tools fall back to the existing `RenderWithBadge` format, providing a graduated migration path for subsequent phases.

## Implementation Details

### New file: `pkg/toolrender/render_compact.go` (96 lines)

- `CompactOptions` struct with `HyperlinksEnabled` and `WorkingDir` fields, following the DI-over-hard-coding guideline — no environment reads inside formatting functions
- `RenderCompact(tc, opts)` as the graduated entry point — dispatches to compact format for implemented tools, falls through to `RenderWithBadge` for others
- `IsReadTool(name)` for tool category detection, following the `IsShellTool` pattern
- `renderCompactRead` builds the two-line format: green bullet + `Read(hyperlinkedPath)` header, dim `Read N lines` summary
- `buildHyperlinkedPath` resolves relative paths against `WorkingDir` and wraps in `FileHyperlink` from Phase 2.0

### New file: `pkg/toolrender/render_compact_test.go` (289 lines)

22 test functions covering: compact format with line counts, OSC 8 hyperlinks on/off, relative path resolution, absolute path passthrough, arg name fallbacks, failed reads with error truncation, empty results, `IsReadTool` categorization, and `RenderWithBadge` fallback for non-read tools.

### Modified: `cmd/stigmer/root/run_stream_inline.go`

- Added `compactOpts toolrender.CompactOptions` field to `inlineRenderer`, initialized once at startup with `HyperlinksEnabled` detection
- `renderToolRunning`: suppresses output for read tools (reads complete in <100ms; showing both running and completed is redundant noise)
- `renderToolCompleted`: routes through `RenderCompact` instead of `RenderWithBadge`

## Benefits

- Read tool output reduced from 5+ lines to 2 lines (60-80% reduction in vertical space)
- Clickable file paths via OSC 8 — one click opens the file the agent read
- Running event suppression eliminates redundant output for fast tools
- Graduated `RenderCompact` entry point enables incremental migration of other tools in Phases 2.2-2.4
- `CompactOptions` struct follows DI pattern — testable, no hidden environment coupling

## Impact

- **End users**: Dramatically cleaner inline mode output during agent sessions
- **Maintainers**: New compact rendering is isolated in `render_compact.go` (single responsibility), testable via `CompactOptions` injection, and extensible for future tool types
- **Architecture**: Establishes the pattern for all subsequent compact tool rendering phases

## Related Work

- Phase 2.0: OSC 8 file hyperlink primitives (`2026-03-04-011744-osc8-file-hyperlink-primitives.md`)
- Phase 1: Flip default to inline (`2026-03-04-005535-flip-default-to-inline-only.md`)
- Next: Phase 2.2 (Write/Edit compact), Phase 2.3 (Shell compact), Phase 2.4 (Other tools)

---

**Status**: Production Ready
**Timeline**: 1 session (~45 minutes)
