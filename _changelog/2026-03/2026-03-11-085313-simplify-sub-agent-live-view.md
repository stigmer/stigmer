# Simplify Sub-Agent Live View to Static Spinner

**Date**: March 11, 2026

## Summary

Replaced the volatile sub-agent live view — which cycled through "Thinking", tool names, and "Working" labels while updating a running tool count — with a static "Working..." spinner and elapsed timer. This eliminates flickering structurally by removing all mid-execution display updates from the Bubbletea view model, rather than patching the symptoms with double-buffering workarounds.

## Problem Statement

The sub-agent live view updated the activity label and tool count on every internal event (AI stream starts, tool completions, tool running). Three successive patches (separate tick interval, cached elapsed time, double-buffered pending fields, atomic completion) were needed to manage the resulting View() volatility. The system worked, but the complexity was disproportionate to the user value: a user watching a sub-agent spinner cannot meaningfully act on whether it says "Thinking" vs "Grep" vs "Working".

### Pain Points

- 4 shadow fields on `subAgentDisplayEntry` (double-buffer pattern) added conceptual overhead for any future maintainer
- 2 message types (`subAgentUpdateMsg`, `subAgentActivityMsg`) and their handlers existed solely to push volatile data into the view model
- Every sub-agent event (tool completion, AI stream start/end, tool running) sent a Bubbletea message even though the user-facing information ("sub-agent is busy") didn't change
- The flickering fixes were additive patches rather than a simplification of the root cause

## Solution

Make the live view completely static: show "Working..." as the activity label at all times, omit tool count from the header, and stop sending any display-update messages during sub-agent execution. Tool count and detailed status appear only in the completed scrollback line.

## Implementation Details

### `subAgentDisplayEntry` struct slimmed (types)

Removed 4 fields: `toolCount`, `activity`, `pendingToolCount`, `pendingActivity`. The struct now holds only `id`, `subject`, `spinnerStart`, and `elapsedStr`.

### Message types and handlers deleted (messages, bubbletea)

Deleted `subAgentUpdateMsg` and `subAgentActivityMsg` types. Removed their `case` branches from `Update()` and deleted `handleSubAgentUpdate` and `handleSubAgentActivity` handlers. The `Update()` switch for sub-agents now has 4 cases (show, hide, complete, tick) instead of 6.

### Tick handler simplified (bubbletea)

`handleSubAgentTick` no longer copies pending fields to display fields. It only advances the spinner frame and updates `elapsedStr` per entry.

### Render function simplified (bubbletea)

`renderSubAgentLine` always renders "Working..." — no conditional activity label, no tool count in the header.

### Event routing cleaned up (inline, render, approval)

Removed all 5 `program.Send(subAgentActivityMsg{...})` calls from: `ToolRunningEvent` interception, `AIStreamStartEvent` interception, `AIStreamEndEvent`/`AIMessageEvent` interceptions, `renderToolCompleted`, and approval completion. Removed `sendSubAgentUpdate` calls from `appendToSubAgentBlock` and `flushPendingReads`, then deleted the `sendSubAgentUpdate` method entirely.

### Re-commit transfer updated (history)

`transferSubAgentEntries` no longer copies `toolCount` to display entries since the field no longer exists.

### Tests updated

Deleted 4 tests that exercised the removed double-buffer/activity paths. Simplified the tick test (no pending-to-display assertions). Updated render tests to assert "Working" always appears and tool count never appears. Renamed tests to match new semantics.

## Benefits

- Net deletion of ~217 lines across 9 files (32 added, 249 removed)
- Zero Bubbletea messages flow during sub-agent execution — only the self-propagating tick (every 150ms)
- Flickering is structurally impossible: View() content changes only on tick (spinner frame + elapsed), and both are scalar increments
- The double-buffer pattern, the complexity ceiling of the previous approach, is eliminated entirely
- Future maintainers see a simple struct with 4 fields instead of 8 with shadow-field documentation

## Impact

- **CLI users**: Sub-agent view is visually stable and consistent regardless of internal execution phase
- **Maintainability**: The sub-agent display code path is straightforward — show, tick, complete — with no intermediate state management
- **Correctness**: History tracking (`subAgentBlock`) is unaffected; completed scrollback still shows tool count, status, children, and output

## Related Work

- Changelog: `2026-03-11-082256-fix-sub-agent-flicker-double-buffer-atomic-complete` (superseded — the double-buffer pattern introduced there is now removed)
- Changelog: `2026-03-11-062209-fix-sub-agent-display-flickering` (superseded — the cached elapsed and tick interval remain, but the pending-field caching is removed)
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display` (multi-slot architecture preserved)
- Project: `20260309.01.sub-agent-execution-streamline`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
