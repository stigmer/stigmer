# Consecutive-Event Read Grouping for Inline CLI

**Date**: March 4, 2026

## Summary

Added consecutive-event read grouping to the Stigmer CLI inline renderer, collapsing bursts of 3+ sequential read tool completions into a compact grouped display. This reduces terminal noise during the agent's information-gathering phase while preserving full context through hyperlinked file paths and line counts.

## Problem Statement

When an agent reads multiple files in sequence (a common pattern during context gathering), the inline renderer printed each read as a separate two-line block. An agent reading 8 files produced 16 lines of status output — enough to push the agent's actual response off-screen in a typical terminal window.

### Pain Points

- Reads are the most frequent tool call; verbose display dominated the terminal
- No visual grouping made it hard to distinguish "context gathering" from "taking action"
- Individual read blocks interrupted the flow between the agent's message and response

## Solution

Consecutive-event grouping: buffer read completions in the inline renderer and render them as a compact group when 3+ arrive back-to-back. The group flushes when any non-read visible event arrives (AI response, shell tool, write tool), which naturally corresponds to the agent switching from reading to acting.

## Implementation Details

### Formatting layer (`pkg/toolrender/render_compact.go`)

- `RenderReadGroup(reads, opts)`: Formats a header (`● Read N files`), up to 3 visible file entries with hyperlinked paths and line counts, and a truncation footer when needed
- `renderGroupEntry(tc, opts)`: Formats a single file line within a group — path in normal style for scanability, metadata dim
- Smart truncation: shows all files when count <= 4 (avoids pointless "+ 1 more"), truncates to 3 + "… +N more" for 5+
- Failed reads shown inline with error indicator; header notes failure count: `(M failed)`

### Orchestration layer (`cmd/stigmer/root/run_stream_inline.go`)

- `handleEvent` restructured: read completions, read running events, and tool stream deltas intercepted before the main switch statement
- `pendingReads` buffer on `inlineRenderer` accumulates consecutive read completions
- `flushPendingReads()` renders group (via `RenderReadGroup`) when buffer >= 3, or individually (via `RenderCompact`) otherwise
- Flush on context cancel and channel close to avoid losing buffered reads
- `ToolStreamDeltaEvent` explicitly excluded from flushing — concurrent streaming tools (e.g. shell) must not break read grouping

### Tests

8 new test functions covering: 3-file groups, 4-file smart cutoff, 6-file truncation, failure headers, all-failed groups, hyperlinks enabled/disabled, and single-file defensive case.

## Benefits

- 8 reads: 16 lines → 5 lines (header + 3 entries + "… +5 more")
- 3 reads: 6 lines → 4 lines (header + 3 entries)
- Clear visual boundary between "gathering context" and "taking action"
- File paths remain clickable (OSC 8 hyperlinks) within grouped entries

## Impact

- **End users**: Significantly less terminal noise during agent runs that read many files
- **Codebase**: Clean separation — formatting is stateless/pure in `toolrender`, buffering logic is in the orchestrator
- **Future phases**: Same consecutive-event pattern can be applied to write/edit grouping, shell grouping, or sub-agent tool grouping

## Related Work

- Phase 2.1: Compact read rendering (`5a87c60c`) — the individual format this builds on
- Phase 2.0: OSC 8 hyperlink primitives (`c595aa94`) — file hyperlinks reused in group entries
- Phase 2.2 (next): Write/Edit tool compact rendering

---

**Status**: ✅ Production Ready
**Commit**: `7b3ad46e`
