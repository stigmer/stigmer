# Add "ctrl+o to expand" Hint to Expandable Tool Lines

**Date**: March 7, 2026

## Summary

Added a dim `(ctrl+o to expand)` hint to every compact tool line, read group header, and collapsed sub-agent block in the inline renderer. This surfaces the Ctrl+O expand/collapse keybinding directly in the session output, matching how Claude Code teaches users about expandable items inline.

## Problem Statement

The Ctrl+O expand/collapse toggle was fully implemented across 5 phases of the `20260305.02.expand-collapse-tools` project, but there was zero visual discoverability. Users had no way to know Ctrl+O existed unless told out-of-band (documentation, word-of-mouth). The feature was invisible.

### Pain Points

- New users never discover the expand feature exists
- The session header's "Stigmer · expanded" indicator only shows after toggling — it doesn't teach the initial keybinding
- Claude Code already surfaces this hint inline; Stigmer users expect comparable discoverability

## Solution

Append a dim `(ctrl+o to expand)` suffix to the first line of every expandable item in compact mode. The hint is gated on Ctrl+O being available (TTY mode with Bubbletea owning stdin) so it never appears in non-interactive environments.

## Implementation Details

- **New style**: `expandHintStyle` in `run_display.go` — dim gray (color `"8"`), no italic, consistent with `toolrender.dimStyle` used for parenthetical metadata like `(43 lines)`.
- **Hint placement**: Lives in the inline renderer layer (`run_stream_inline_history.go`), not the `toolrender` package. The `toolrender` package is a pure rendering library with no knowledge of keybindings.
- **`appendExpandHint` helper**: Injects the hint into the first line of rendered text. Multi-line output (read groups, expanded shells) only gets the hint on the header line.
- **`showExpandHint` parameter**: Threaded through `renderHistoryBatch` → `renderCommittedItem`, applied to `kindToolCompact`, `kindReadGroup`, and `kindSubAgentBlock` when `!expanded && showExpandHint`.
- **`expandHintEnabled()` predicate**: Returns `true` when `toggleExpandCh != nil` (Bubbletea owns stdin in TTY mode). Returns `false` in tests, CI, piped output, non-TTY.
- **Both rendering paths covered**: `commitToScrollback` (live rendering) and `triggerReCommit` (re-commit on toggle) both pass the hint flag, so hints appear/disappear correctly when the user toggles.

### Files Modified

| File | Change |
|------|--------|
| `run_display.go` | Added `expandHintStyle` |
| `run_stream_inline_types.go` | Added `expandHintEnabled()` method |
| `run_stream_inline_history.go` | Added `expandHintSuffix`, `appendExpandHint`; threaded `showExpandHint` through `renderHistoryBatch`, `renderCommittedItem`, `triggerReCommit` |
| `run_stream_inline_render.go` | Updated `commitToScrollback` to pass hint flag |
| `run_stream_inline_approval.go` | Updated `renderHistoryBatch` call in approval flow |
| `run_stream_inline_history_test.go` | Updated 50+ existing test calls; added 12 new tests |
| `run_stream_inline_history_bench_test.go` | Updated all benchmark calls; added hint-enabled benchmark variant |

## Benefits

- **Discoverability**: Every expandable item now teaches the user about Ctrl+O
- **Consistency**: Matches Claude Code's inline hint pattern that users already expect
- **Non-intrusive**: Dim color blends with existing metadata; disappears in expanded mode
- **Safe**: No hints in non-interactive environments (tests, CI, piped output)
- **Zero performance impact**: One string concat per item; benchmark delta negligible

## Impact

All users of `stigmer run` and `stigmer draft` in TTY mode will see the hint on every compact tool line. Non-TTY users (CI, piped output) are unaffected.

## Related Work

- [Expand/collapse toggle implementation](_changelog/2026-03/2026-03-05-070144-event-history-retention-and-subject-update.md)
- [Ctrl+O keybinding and stdin ownership](_changelog/2026-03/2026-03-05-075631-ctrl-o-keybinding-full-bubbletea-stdin-ownership.md)
- [Re-commit performance optimization](_changelog/2026-03/2026-03-05-083840-re-commit-performance-optimization.md)
- Project: `_projects/2026-03/20260305.02.expand-collapse-tools`

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
