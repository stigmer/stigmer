# Fix Sub-Agent Display Flickering via Double-Buffering and Atomic Completion

**Date**: March 11, 2026

## Summary

Eliminated the remaining sub-agent display flickering in the CLI TUI by double-buffering all volatile display fields and making sub-agent completion transitions atomic. The previous fix (changelog `2026-03-11-062209`) addressed tick-driven volatility but left two structural causes: event-driven View() redraws between ticks and a two-frame glitch during sub-agent completion.

## Problem Statement

Despite the earlier fix that cached `elapsedStr`, slowed the tick interval to 150ms, and stopped resetting the elapsed timer on activity changes, users still observed flickering in the stacked sub-agent display during parallel execution. The flickering was unpatterned and difficult to reproduce consistently because it depended on event timing.

### Pain Points

- `subAgentActivityMsg` and `subAgentUpdateMsg` wrote directly to View()-visible fields, causing Bubbletea to erase and redraw the entire 14+ line inline region on every event — many times per second between ticks
- `renderSubAgentCompleted` sent a `Println` (scrollback commit) and a separate `subAgentHideMsg` (live entry removal) as two Bubbletea messages, producing a one-frame duplication where the completed sub-agent appeared both in scrollback and in the live View() before the second message removed it
- With 4 parallel sub-agents completing near-simultaneously, the height-change cascade (each completion shrinks View() by 2 lines) compounded the visual instability

## Solution

Two targeted changes in the Bubbletea rendering layer that make View() output completely stable between ticks and eliminate the completion transition glitch.

## Implementation Details

### Double-buffer all volatile sub-agent display fields

Added `pendingToolCount` and `pendingActivity` shadow fields to `subAgentDisplayEntry`. Event handlers (`handleSubAgentActivity`, `handleSubAgentUpdate`) now write exclusively to pending fields. `handleSubAgentTick` copies pending values to the display fields (`activity`, `toolCount`) atomically alongside the existing `elapsedStr` update.

Since View() only reads display fields, its output is byte-for-byte identical between ticks regardless of how many events arrive. Bubbletea's diff optimization detects no change and skips the terminal write entirely.

### Atomic sub-agent completion transition

Introduced `subAgentCompleteMsg` — a new Bubbletea message that combines entry removal and scrollback commit into a single `Update()` call. The handler removes the matching entry from `activeSubAgentEntries` and returns `tea.Println(scrollbackLines)` in one operation.

`renderSubAgentCompleted` pre-renders the scrollback text (with gap logic matching `writeToScrollback`) and sends `subAgentCompleteMsg` instead of the previous two-message sequence (`Println` + `subAgentHideMsg`). The non-TTY fallback path (no Bubbletea program) is unchanged — it uses `commitToScrollback` directly.

## Benefits

- View() output is completely stable between tick intervals — only the 150ms tick produces terminal writes during sub-agent execution
- Sub-agent completions are visually seamless — no one-frame duplication or height-change flash
- The `subAgentHideMsg` path is preserved for non-completion removals (future cancellation paths)

## Impact

- **CLI users**: Sub-agent stacked view appears fully stable during parallel execution, even with rapid tool activity across multiple agents
- **Performance**: Terminal write volume during sub-agent phases reduced to exactly the tick rate (6.7 writes/s) regardless of event volume
- **Correctness**: No behavioral change to event processing, history tracking, or re-commit logic

## Related Work

- Changelog: `2026-03-11-062209-fix-sub-agent-display-flickering` (previous partial fix)
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display` (multi-slot architecture)
- Project: `20260309.01.sub-agent-execution-streamline`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
