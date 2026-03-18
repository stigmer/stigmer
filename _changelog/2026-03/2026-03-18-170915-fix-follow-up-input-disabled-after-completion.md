# Fix Follow-Up Input Staying Disabled After Execution Completes

**Date**: March 18, 2026

## Summary

Fixed a bug where the follow-up input in the session page remained disabled after an agent execution completed, preventing users from sending follow-up messages without a page reload.

## Problem Statement

After an execution finished (reached a terminal phase like COMPLETED), the reply input at the bottom of the session page stayed grayed out and non-interactive. Users had to refresh the page to send another message.

### Pain Points

- Follow-up input disabled after execution completes
- No visual feedback that the input should become available
- Users forced to reload the page to continue conversation

## Solution

Added a `useEffect` in `useSessionConversation` that triggers a refetch of the executions list when the stream reaches a terminal phase, so the fetched list reflects the updated status and the `canSendFollowUp` flag flips to `true`.

## Implementation Details

The `canSendFollowUp` flag is computed as `!isCreating && activeExecutionId === null`. The `activeExecutionId` derives from `listActiveId`, which scans the fetched executions list for any execution NOT in a terminal phase. When the real-time stream detected terminal phase and stopped streaming, the fetched executions list (from `useSessionExecutions`) was never refreshed — it still held the old non-terminal phase data. This kept `listActiveId` returning the completed execution's ID, keeping the input disabled.

The fix adds 8 lines: a single `useEffect` that calls `refetch()` when `activeExecutionId` is non-null and `stream.phase` is terminal.

## Benefits

- Follow-up input correctly enables after execution completes
- Textarea auto-focuses when transitioning from disabled to enabled (existing behavior now reachable)
- No additional network overhead beyond a single list refetch at execution completion

## Impact

- **Users**: Can immediately continue conversations after an execution finishes
- **Components affected**: `useSessionConversation` hook in `@stigmer/react` SDK

## Related Work

- Session page redesign project (20260318.03)
- FollowUpInput component and MessageThread composition

---

**Status**: Production Ready
