# Fix Sub-Agent Late Tool Event Leakage and Live View Spacing

**Date**: March 11, 2026

## Summary

Fixed two sub-agent display issues in the CLI TUI: (1) late-arriving tool events from completed sub-agents leaking as standalone gutter-wrapped items below the collapsed sub-agent line, and (2) no visual gap between parallel sub-agent entries in the live Bubbletea view.

## Problem Statement

When the parent agent spawned multiple sub-agents in parallel, the collapsed completion view was inconsistent — some sub-agents showed tool details (Read, Search) below their single-line summary while others showed only the summary line. Additionally, the live stacked view for in-progress sub-agents packed entries tightly with no visual separation.

### Pain Points

- First sub-agent to complete showed Read/Search tool calls leaked below its collapsed line, while other sub-agents showed only the clean one-liner — confusing visual inconsistency
- Users couldn't tell where one sub-agent's output ended and the next began in the live view
- Late tool events duplicated information already captured in the sub-agent block's `toolCount`

## Solution

Two targeted fixes: a `completedSubAgentIDs` set to suppress late-arriving events, and a blank-line separator between entries in the live Bubbletea view.

## Implementation Details

### Suppress late tool events for completed sub-agents

Added a `completedSubAgentIDs map[string]bool` field to the `inlineRenderer`. When `renderSubAgentCompleted` commits the sub-agent block to scrollback and removes it from `activeSubAgents`, it now also records the ID in `completedSubAgentIDs`. At the very top of `handleEvent`, before any buffering or dispatch logic, a new guard checks all events carrying a `SubAgentID` against this set and silently discards events for completed sub-agents.

A new `eventSubAgentID` helper uses a type switch to extract the `SubAgentID` from all eight event types that carry one (`ToolCompletedEvent`, `ToolRunningEvent`, `ToolWaitingApprovalEvent`, `ToolStreamDeltaEvent`, `AIMessageEvent`, `AIStreamStartEvent`, `AIStreamDeltaEvent`, `AIStreamEndEvent`), returning `""` for events without sub-agent context.

### Add gap between live sub-agent entries

Changed the join separator in `renderSubAgentLine()` from `"\n"` to `"\n\n"`. Each sub-agent entry is a two-line block (header + spinner), and the blank line between entries provides clear visual separation when multiple sub-agents run in parallel.

## Benefits

- All completed sub-agents now render identically as clean one-line summaries — no leaked tool details
- Live stacked view has clear visual separation between parallel sub-agent entries
- Users can still expand any sub-agent block via Ctrl+O to see all internal tool calls

## Impact

- **CLI users**: Consistent, clean sub-agent collapsed view; easier to scan parallel sub-agent progress in the live view
- **Correctness**: No behavioral change — late events are already counted in the block's `toolCount`; suppression only prevents visual duplication

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline`
- Changelog: `2026-03-11-062209-fix-sub-agent-display-flickering`
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
