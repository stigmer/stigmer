# Fix Missing Human Message in Session Thread

**Date**: March 18, 2026

## Summary

Fixed a bug where the user's input message that initiated each agent execution was invisible in the web console's session thread. The human message is stored in `execution.spec.message` but the `MessageThread` component only read from `execution.status.messages[]`, which never contains human messages. The CLI already handled this correctly.

## Problem Statement

When opening a session in the web console, the conversation thread showed AI responses, tool calls, and approval gates -- but no human message bubble. Users could not see what they had asked the agent to do.

### Pain Points

- Opening an existing session showed agent output with no visible user prompt
- The conversation thread lacked conversational context -- it was unclear what triggered each execution
- The CLI displayed human messages correctly, creating an inconsistency between surfaces

## Solution

Synthesize a `MESSAGE_HUMAN` thread item from `execution.spec.message` at the start of each execution's message block in `buildThreadItems()`, mirroring the CLI's "Step 0" pattern. Added a dedup guard to prevent a single-frame visual duplicate during the optimistic-to-stream handoff.

## Implementation Details

Single file change in `sdk/react/src/execution/MessageThread.tsx`:

1. **Spec message synthesis**: For each execution, before iterating `status.messages`, read `exec.spec?.message`. If present and not the `"execute"` placeholder, create a proper `AgentMessage` via `create(AgentMessageSchema)` with `MESSAGE_HUMAN` type and push it as the first item for that execution.

2. **Dedup guard**: When appending the optimistic `pendingUserMessage` at the end of the thread, check whether the last execution's `spec.message` already matches. This prevents a one-frame duplicate during the handoff from optimistic rendering to stream-delivered data.

3. **Proper protobuf instantiation**: Used `create(AgentMessageSchema)` from `@bufbuild/protobuf` (the established pattern in this codebase) rather than a plain object cast, ensuring the synthetic message conforms to the full protobuf `Message` contract.

## Benefits

- Human messages now appear in the session thread for both completed and streaming executions
- Consistent behavior between CLI and web console
- No rendering changes needed -- `MessageEntry` already had a `HumanMessage` sub-component
- Zero risk of duplicate messages during the optimistic/stream handoff

## Impact

- **SDK (`@stigmer/react`)**: `MessageThread` component now renders complete conversation threads. Platform builders embedding the component get correct behavior without any prop changes.
- **Console (`client-apps/web`)**: Sessions now display the full conversation flow.
- **No backend changes**: The data was already available in `spec.message`; only the frontend was ignoring it.

## Related Work

- CLI implementation: `client-apps/cli/cmd/stigmer/root/run_stream_events.go` (Step 0 pattern)
- SP1 Step 3 styled components: `2026-03-17-191252-sp1-step3-sdk-styled-components.md`
- SP2 follow-up conversation loop: `2026-03-18-063854-sp2-follow-up-conversation-loop.md`

---

**Status**: Production Ready
