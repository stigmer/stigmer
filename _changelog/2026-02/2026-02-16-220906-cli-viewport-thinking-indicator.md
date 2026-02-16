# CLI Viewport-Level Thinking Indicator

**Date**: February 16, 2026

## Summary

Added an animated "Thinking..." indicator to the execution TUI's main viewport content area. When the agent is idle for more than 2 seconds during the `in_progress` phase (e.g., processing a large prompt or planning next steps), users now see a visible animated indicator in the content area instead of relying on the subtle header spinner alone.

## Problem Statement

When the agent enters a long thinking/planning phase — such as generating a full skill file before requesting approval — the TUI viewport shows no new content. The only signal is an animated spinner swap in the header bar, which is easy to miss when the viewport contains a lot of scrolled content.

### Pain Points

- Users perceive the execution as "stuck" during legitimate thinking phases
- The header-only spinner is too subtle to notice, especially when focus is on the viewport content
- Long content-generation tasks (e.g., skill drafting with HITL approval) create multi-second gaps with zero visual feedback in the main content area
- No distinction between "agent is working" and "connection dropped" from the user's perspective

## Solution

Leverage the existing idle detection infrastructure (`thinkingVisible` flag, 2-second idle threshold, `activityTickMsg`) to render an ephemeral animated indicator inside the viewport content area. The indicator is NOT a persistent content block — it is appended to the viewport string by `refreshViewport()` and disappears automatically when the next execution event clears `thinkingVisible`.

This approach requires zero changes to the block data model, zero new event types, zero backend changes, and zero new model state fields.

## Implementation Details

### render_blocks.go

- Added `thinkingStyle` lipgloss style (color `"243"`, muted gray) to the block styles
- Added `renderThinkingIndicator(spinnerView string) string` — formats the ephemeral indicator using the current spinner frame so it animates with the global tick cycle

### handle_events.go

- Modified `refreshViewport()` to conditionally append the thinking indicator after the block content when `thinkingVisible` is true
- When viewport has existing content, the indicator is separated by a blank line (`\n\n`) for visual clarity
- When viewport is empty (rare edge case), the indicator shows as the only content

### update.go

- `spinner.TickMsg` handler: when `thinkingVisible`, calls `refreshViewport()` so the spinner frame in the viewport indicator animates in sync with the header
- `handleActivityTick()`: calls `refreshViewport()` immediately when transitioning to thinking state, so the indicator appears without waiting for the first spinner tick
- `handleWindowSize()`: replaced inline viewport rebuild with `refreshViewport()` call, ensuring the thinking indicator is consistently included during terminal resizes (also a minor DRY improvement)

### Design Decisions

- **Ephemeral, not block-based**: The indicator lives in the viewport string, not the `blocks` slice. This avoids complexity around adding/removing blocks and ensures clean disappearance.
- **Client-side idle detection**: Reuses the existing 2-second idle threshold rather than adding backend "thinking" events. Client-side detection is accurate enough — the backend doesn't emit events during LLM prompt processing.
- **Spinner reuse**: Uses the same `spinner.Dot` animation as the header for visual consistency and zero additional state.

## Benefits

- Immediate visual feedback during agent thinking phases — users know the agent is alive and working
- Consistent with the existing idle detection architecture — no new complexity
- Minimal code footprint: ~30 lines of new code across 3 files, all in the execution TUI package
- Zero backend changes — purely a CLI rendering concern

## Impact

- **Users**: See a clear "Thinking..." indicator with animated spinner in the main content area during agent idle periods, eliminating the "stuck" perception
- **Maintainers**: No new state, events, or block types to manage — the feature piggybacks entirely on existing infrastructure
- **Files changed**: 3 files in `client-apps/cli/pkg/executiontui/`

## Related Work

- [2026-02-15-215442-cli-live-activity-feedback.md](_changelog/2026-02/2026-02-15-215442-cli-live-activity-feedback.md) — Introduced the header-level idle detection and thinking spinner
- [2026-02-14-220416-cli-bubbletea-execution-viewer.md](_changelog/2026-02/2026-02-14-220416-cli-bubbletea-execution-viewer.md) — Foundation Bubbletea TUI for execution viewing

---

**Status**: ✅ Production Ready
