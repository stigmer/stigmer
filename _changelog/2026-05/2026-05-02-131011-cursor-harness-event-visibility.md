# Cursor Harness Event Visibility: Tool Calls, Sub-Agents, and Thinking

**Date**: May 2, 2026

## Summary

The cursor-runner was capturing 176+ SDK events per execution but persisting only 2 messages (assistant text). Tool calls, sub-agent invocations, and thinking blocks were invisible in the UI. This change fixes three layers of data loss so that cursor harness executions show the full conversation including tool usage, sub-agent delegations, and model reasoning.

## Problem Statement

When users ran agents through the Cursor harness (HARNESS_CURSOR), the execution viewer showed only the AI's final text responses. All the intermediate work -- reading files, running shell commands, searching code, delegating to sub-agents, and the model's thinking process -- was silently dropped.

### Pain Points

- **176 events in, 2 messages out**: The Cursor SDK emits rich, granular events (assistant text, thinking blocks, tool call lifecycle, task delegations) but the message translator was only accumulating assistant text tokens.
- **Tool calls created as orphan messages**: Each `tool_call` SDK event was translated into a standalone `MESSAGE_TOOL` message. The UI expects tool calls attached to their parent `MESSAGE_AI` message's `toolCalls` array -- so they were never rendered.
- **Sub-agent invocations lost entirely**: The SDK's `task` tool calls (sub-agent delegations) were converted to generic system text. The `SubAgentExecution` proto was never populated, so the `SubAgentSection` UI component had nothing to render.
- **Thinking blocks invisible**: `MESSAGE_THINKING` messages were correctly created by the translator but `MessageEntry.tsx` had no case for them -- they fell through to `default: return null`.

## Solution

Fix all three layers of the SDK-to-UI pipeline without any proto changes (the existing model already supports everything needed).

## Implementation Details

### Layer 1: Tool Call Attachment (cursor-runner)

Refactored `MessageAccumulator` in `message-translator.ts`:

- **Attach, don't orphan**: When a `tool_call` event arrives, the accumulator now finds the most recent `MESSAGE_AI` message and appends a `ToolCall` proto to its `toolCalls` array -- matching the Python agent-runner's `StatusBuilder` pattern.
- **Update on completion**: When a `tool_call` event with `status === "completed"` or `"error"` arrives, the accumulator finds the existing `ToolCall` by `call_id` and updates its status, result, and timestamps instead of creating a duplicate.
- **Edge case handling**: If a tool call arrives before any assistant text, an empty `MESSAGE_AI` message is created as the attachment point.
- **Extracted `buildToolCallProto()`**: Reusable function that creates a `ToolCall` proto from an SDK event without wrapping it in a `MESSAGE_TOOL` message.

### Layer 2: Sub-Agent Execution Tracking (cursor-runner)

- When `tool_call` events with `name === "task"` arrive, the accumulator additionally creates `SubAgentExecution` protos with id, name (from `args.subagentType`), subject (from `args.description`), input (from `args.prompt`), status, and timestamps.
- On completion/error, the existing `SubAgentExecution` is updated with output/error.
- `execute-cursor.ts` populates `status.subAgentExecutions` from the accumulator after the stream loop.
- The UI's `MessageThread.tsx` already matches `task` tool calls by ID to `SubAgentExecution` entries and renders them via `SubAgentSection` -- no UI changes needed.

### Layer 3: Thinking Block Rendering (@stigmer/react)

Added `MESSAGE_THINKING` case to `MessageEntry.tsx` with a new `ThinkingMessage` component:

- Collapsed by default: shows first 80 characters as a preview with a thinking icon
- Expandable: full thinking content in subdued styling with left border accent
- Streaming support: spinner icon and blinking cursor during active generation
- Accessible: `aria-label`, `aria-expanded`, keyboard-navigable disclosure button
- Follows `--stgm-*` token system (no hardcoded colors)

### Live SDK Investigation

Before any code changes, ran a diagnostic script against the real Cursor SDK (v1.0.11) to capture all three event channels:

- **245 stream events** (SDKMessage): 223 assistant, 16 thinking, 4 tool_call, 2 status
- **436 delta events** (InteractionUpdate): 223 text-delta, 191 token-delta, 13 thinking-delta, 3 tool-call-started, 1 tool-call-completed, etc.
- **5 step events** (ConversationStep): 2 thinkingMessage, 2 assistantMessage, 1 toolCall

Key finding: `tool_call` events carry structured `args` and `result` objects (e.g., `{ command, timeout }` for shell, `{ status: "success", value: { exitCode, stdout, stderr } }` for results). `run.conversation()` is supported on local runs.

## Benefits

- **Full execution visibility**: Users now see tool calls, sub-agent delegations, and thinking blocks alongside assistant text -- matching the Python harness experience.
- **No proto changes**: The existing `AgentMessage.tool_calls`, `SubAgentExecution`, and `MESSAGE_THINKING` enum already supported this. The fix was purely in the TypeScript translator and React rendering.
- **No UI component changes needed for tool calls/sub-agents**: `MessageThread.tsx`, `ToolCallGroup`, `SubAgentSection`, and `ToolCallDetail` already handled the data model correctly -- they just never received the data from cursor executions.
- **Evidence-based**: Every change was preceded by live SDK investigation with real captured data, replacing assumptions with evidence.

## Impact

- **cursor-runner**: `message-translator.ts` (core translator logic), `execute-cursor.ts` (sub-agent execution population)
- **@stigmer/react**: `MessageEntry.tsx` (thinking block rendering)
- **Tests**: 40 tests covering the new attachment model, sub-agent tracking, and edge cases (all passing)
- **Users**: Cursor harness executions now show rich, interactive tool call details, sub-agent cards, and thinking blocks in the web console and any embedded `<MessageThread />` components.

## Related Work

- Python agent-runner's `StatusBuilder` pattern (the proven model this aligns with)
- `onDelta` enrichment for real-time streaming (deferred to a separate conversation)
- Streaming enrichment with `shell-output-delta`, `partial-tool-call`, `summary` events (deferred)

---

**Status**: Production Ready
**Timeline**: Single session
