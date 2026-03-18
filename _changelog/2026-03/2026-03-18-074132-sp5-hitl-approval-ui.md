# SP5: Human-in-the-Loop Approval UI

**Date**: March 18, 2026

## Summary

Added human-in-the-loop approval UI to the session view, enabling users to approve, skip, or reject tool calls that require authorization. Built as SDK-first components following the established three-layer architecture: behavior hook, styled component, orchestration composition, and Console wiring.

## Problem Statement

When agent executions enter `WAITING_FOR_APPROVAL` phase, the backend pauses and waits for a human decision. The proto layer, TypeScript SDK client, streaming infrastructure, and tool call status rendering were already complete, but there was no interactive UI for users to actually submit approval decisions.

### Pain Points

- Tool calls showed "Waiting for approval" status text but provided no way to act on it
- Blocked executions required out-of-band intervention (CLI, API) to unblock
- Platform builders had no reusable components for approval flows in their embedded UIs

## Solution

Three new SDK exports (`useSubmitApproval`, `ApprovalCard`, updated `useSessionConversation`) plus integration into `MessageThread` and the Console's `SessionPage`. Approval cards render as top-level thread items at the scroll bottom — unmissable, zero clicks to reach the action buttons.

## Implementation Details

### New: `useSubmitApproval` behavior hook
- Wraps `agentExecution.submitApproval()` with per-tool-call loading state (`Set<string>`)
- Constructs proto message via `create(SubmitApprovalInputSchema, {...})`
- Error state with `clearError`
- Pattern follows `useCreateAgentExecution` exactly

### New: `ApprovalCard` styled component
- Self-contained card rendering a `PendingApproval` proto with action buttons (Approve/Skip/Reject)
- Shield icon header, tool name badge, approval message, collapsible args preview, live-ticking wait duration
- Sub-agent attribution when `fromSubAgent` is true
- Per-button spinner on the active action during submission
- All `--stgm-*` tokens, inline SVG icons, `role="alert"` for accessibility, `<div>` not `<form>`
- No comment field in v1 (proto accepts empty comment)

### Updated: `MessageThread`
- New `ThreadItem` kind: `"approval-request"` in the discriminated union
- Two optional props: `onApprovalSubmit`, `submittingApprovalIds`
- `buildThreadItems()` appends approval items from `lastExec.status.pendingApprovals` when `onApprovalSubmit` is provided
- Fully backward compatible — no approval UI rendered when props are omitted

### Updated: `useSessionConversation`
- Composes `useSubmitApproval()` internally
- Exposes `submitApproval(toolCallId, action, comment?)` — wraps with current `activeExecutionId`
- Exposes `pendingApprovals`, `submittingApprovalIds`, `approvalError`, `clearApprovalError`

### Updated: `SessionPage` (Console)
- Passes `onApprovalSubmit` and `submittingApprovalIds` to `MessageThread`
- Displays `approvalError` alongside existing `sendError`

## Benefits

- **Users**: Can approve, skip, or reject tool calls directly from the session view — no CLI or API required
- **Platform builders**: Three adoption levels — full control (hook only), partial control (hook + card), zero effort (MessageThread props or useSessionConversation)
- **Maintainability**: Per-tool-call state tracking via `Set<string>` handles batch approval scenarios correctly
- **Backward compatibility**: Zero breaking changes — all new props are optional

## Impact

- **SDK React**: 2 new files, 3 updated files, 6 new exports (`useSubmitApproval`, `UseSubmitApprovalReturn`, `ApprovalCard`, `ApprovalCardProps` + additions to `MessageThreadProps` and `UseSessionConversationReturn`)
- **Console**: 1 updated file (minimal wiring — orchestration lives in SDK)
- **Build verification**: `typecheck`, `build` pass clean for both `sdk/react` and `client-apps/web`

## Related Work

- Completes SP5 of the Session-First Web UX project (20260317.01)
- Builds on SP1 (Core Thread + Streaming), SP2 (Follow-Up Conversation Loop), SP4 (Expandable Tool Groups)
- Proto and backend approval infrastructure was pre-existing (approval.proto, enum.proto, io.proto)

---

**Status**: Production Ready
**Timeline**: Single session
