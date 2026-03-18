# Fix Session UI: Ordering, Layout, and Approval Dismissal

**Date**: March 18, 2026

## Summary

Fixed three session view issues: sidebar sessions now appear newest-first, the follow-up input stays pinned to the bottom even when the message thread is empty, and approved tools are optimistically removed from the approval UI immediately after submission.

## Problem Statement

Three user-facing issues degraded the session conversation experience:

### Pain Points

- Session sidebar showed sessions in arbitrary order (SQLite primary key order), making it difficult to find the most recent conversation
- When navigating to a newly created session, the follow-up input appeared at the top of the viewport instead of the bottom, breaking the chat-like layout expectation
- After approving a tool call, the approval card remained visible indefinitely, requiring a page refresh or waiting for the stream to catch up

## Solution

Each fix targets the layer that owns the concern:

1. **Session ordering**: Domain controller sorts sessions by `createdAt` DESC after unmarshalling -- ordering is a business rule, not a store or frontend concern
2. **Layout stability**: `MessageThread` always renders its container div, maintaining the flex layout contract even when empty
3. **Approval dismissal**: Optimistic removal via a `dismissedApprovalIds` set in `useSessionConversation`, threaded through to `MessageThread`

## Implementation Details

### Session List Ordering (Backend)

Added `sort.Slice` in `listAllSessionsStep.Execute` to sort sessions by `status.audit.specAudit.createdAt` descending. Nil timestamps sort to the end. This matches the cloud `SessionListHandler` which already applies the same sort. The generic `ListResources` store method remains ordering-agnostic -- different resource types have different ordering requirements (sessions want newest-first, execution threads want chronological).

### MessageThread Empty State (SDK)

Removed the `if (items.length === 0) return null` early return from `MessageThread`. The component now always renders its container `div` with the caller's `className` (including `flex-1`), ensuring `FollowUpInput` stays pinned to the bottom of the flex column regardless of content.

### Optimistic Approval Removal (SDK)

Added a `dismissedApprovalIds` state set to `useSessionConversation`. When `submitApproval` succeeds, the tool call ID is added to this set. The set resets when `activeExecutionId` changes. A new `dismissedApprovalIds` prop on `MessageThread` filters these IDs from the rendered approval cards in `buildThreadItems`. The `ApprovalCard` component itself requires no changes.

## Benefits

- Sessions appear in the expected order without frontend re-sorting
- Chat layout is stable from the moment the session page loads
- Tool approval decisions feel responsive -- no visual lag between clicking "Approve" and the card disappearing

## Impact

- **Direct users**: Improved session navigation and conversation flow in the web console
- **Platform builders**: `MessageThread` and `useSessionConversation` from `@stigmer/react` inherit all three fixes. The new `dismissedApprovalIds` prop is optional and backward compatible.

## Files Changed

| File | Layer |
|------|-------|
| `backend/services/stigmer-server/pkg/domain/session/controller/list.go` | Backend (domain) |
| `sdk/react/src/execution/MessageThread.tsx` | SDK |
| `sdk/react/src/session/useSessionConversation.ts` | SDK |
| `client-apps/web/src/app/sessions/[id]/SessionPage.tsx` | Console |

## Related Work

- Follows the session-first web UX project (T01)
- Architecture decision: ordering is a domain contract, not a store convention. `AgentExecutionListBySession` should be explicitly sorted by `createdAt` ASC (flagged as follow-up).

---

**Status**: Production Ready
