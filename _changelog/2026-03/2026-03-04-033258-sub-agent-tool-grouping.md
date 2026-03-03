# Sub-Agent Tool Grouping in Inline Renderer

**Date**: March 4, 2026

## Summary

Added visual grouping for sub-agent tool calls in the Stigmer CLI inline renderer. Inner tool events reuse existing compact renderers with a dim gutter prefix (`  │ `), wrapped in a Task header and Done/Failed footer. This brings sub-agent visibility to parity with top-level tool calls without introducing a second-class rendering path.

## Problem Statement

When the main agent delegates work to sub-agents (via the Task tool), the inline renderer had minimal visibility — a simple "Sub-agent started" / "Sub-agent completed" line with no detail about what the sub-agent actually did.

### Pain Points

- Sub-agent tool calls (Read, Write, Shell, etc.) were invisible to the user
- No visual hierarchy distinguishing sub-agent work from top-level work
- Sub-agent AI reasoning was rendered to stdout (polluting the main agent's data stream)
- Redundant events from the backend (both tool lifecycle and sub-agent lifecycle) needed deduplication

## Solution

Reuse existing compact renderers (`RenderCompact`, `RenderCompactRunning`, `RenderReadGroup`) and apply a `GutterWrap` function that prepends a dim `  │ ` prefix to each line. Sub-agent lifecycle events (`SubAgentStartedEvent`, `SubAgentCompletedEvent`) provide the header and footer.

## Implementation Details

### New rendering helpers (`render_compact.go`)

- **`IsTaskTool(name)`** — predicate for task tool detection, consistent with `IsReadTool`/`IsWriteOrEditTool` pattern
- **`GutterWrap(s)`** — prepends dim-styled `  │ ` to each line, visually nesting sub-agent content under the Task header
- **`BulletGreen(s)` / `LabelBold(s)`** — thin public wrappers exposing package-private lipgloss styles for the inline renderer's lifecycle handlers
- **`hasCompactRenderer`** — updated to include "Task" (all 12 known labels now covered)
- **`RenderCompactRunning`** — Task tool renders as `● Task: <description> …`

### Inline renderer changes (`run_stream_inline.go`)

- **`pendingRead` wrapper** — replaces `[]ToolCallInfo` with struct carrying `subAgentID`, enabling gutter-aware flush
- **6 pre-switch interceptions** — task tool running/completed suppressed (lifecycle events are richer); sub-agent AI start/delta suppressed, end/message emitted to stderr with gutter prefix
- **`renderToolRunning` / `renderToolCompleted`** — apply `GutterWrap` when `SubAgentID != ""`
- **`renderSubAgentStarted`** — `● Task: <description>` with green bullet + bold label
- **`renderSubAgentCompleted`** — `  ✓ Done (N tools)` or `  ✗ Failed (N tools)`
- **`flushPendingReads`** — extracts ToolCallInfo slice from wrappers, applies `GutterWrap` for sub-agent context

### Tests (`render_compact_test.go`)

- 18 new tests covering `IsTaskTool`, `GutterWrap` (single/multi-line, empty, pipe character), integration with existing renderers and read groups, Task running format, and style wrapper functions
- 3 existing tests updated to reflect Task label's new compact status

## Benefits

- **Consistent rendering**: Sub-agent tools render identically to top-level tools — same compact format, just indented with a gutter
- **Visual hierarchy**: The gutter clearly distinguishes sub-agent work from the main agent's actions
- **Clean stdout contract**: Sub-agent AI reasoning goes to stderr, preserving `stdout = final agent data` for piping
- **Zero new renderers**: Reuses existing `RenderCompact*` functions, reducing maintenance surface
- **Future-ready**: Gutter structure (header / guttered lines / footer) is the foundation for collapse/expand when terminal cursor control is added in Phases 3-4

## Impact

- CLI users see full detail of what sub-agents do, matching the visibility of top-level agent work
- Piping `stigmer run ... | process` still captures only the main agent's response
- Approval prompts for sub-agent tools already have `FromSubAgent`/`SubAgentName` context — visual grouping complements this

## Related Work

- Phase 2.1-2.4: Compact renderers for all tool types (the foundation this phase builds on)
- Phase 3-4: Terminal cursor control will enable collapse/expand on top of this gutter structure

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
