# WA03: Cursor SDK Sub-Agent Events Use Distinct `agent_id`

**Date**: 2026-05-27
**Session**: 18
**Status**: Disproved

## The Assumption

Session 17 assumed that when the Cursor SDK's Task tool spawns a sub-agent, internal events (thinking, assistant, tool_call) from that sub-agent would flow through the parent's `run.stream()` with a different `agent_id` than the parent. This led to building `CursorSubAgentRouter` — an `agent_id`-based event router with FIFO correlation to pending task registrations.

## The Reality

Empirical validation with `CURSOR_EVENT_RECORD_DIR` showed:

- **431 events (run 1) and 603 events (run 2) — all with 1 distinct `agent_id`**
- The Task tool was used (seq 34-36: running → completed) and the sub-agent completed successfully
- Sub-agent internal work is **completely opaque** during execution
- When the task completes, the sub-agent's full conversation is returned as a **result blob** inside the task tool's `completed` event:

```json
{
  "status": "success",
  "value": {
    "conversationSteps": [
      { "type": "thinkingMessage", "message": { "text": "..." } },
      { "type": "assistantMessage", "message": { "text": "..." } }
    ],
    "agentId": "2a630270-...",
    "durationMs": 9683
  }
}
```

## Secondary Finding

The Cursor SDK passes `subagentType: { kind: "unspecified" }` for all sub-agents — it doesn't propagate the blueprint-level sub-agent name (e.g., "researcher"). The `description` field is a better naming source.

## Resolution

- Removed `CursorSubAgentRouter` (dead code: 148-line class + 274-line test)
- Added `extractConversationSteps()` to parse the task tool's completed result into `SubAgentExecution.messages`
- Fixed `extractSubagentName()` to fall back to `description` when `kind` is `"unspecified"`
- Simplified `index.ts` streaming loop (removed all router wiring)

## Lesson

The Cursor SDK is a black box for sub-agent streaming. Do not assume its internal event routing mirrors the native LangGraph harness (which uses namespace-based streaming). Instead, extract data from the structured result blobs that the SDK does provide.
