# Fix Cursor Runner Streaming Message Fragmentation

**Date**: May 1, 2026

## Summary

The Cursor SDK emits one `assistant` event per token chunk, producing ~41 separate `AgentMessage` protos for a single LLM turn. This caused the UI to render every word on its own line. A new `MessageAccumulator` class now merges consecutive token-level events into a single `AgentMessage` per turn, matching the Python agent-runner's proven accumulation pattern.

## Problem Statement

The Cursor runner's streaming pipeline was stateless — each `SDKMessage` event from the Cursor SDK was independently translated into a new `AgentMessage` proto and appended to the execution status. Since the SDK emits one event per token chunk, a response like "Two plus two equals four." produced ~41 separate messages, each rendered on its own line in the UI.

### Pain Points

- Every streamed word appeared as a separate chat bubble in the web and CLI UIs
- `stampMetricsOnLastAiMessage` had to scan 41 messages to find the right one to stamp (now just 1)
- Status persistence fired every 5 messages (every ~5 tokens), creating excessive gRPC calls during streaming
- The `is_streaming` flag on `AgentMessage` was never set, so the UI couldn't distinguish in-progress from complete messages

## Solution

Introduced a `MessageAccumulator` class that provides turn-aware, stateful accumulation of streaming events — the same architectural pattern the Python agent-runner uses in `StatusBuilder.handle_chat_model_stream`.

The accumulator tracks active AI and thinking messages per `run_id`. The first assistant event for a `run_id` creates a new `AgentMessage` with `is_streaming=true`; subsequent events append content to the existing message. Tool call events finalize any active streaming message and pass through as discrete messages. `finalize()` closes all open streaming messages after the stream loop ends.

## Implementation Details

### MessageAccumulator (message-translator.ts)

- **State**: Two maps (`activeAiByRunId`, `activeThinkingByRunId`) tracking the in-flight message object per run
- **`processEvent()`**: Routes SDK events through accumulation logic — assistant and thinking events accumulate, tool calls pass through (after finalizing active text), task events pass through directly
- **`finalize()`**: Sets `is_streaming=false` on all active messages and clears internal state
- **Content extraction**: Reuses the existing text-block filter pattern from `translateAssistant()`

### Integration (execute-cursor.ts)

- Replaced `translateEvent()` + `status.messages.push()` in the Phase 10 streaming loop with `accumulator.processEvent()` + `accumulator.finalize()`
- Adjusted persist cadence from every 5 messages to every 20 events (since accumulated output produces far fewer messages per LLM turn)
- Import changed from `translateEvent` to `MessageAccumulator` (existing `translateEvent` retained for non-accumulated use cases)

### Validation

All assumptions were validated by running a test script against the live Cursor SDK before implementation:
- A 2-sentence prompt produced 41 separate `assistant` events, each with a single token
- All 41 events shared the same `run_id`, confirming `run_id`-based accumulation works without fallback heuristics
- Event sequence was clean: `status(RUNNING)` -> 41x `assistant` -> `status(FINISHED)`

## Benefits

- **UI rendering**: A single coherent AI message per turn instead of ~41 fragments
- **Correct streaming state**: `is_streaming` flag properly set during accumulation and cleared on finalize
- **Reduced gRPC overhead**: Status persisted every 20 events instead of every 5 messages (4x fewer RPCs during streaming)
- **Better metrics stamping**: `stampMetricsOnLastAiMessage` finds the correct message immediately (1 AI message per turn, not 41)
- **Parity with Python runner**: Same accumulation pattern as `StatusBuilder.handle_chat_model_stream` in the Python agent-runner

## Impact

- **Cursor runner output**: All Cursor-powered agent executions now produce properly formatted streaming output
- **Backward compatible**: The existing stateless `translateEvent()` and `extractDeniedToolCalls()` functions remain unchanged for other consumers
- **Test coverage**: 20 new tests covering multi-chunk merging, `is_streaming` lifecycle, interleaved event types, `run_id` boundaries, thinking accumulation, and idempotent finalize

## Related Work

- Python agent-runner's `StatusBuilder` pattern (`chat_model.py`) — the reference implementation this fix mirrors
- Cursor SDK streaming validation — confirmed token-level granularity and `run_id` consistency before implementation

---

**Status**: Production Ready
**Timeline**: Single session — investigation, validation, implementation, testing, build
