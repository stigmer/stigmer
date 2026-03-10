# Fix Parallel Sub-Agent Display in CLI TUI

**Date**: March 11, 2026

## Summary

Fixed the CLI TUI to properly display multiple parallel sub-agents running simultaneously. Previously only one sub-agent was visible (last-writer-wins), disappearing when it completed even if others were still running. Now all active sub-agents are shown in a stacked live view, late AI messages no longer leak to the main scrollback, and the collapsed completion view is cleaner.

## Problem Statement

When the parent agent spawned multiple sub-agents in parallel (e.g., 4 concurrent infrastructure scans), the CLI had several display issues that made it difficult to follow progress.

### Pain Points

- Only one sub-agent appeared in the live spinner view at a time (the last one to start overwrote the previous)
- When the displayed sub-agent completed, the live view disappeared entirely even though other sub-agents were still running
- Sub-agent output was shown in the collapsed completion line, adding noise the user didn't want to see by default
- Late-arriving AI messages from completed sub-agents leaked to the main scrollback as gutter-wrapped text, duplicating content already captured in the sub-agent block

## Solution

Replaced the single-slot sub-agent display model (one `subAgentID` + scalar fields) with a multi-slot architecture (`activeSubAgentEntries` slice) that tracks all running sub-agents simultaneously. Each sub-agent gets its own stacked entry in the live view with independent activity labels, tool counts, and elapsed timers.

## Implementation Details

### Bubbletea Model Refactor

Replaced 6 scalar fields (`subAgentActive`, `subAgentID`, `subAgentSubject`, `subAgentToolCount`, `subAgentActivity`, `subAgentSpinnerStart`) with a single `activeSubAgentEntries []subAgentDisplayEntry` slice and a shared `subAgentSpinnerFrame`. The `subAgentActive` boolean became a derived property: `len(m.activeSubAgentEntries) > 0`.

### Handler Rewrites

- **`handleSubAgentShow`**: Appends to slice; only starts the spinner tick chain on the first entry
- **`handleSubAgentHide`**: Removes matching entry from slice; remaining entries stay visible
- **`handleSubAgentUpdate`**: Finds and updates tool count on the matching entry
- **`handleSubAgentActivity`**: Finds and updates activity label + resets timer on the matching entry
- **`handleSubAgentTick`**: Terminates when slice is empty (unchanged semantics)

### Stacked Rendering

`renderSubAgentLine()` now iterates all entries, producing a two-line block per sub-agent (header + spinner), joined into a single stacked view. All entries share the same spinner frame for visual consistency.

### Collapsed View Cleanup

Removed the dim output suffix from `renderSubAgentCollapsed()`. The collapsed line now shows only status and tool count: `● Sub-agent: subject ✓ Done (N tools)`.

### Late AI Message Fix

Removed the `else { r.statusf(...) }` fallthrough in both `AIStreamEndEvent` and `AIMessageEvent` handlers. Late sub-agent AI messages arriving after block completion are silently discarded since the content is already captured in the block's children.

## Benefits

- All parallel sub-agents are visible simultaneously with individual progress indicators
- No more "blind spots" where running sub-agents have no live display
- Cleaner collapsed view without noisy output previews
- No more duplicate sub-agent content leaking to the main scrollback

## Impact

- **CLI users**: Immediately see all parallel sub-agent activity instead of just the last one
- **UX**: Terminal output is less noisy — only status/tool-count in collapsed view
- **Correctness**: Late AI messages no longer produce duplicate scrollback output

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline` (PRs 1-5)
- Changelog: `2026-03-11-035511-fix-sub-agent-subject-shows-full-prompt`
- Changelog: `2026-03-10-084417-cli-sub-agent-rendering-improvements`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
