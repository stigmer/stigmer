# Surface Sub-Agent Task Input in Expanded View

**Date**: March 30, 2026

## Summary

The `SubAgentSection` component now displays the full task instruction (`input`) that was delegated to each sub-agent. Previously, users could only see a short label (`subject`) and had to dig through the nested message thread to understand what work was actually delegated. The input is rendered as a subtle blockquote between the todo list and the message thread in both collapsible and flat layouts.

## Problem Statement

When a parent agent delegates work to a sub-agent via the task tool, the UI only showed the short `subject` label (3-10 words) in the collapsed card header. The full task prompt — stored in `SubAgentExecution.input` — was never surfaced anywhere in the UI.

### Pain Points

- Users saw cryptic labels like "docs/what- conceptual infra charts" with no way to understand the actual delegation
- Understanding what a sub-agent was instructed to do required expanding and reading through raw messages
- Violated Nielsen's Heuristic #1 (Visibility of System Status): users couldn't tell what work was delegated

## Solution

Added the `input` field to the shared `SubAgentThreadContent` renderer, displayed as a blockquote-styled block positioned after the todo list but before the message thread. The input only renders when non-empty (graceful degradation).

## Implementation Details

Single file changed: `sdk/react/src/execution/SubAgentSection.tsx`

- **`SubAgentThreadContentProps`**: added optional `input?: string` prop
- **`SubAgentThreadContent`**: renders input as a `<div>` with left border styling (`border-l-2 border-muted-foreground/25`) between todos and messages
- **`CollapsibleCard`**: passes `sub.input` to the shared thread content renderer
- **`FlatContent`**: passes `sub.input` to the shared thread content renderer

No changes to:
- Proto definitions (field already exists at field 3)
- Backend / agent-runner (already populates `input` from task tool `description` arg)
- Collapsed card behavior (unchanged)
- No new dependencies or SDK exports

## Benefits

- Users can immediately see what task was delegated to a sub-agent upon expanding
- Reduces cognitive load when debugging multi-agent executions
- Zero-cost change: the data was already flowing through the wire, just not displayed

## Impact

- **SDK consumers**: any app embedding `@stigmer/react` gets this for free
- **Console**: inherits the improvement without changes
- **Accessibility**: input text is within the existing `role="group"` container

## Related Work

- Backend population: `handlers/sub_agent.py` → `handle_sub_agent_start` maps `description` → `input`
- Proto: `SubAgentExecution.input` (field 3) in `subagent.proto`

---

**Status**: ✅ Production Ready
