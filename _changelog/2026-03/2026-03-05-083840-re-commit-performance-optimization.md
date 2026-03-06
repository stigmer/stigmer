# Re-commit Performance Optimization (Phase 5)

**Date**: March 5, 2026

## Summary

Optimized the Ctrl+O expand/collapse toggle's re-commit path by batching N individual `tea.Println` calls into a single pre-rendered write. This eliminates visible terminal flicker during toggle and reduces event-loop round-trips from N+1 to 2, regardless of session history size. Established the first Go benchmark suite in the CLI codebase as a regression guard.

## Problem Statement

The Ctrl+O toggle feature (built in Phases 1-4) clears the terminal and re-commits all history items when the user switches between compact and expanded view. The original implementation used `tea.Sequence(ClearScreen, Println, Println, ..., Println)` with one `tea.Println` per history item.

### Pain Points

- Bubbletea's `tea.Sequence` (`tea.go:420-446`) spawns a goroutine that calls `p.Send()` for each command — each is a blocking round-trip through the event loop
- N items = N separate stderr writes after a screen clear, creating visible flicker
- The terminal sees `ClearScreen -> write1 -> write2 -> ... -> writeN` as separate operations
- For sessions with 100+ tool calls, the flash between ClearScreen and the last write was noticeable

## Solution

Pre-render all history items into a single string in `triggerReCommit` (renderer goroutine), send the pre-rendered string to the Bubbletea model, and execute `tea.Sequence(ClearScreen, Println(batch))` — exactly 2 event-loop passes and 2 terminal writes.

This also improves separation of concerns: the renderer owns both history and rendering; the model is a thin command relay.

## Implementation Details

### New function: `renderHistoryBatch`

Renders all history items into a single string using `strings.Builder`. Each non-empty item is joined by `\n`, matching the newline that `tea.Println` appends per call. Empty items (e.g., nil header, empty toolCalls) are skipped.

### Simplified `reCommitMsg`

Before: carried `items []committedItem`, `compactOpts toolrender.CompactOptions`, `expanded bool` — shipping raw data for the model to render.

After: carries a single `rendered string` — an immutable, pre-rendered payload. The model just passes it to `buildReCommitCmd`.

### Removed `reCommitHistory`

The old function that built a `tea.Sequence` of N Println commands is replaced by `buildReCommitCmd(rendered)` which returns `tea.Sequence(ClearScreen, Println(rendered))`.

### Benchmark suite

First Go benchmarks in the CLI codebase. Covers:
- Per-kind rendering cost (header ~40us, tool ~6.5us, text ~3ns)
- Batch rendering at 10, 50, 100, 500 items in compact and expanded modes
- Allocation tracking with `b.ReportAllocs()`

### Correctness verification

`TestRenderHistoryBatch_MatchesPerItemOutput` builds a realistic 12-item mixed history (all `committedKind` variants) and asserts byte-for-byte equivalence between batched output and per-item output, for both compact and expanded modes.

## Benefits

- **Zero flicker on Ctrl+O toggle**: Terminal sees 2 writes (clear + batch) instead of N+1
- **Consistent performance**: 2 event-loop round-trips regardless of history size
- **Benchmark regression guards**: Performance characteristics documented and testable
- **Cleaner architecture**: Renderer owns rendering; model is a passthrough
- **Reduced allocations**: No snapshot copy of history slice needed

## Impact

- **End users**: Smoother Ctrl+O toggle experience, especially in long sessions with many tool calls
- **Developers**: First benchmark suite establishes patterns for future performance work
- **Architecture**: Completes the 5-phase expand/collapse feature with validated performance

## Related Work

- Phase 1: Event history retention (`16b618b9`)
- Phase 2: Expanded renderers (`2617ed87`)
- Phase 3: Ctrl+O keybinding with Bubbletea stdin ownership (`d2f92b35`)
- Phase 4: Follow-up history persistence and resumed session support (`332326a1`)
- Project plan: `_projects/2026-03/20260305.02.expand-collapse-tools/tasks/T01_0_plan.md`

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
