# Fix Streaming UX and Protobuf Copy Semantics in StatusBuilder

**Date**: February 24, 2026

## Summary

Resolved a cascade of interrelated bugs in the `StatusBuilder` that caused agent messages to be silently dropped, truncated to a single token, and sub-agent activity to be invisible in the CLI. Additionally introduced early tool call creation so the CLI immediately shows which tool the LLM is preparing — replacing the misleading "Thinking…" idle indicator during argument generation.

## Problem Statement

After enabling native extended thinking for Opus 4.6, several critical issues emerged in the agent execution pipeline:

### Pain Points

- **Content drop**: Agent messages were silently lost — the CLI showed nothing after the thinking phase completed and a tool executed
- **Truncated streaming**: Only the first token of agent messages appeared (e.g., "Now" or "Now I"), with the rest silently discarded
- **Invisible sub-agents**: Sub-agent activity (messages, tool calls) was happening internally but never surfaced to the CLI
- **Misleading idle indicator**: During tool argument generation (10–20 seconds for large files), the CLI showed "Thinking…" even though the model had already decided which tool to call
- **Noisy diagnostics**: Expected non-text block types (`tool_use`, `input_json_delta`) generated excessive `[STREAM_DIAG]` logs at INFO level

## Solution

The root cause of the first three issues was **protobuf repeated-field copy semantics**: when you `append()` a message to a protobuf repeated field, the field copies the value and the original Python object becomes disconnected. Any subsequent mutations to the original are invisible to consumers reading from the proto. This same bug manifested in three independent locations.

The idle indicator issue was solved by creating ToolCall protos as soon as the LLM stream produces a `tool_use` block, before `on_tool_start` fires from LangGraph's tool execution.

## Implementation Details

### 1. Protobuf Copy Semantics — SubAgentExecution (invisible sub-agents)

`_handle_sub_agent_start` appended a `SubAgentExecution` to `current_status.sub_agent_executions` and stored the **original** object in `_active_sub_agents`. All later mutations (adding messages, tool calls, usage) wrote to the disconnected original.

**Fix**: Store `self.current_status.sub_agent_executions[-1]` (the proto-managed reference) instead.

### 2. Protobuf Copy Semantics — AgentMessage (truncated streaming)

`_handle_chat_model_stream_event` appended a new `AgentMessage` to `messages_list` and stored the **original** in `_llm_run_id_to_message`. Subsequent token appends (`ai_message.content += token`) mutated the disconnected copy — only the first token was visible in the proto.

**Fix**: Store `messages_list[-1]` (the proto-managed reference) in `_llm_run_id_to_message`.

### 3. Content Drop Safety Net

`_handle_chat_model_end_event` detected content drops via `[CONTENT_DROP]` logging but never reconciled. Even with the streaming fix above, edge cases could still cause partial content.

**Fix**: When a content drop is detected, overwrite `ai_message.content` with the authoritative `final_text` from `on_chat_model_end`.

### 4. Hardened Content Extractors

`_extract_string_content` and `_extract_thinking_content` only handled `dict` content blocks. LangChain can also produce attribute-based objects.

**Fix**: Introduced `_block_attr()` static helper that reads from both dicts and objects, used throughout the content extraction pipeline.

### 5. Error Isolation in process_event

A single malformed event could crash the entire activity stream.

**Fix**: Wrapped all handler calls in `try/except` with `[EVENT_ERROR]` logging so individual event failures are isolated.

### 6. Diagnostic Noise Reduction

Expected non-text block types (`thinking`, `tool_use`, `input_json_delta`) were logged at INFO level, generating excessive `[STREAM_DIAG]` noise.

**Fix**: Route expected types to DEBUG; only unexpected types remain at INFO.

### 7. Early Tool Call Creation (Live Write Streaming UX)

When the LLM generates a `tool_use` block in the stream, the status builder now:
1. Flushes the thinking buffer (ending the synthetic think tool call)
2. Creates a ToolCall with a temporary ID (`early-{tool_use_id}`) and `is_streaming=True`
3. Appends it to the execution context (main agent or sub-agent)

When `on_tool_start` fires, `_reconcile_early_tool_call` finds the matching early ToolCall by name, populates its args, registers the real LangGraph `run_id` as an alias via `_run_id_aliases`, and handles approval — preventing duplicate ToolCall creation.

**Result**: The CLI shows `📝 Write ⏳` immediately instead of "Thinking…" for the 10–20 seconds while the LLM generates file content.

## Benefits

- **Complete agent messages**: All text content from LLM responses is now reliably delivered to the CLI
- **Full sub-agent visibility**: Sub-agent messages, tool calls, and usage metrics are visible in real time
- **Responsive tool feedback**: Users see which tool the agent is preparing within milliseconds of the model's decision
- **Resilient event processing**: Individual event failures are isolated and logged without crashing the stream
- **Cleaner logs**: Diagnostic noise reduced by routing expected block types to DEBUG

## Impact

- **StatusBuilder** (`backend/services/agent-runner/worker/activities/graphton/status_builder.py`): All changes are in this single file
- **CLI**: No changes required — the existing `ToolRunningEvent` / `ToolStreamDeltaEvent` / `ToolCompletedEvent` pipeline handles early tool calls naturally
- **Proto**: No schema changes — leverages existing `is_streaming` and `_run_id_aliases` infrastructure

## Related Work

- [Native Extended Thinking](2026-02-24-023238-diagnose-llm-text-content-dropping.md) — the feature that surfaced these bugs
- [Model Config Pipeline](2026-02-24-023731-connect-model-configuration-pipeline.md) — Opus 4.6 with adaptive thinking

---

**Status**: ✅ Production Ready
**Timeline**: ~4 hours (diagnosis, iterative fixes, deployment verification)
