# Sub-Agent Live Activity Indicator

**Date**: March 8, 2026

## Summary

Added an animated activity spinner to the sub-agent execution line in the CLI's inline renderer. During sub-agent execution, the terminal now shows a live two-line display with the sub-agent header and a second line showing an animated spinner frame, the current activity label (Thinking, tool name, or Working), and per-phase elapsed time. This eliminates the frozen-terminal experience where users had no visual feedback for the entire duration of a sub-agent's execution.

## Problem Statement

When a sub-agent executes, the Bubbletea `View()` rendered a static, visually dead line for the entire sub-agent duration — potentially minutes for complex tasks with many tool calls. Users had to wait with no indication of progress until all tools completed.

### Pain Points

- `subAgentActive` took priority over `spinnerActive` in View(), so the thinking spinner never rendered during sub-agent execution
- Sub-agent `AIStreamStartEvent` and `AIStreamDeltaEvent` were silently suppressed, providing no feedback about reasoning phases
- `ToolRunningEvent` was globally suppressed, so users never saw which tool the sub-agent was executing
- Tool count only updated on completion — long-running tools showed zero change for their entire duration

## Solution

Introduced an independent sub-agent spinner animation and activity forwarding mechanism. Sub-agent AI streaming and tool running events remain suppressed from scrollback/history (no new rendering pathways), but a lightweight activity label is extracted and forwarded to Bubbletea via new internal message types. The sub-agent line gained its own tick chain, completely decoupled from the main thinking spinner.

## Implementation Details

**New Bubbletea message types** (`run_stream_inline_messages.go`):
- `subAgentActivityMsg` — carries sub-agent ID and activity label
- `subAgentTickMsg` — self-propagating tick for the sub-agent spinner

**Model state and handlers** (`run_stream_inline_bubbletea.go`):
- Three new model fields: `subAgentActivity`, `subAgentSpinnerFrame`, `subAgentSpinnerStart`
- `handleSubAgentShow` initializes spinner state and starts the tick chain
- `handleSubAgentHide` clears activity and stops the tick chain
- `handleSubAgentActivity` sets the label and resets the elapsed timer
- `handleSubAgentTick` advances the frame or terminates when inactive
- `renderSubAgentLine()` rewritten to produce a two-line animated display

**Activity forwarding** (`run_stream_inline.go`):
- Sub-agent `AIStreamStartEvent` sends `activity: "Thinking"`
- Sub-agent `AIStreamEndEvent` and `AIMessageEvent` clear the activity
- Sub-agent `ToolRunningEvent` (non-read, non-think, non-streaming) sends tool name as activity

**Activity clearing** (`run_stream_inline_render.go`, `run_stream_inline_approval.go`):
- Tool completion clears activity after appending to sub-agent block
- Approval finalization clears activity for sub-agent tools

**Tests** (`run_stream_inline_bubbletea_test.go`):
- 11 new unit tests covering show/hide lifecycle, activity setting, tick advancement/termination, rendering content, and View() priority

## Benefits

- Users see continuous, real-time feedback during sub-agent execution instead of a frozen line
- Activity label shows what the sub-agent is currently doing (Thinking, Grep, Shell, etc.)
- Per-phase elapsed timers give a sense of how long each activity has been running
- Tool count still increments on completion as before, now complemented by running indicators
- Non-TTY/CI mode is unaffected — activity updates are no-ops when `program == nil`

## Impact

- **End users**: Dramatically improved perceived responsiveness during sub-agent execution
- **Codebase**: Purely additive changes — no existing handlers, event types, or rendering pathways modified
- **Main spinner**: Completely untouched — separate message types, fields, and render methods

## Related Work

- [Sub-agent collapsible nesting UX](2026-03-02-022633-sub-agent-collapsible-nesting-ux.md)
- [Sub-agent subject generation and TUI redesign](2026-03-03-020614-sub-agent-subject-generation-and-tui-redesign.md)
- [Collapsed sub-agent blocks](2026-03-07-005317-collapsed-sub-agent-blocks.md)

---

**Status**: ✅ Production Ready
