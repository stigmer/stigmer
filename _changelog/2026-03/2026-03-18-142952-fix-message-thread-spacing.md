# Fix Message Thread Spacing and Visual Hierarchy

**Date**: March 18, 2026

## Summary

Improved the `MessageThread` SDK component's spacing from a cramped 4px inter-item gap with no container padding to a properly spaced layout with 16px gaps, 24px top padding, and 16px bottom padding. This brings the conversation thread's visual quality in line with reference-grade chat UIs.

## Problem Statement

The session conversation thread rendered all items (user messages, AI responses, tool call groups, approval cards) with only 4px of vertical space between them and no padding at the top or bottom of the scroll container. This created a dense, cramped appearance where content started flush against the container edge and items blurred into each other.

### Pain Points

- First message slammed against the top of the scroll container with zero breathing room
- 4px gap between a user message and the AI response made them feel like a single block rather than a conversation exchange
- Tool call groups and approval cards sat too close to surrounding messages, reducing visual hierarchy
- Last thread item pressed directly against the follow-up input border

## Solution

Single-line className change on the `MessageThread` scroll container in `sdk/react/src/execution/MessageThread.tsx`:

- `gap-1` (4px) replaced with `gap-4` (16px) for proper inter-item spacing
- Added `pt-6` (24px) top padding so the conversation starts with visual intent
- Added `pb-4` (16px) bottom padding to separate the last item from the input bar

## Implementation Details

The change is confined to the container-level flex layout. All child components (`MessageEntry`, `ToolCallGroup`, `ApprovalCard`, `ExecutionPhaseBadge`) retain their existing internal padding (`px-4 py-3` on messages, `mx-4` on tool groups/cards), which composes correctly with the new container spacing.

The `className` prop continues to merge via `cn()`, so platform builders who need tighter or looser spacing can override with their own Tailwind classes.

## Benefits

- Conversation threads now have clear visual separation between turns
- User messages are distinguishable from AI responses at a glance
- Tool call groups and approval cards sit in their own visual "row" with breathing room
- The thread no longer feels like a wall of text

## Impact

- **SDK consumers**: All embedders of `MessageThread` get improved defaults automatically
- **Console**: Inherits the fix via the SDK dependency with no Console-level changes
- **Theming**: No new `--stgm-*` tokens required; standard Tailwind spacing utilities handle structural layout

---

**Status**: Production Ready
