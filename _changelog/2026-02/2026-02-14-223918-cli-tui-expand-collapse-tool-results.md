# Interactive TUI Expand/Collapse for Tool Results

**Date**: February 14, 2026

## Summary

Added expand/collapse functionality to the Stigmer CLI's Bubbletea-based execution viewer. Users can now press Tab to focus on tool call results and Enter to toggle between a compact 3-line preview and full output. This transforms the TUI from a passive scrollable log into an active exploration interface where users can drill down into specific tool results without drowning in output.

## Problem Statement

The T02 foundation provided scrollback but no way to see full tool results. File reads, directory listings, and search results were truncated to 3 lines with a "N more lines" indicator, creating two problems:

### Pain Points

- **Information loss**: Users could not see the complete output of file reads or directory listings without re-running the execution
- **Cognitive overload**: Large executions with many tool calls produced walls of previews that obscured the important content
- **No prioritization**: Users had no way to decide which tool results were worth expanding vs skipping
- **Regression from manual review**: The old linear stdout at least let users scroll terminal history; the new TUI needed feature parity

## Solution

Implemented a focus-based expand/collapse model following terminal TUI conventions (less, vim). The collapsed state shows the current 3-line preview (visual parity with T02), and the expanded state shows complete content with gutter borders. Tab/Shift+Tab cycle focus between expandable blocks, Enter toggles, Space remains page-down for viewport scrolling.

## Implementation Details

### Architecture: Two-Stage Rendering

Each `ToolResultEvent` now computes **both** renderings at event-time:
- **Preview**: `toolrender.Render()` — header + 3-line file preview
- **Full**: `toolrender.RenderExpanded()` — header + complete result with gutters

The `contentBlock` struct stores both, and `displayContent()` returns the appropriate one based on the `expanded` flag. This avoids re-rendering on toggle and keeps the hot path (streaming new events) unchanged.

### New Components

**`pkg/toolrender/render_known.go`** (136 lines)
- Extracted internal rendering helpers from oversized `render.go` (was 314 lines, now 232)
- `renderKnownHeader()` — reusable header builder for both collapsed/expanded
- `renderKnown()` — collapsed with preview
- `renderUnknown()` — unknown tool fallback
- Follows single-responsibility principle

**`pkg/toolrender/file_preview.go`** additions (30 new lines)
- `formatFullResultWithGutter()` — renders every line with `│` gutter prefix
- No line limit, no "N more lines" indicator
- Matches visual style of collapsed preview for smooth expand transition

**`pkg/executiontui/focus.go`** (75 lines)
- `focusNextExpandable()` / `focusPrevExpandable()` — wrap-around navigation
- `toggleFocusedBlock()` — flip expanded state
- `hasExpandableBlocks()` — conditional footer hints
- Isolated from `update.go` per separation of concerns

### Visual Indicators

**Focus marker**: `▸` prefix on the focused block
**Expand state**: `▶` collapsed, `▼` expanded

```
  📖 Read: a.go (1.0 KB, 33 lines) ▶        ← collapsed, unfocused
▸ 📖 Read: b.go (2.5 KB, 87 lines) ▼        ← expanded, focused
     │ package main
     │ 
     │ import "fmt"
     │ ...
  📂 List: /workspace (97 chars) ▶          ← collapsed, unfocused
```

### Key Design Decisions

1. **Enter only for toggle** — Space remains page-down (viewport scroll convention). After researching terminal TUI standards (less, vim), Space is universally page-down. Tools like lazygit use Space for toggle only when there's no competing viewport scroll. We have both, so Enter is the activate key.

2. **Collapsed = current preview** — No visual regression from T02. The 3-line preview is still the default, preserving the information density users saw before expand/collapse existed.

3. **Focus model persists** — Once Tab is pressed, focus stays active and cycles through blocks. This avoids the "activate, lose focus, re-activate" dance. If users want to scroll without focus, they just use arrow keys (focus doesn't interfere with viewport scrolling).

4. **Preview/full computed on event** — Both renderings are pre-computed when the event arrives, not lazily on toggle. This keeps the toggle instant (no rendering delay) and makes the code simpler (no caching or invalidation logic).

### Bug Fix: BUILD.bazel Completeness

Fixed a silent bug in `pkg/toolrender/BUILD.bazel` — `file_preview.go` and `file_preview_test.go` were missing from the Bazel `srcs` lists. Bazel builds were silently excluding the file preview logic that T02 added. While `go build` worked (it auto-discovers files), any Bazel users would see broken builds.

## Testing

**Test coverage**: 187 tests passing (up from 156 in T02)

**New test categories**:
- `RenderExpanded` for all tool types (read, list, shell, unknown)
- `formatFullResultWithGutter` (multi-line, blank lines, repr stripping)
- Focus navigation (Tab, Shift+Tab, wrap-around, no-expandable edge case)
- Toggle (expand, collapse, no-focus passthrough)
- Approval isolation (focus keys ignored during approval)
- Visual indicators (▸, ▶, ▼) in viewport content
- `displayContent()` method (expandable vs non-expandable)

## File Impact

**Modified (13 files)**:
- `pkg/toolrender/`: render.go, render_known.go (new), file_preview.go, BUILD.bazel
- `pkg/executiontui/`: blocks.go, model.go, update.go, render_blocks.go, view.go, focus.go (new)
- Tests: render_test.go, file_preview_test.go, update_test.go, render_blocks_test.go
- Bridge: run_stream_events.go (typo fix)

**+657/-129 lines** (net +528 lines, all with full test coverage)

## Benefits

- **Better debugging**: Users can expand specific tool results to investigate agent behavior without re-running
- **Reduced cognitive load**: Collapsed view scans quickly; expand only what matters
- **Information preservation**: Full tool output is now accessible inline during streaming
- **No regressions**: Collapsed state matches T02 visually; Space still page-downs
- **Maintainability**: All source files under 250 lines, clear separation of concerns, comprehensive tests

## Impact

- **CLI users**: Immediate benefit in long-running executions with many tool calls
- **Agent developers**: Easier debugging of tool usage patterns
- **T04/T05/T06**: Foundation in place for scroll-into-view, advanced navigation (g/G), and help overlay
- **Codebase health**: Fixed BUILD.bazel bug, extracted oversized files, zero technical debt

## Related Work

- **T02 (2026-02-14)**: Foundation — Bubbletea TUI with scrollback
- **T01 (2026-02-14)**: Architecture plan — approved design
- **Next**: T04 (scroll polish), T05 (approval integration improvements), T06 (help overlay)

---

**Status**: ✅ Production Ready  
**Test Coverage**: 187 tests passing, full vet clean  
**Timeline**: Single session (~2 hours end-to-end including research, implementation, testing, refactoring)
