# Fix Sub-Agent Display Flickering During Parallel Execution

**Date**: March 11, 2026

## Summary

Fixed visual flickering in the CLI TUI when multiple sub-agents run in parallel. The root cause was excessive View() region volatility: elapsed time resets on every activity change, a high spinner tick rate for a multi-line display, and elapsed time recomputed on every View() call defeating Bubbletea's diff optimization.

## Problem Statement

When the parent agent spawned multiple sub-agents in parallel (e.g., 4 concurrent infrastructure scans), the stacked live view (~14 terminal lines) flickered visibly. Users reported the display appearing unstable during sub-agent execution even though no file write/edit tools were involved.

### Pain Points

- Elapsed time jumped from "(24s)" back to "(0s)" on every tool start or AI thinking transition, causing dramatic visual discontinuity
- The sub-agent spinner ticked at 80ms (same as the single-line thinking spinner), causing ~12.5 full View() redraws per second across 14+ lines
- `time.Since()` was computed live inside `renderSubAgentLine()`, making View() content change on every call — even between ticks when only an activity label changed — defeating Bubbletea's content diff optimization

## Solution

Three targeted changes in the Bubbletea rendering layer that reduce content volatility and redraw frequency without any architectural changes to the event pipeline.

## Implementation Details

### Stop resetting elapsed timer on activity changes

Removed `spinnerStart = time.Now()` from `handleSubAgentActivity`. The elapsed time now tracks total sub-agent runtime from creation, not time since the last tool started. The activity label itself already communicates the current operation.

### Separate sub-agent tick interval

Introduced `subAgentTickInterval = 150ms` (vs the main spinner's 80ms). The sub-agent stacked view spans many more terminal lines than the single-line thinking spinner, so a slower tick rate significantly reduces terminal write volume while keeping the spinner animation visually smooth.

### Cache elapsed time string per entry

Added `elapsedStr` field to `subAgentDisplayEntry`, computed once per tick in `handleSubAgentTick()` instead of live in `renderSubAgentLine()`. Between ticks, when activity or tool-count messages trigger View(), the elapsed string stays identical. This shrinks the diff surface so Bubbletea can skip unchanged lines.

## Benefits

- Elapsed time increases monotonically without visual jumps
- View() redraws reduced from ~12.5/s to ~6.7/s (47% reduction)
- View() content is stable between ticks unless meaningful state changed
- No architectural changes — same event pipeline, same rendering model

## Impact

- **CLI users**: Sub-agent stacked view appears stable and smooth during parallel execution
- **Performance**: Roughly half the terminal write volume during sub-agent phases
- **Correctness**: No behavioral change to event processing, history tracking, or re-commit logic

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline` (PRs 1-5)
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display`
- Changelog: `2026-03-11-035511-fix-sub-agent-subject-shows-full-prompt`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
