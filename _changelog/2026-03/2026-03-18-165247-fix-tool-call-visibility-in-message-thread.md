# Fix Tool Call Visibility in Message Thread

**Date**: March 18, 2026

## Summary

Tool calls were completely invisible in the conversation thread because the backend wrapped them in standalone `MESSAGE_TOOL` messages while the frontend expected them on the parent `MESSAGE_AI`'s `tool_calls[]` field. This change migrates to the standard AI-message-owns-its-tool-calls model used by OpenAI, Anthropic, and LangChain, making all tool executions — including native thinking — visible inline in the thread.

## Problem Statement

Users could not see what tools the agent was executing in the main conversation thread. Only the agent's text responses appeared; the actual tool invocations (read, write, shell, search, etc.) were absent from the timeline.

### Pain Points

- Tool call groups were completely missing from the thread — not collapsed or subtle, but absent
- Users had no visibility into what the agent was doing between its text responses
- The disconnect between backend data model and frontend rendering expectations meant zero tool calls rendered
- Thinking blocks (native extended thinking) were only visible in the execution details sidebar, not in the main thread

## Solution

Three-layer fix across backend data model, backend thinking lifecycle, and frontend rendering:

1. **Backend: AI-message-owns-its-tool-calls model** — Stop creating `MESSAGE_TOOL` wrapper messages. Instead, attach `ToolCall` objects directly to the `MESSAGE_AI` that triggered them, matching the standard conversation model.

2. **Backend: Empty-content AI message for orphan tool calls** — When a tool call (including thinking) fires before the LLM has produced any text, create an empty-content `MESSAGE_AI` as its parent. When text tokens arrive later, a new AI message is created naturally, preserving chronological grouping.

3. **Frontend: Skip empty message bubbles** — AI messages with empty content don't render a text bubble; only their tool call group renders. This creates a clean UX: thinking shows as a standalone tool group, followed by the AI's text response with its tool calls beneath.

## Implementation Details

### Backend (`status_builder.py`)

- **`_ensure_parent_ai_message(ns_key, namespace)`** — New helper that returns the existing parent AI message or creates an empty-content one. This is the universal fallback ensuring every tool call has a parent.

- **`_handle_tool_start_event`** — Replaced `MESSAGE_TOOL` wrapper creation with `_ensure_parent_ai_message()` + `parent_ai.tool_calls.append(tool_call)`.

- **`_create_early_tool_call`** — Same pattern: guaranteed parent via `_ensure_parent_ai_message()`.

- **`_start_thinking_stream`** — Now attaches the thinking `ToolCall` to an AI message (creating an empty one if needed) in addition to the flat index.

- **`_update_thinking_stream`** and **`_flush_thinking_buffer`** — Sync updates (result, status, args, completion) to both the flat-list copy and the AI-message copy, respecting protobuf copy semantics.

- **`_update_tool_call_on_ai_message`** — Extended with `args_struct` parameter for thinking flush.

- **`_last_ai_message` tracker** — Per-namespace dictionary storing the most recent AI message reference. Overwritten when new text tokens create a new AI message, ensuring correct parent assignment across thinking → text → tool call transitions.

- **Early tool call reconciliation sync** — After `_reconcile_early_tool_call` returns, syncs reconciled fields (result, status, args, approval) back to the AI-message copy.

### Frontend (`MessageThread.tsx`)

- **Empty-content AI message handling** — `buildThreadItems` skips the message bubble for AI messages with empty `content` but still emits their `tool-group` item. Result: thinking renders as a standalone tool group without a blank bubble.

### Frontend (`ToolCallGroup.tsx`)

- **Auto-expand/collapse** — Tool call groups auto-expand when status is running/pending/waiting, auto-collapse on completion. User manual toggle overrides auto-behavior via `userToggledRef`.

## Benefits

- Tool calls are now visible inline in the conversation thread for the first time
- Thinking blocks appear before the AI's text response, matching Cursor's UX pattern
- The data model aligns with industry-standard AI conversation models (OpenAI, Anthropic, LangChain)
- Auto-expand/collapse reduces visual noise while keeping active tools prominent
- Empty-content AI messages provide a clean universal solution for orphan tool calls

## Impact

- **Backend**: `status_builder.py` — 246 insertions, 111 deletions across tool start, thinking, progress, and end handlers
- **Frontend**: `MessageThread.tsx` — 17 line changes; `ToolCallGroup.tsx` — 25 line changes
- **Users**: Tool execution visibility goes from zero to full inline rendering
- **Data model**: `MESSAGE_TOOL` messages are no longer produced; existing skip guards remain as defensive no-ops

## Related Work

- Session page redesign project (`20260318.03.session-page-redesign`) — this fix completes tool visibility within the redesigned single-canvas layout
- `2026-03-18-070125-sp4-expandable-tool-groups.md` — original tool group component this fix enables
- `2026-03-18-134331-tool-call-ux-overhaul.md` — CLI-side tool call rendering improvements

---

**Status**: Production Ready
**Timeline**: Single session
