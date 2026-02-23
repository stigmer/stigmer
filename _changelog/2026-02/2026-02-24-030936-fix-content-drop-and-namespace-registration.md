# Fix LLM Content Drop and Sub-Agent Namespace Registration

**Date**: February 24, 2026

## Summary

Fixed two interrelated bugs in the StatusBuilder streaming pipeline: (1) text content silently dropped when co-located with thinking blocks in the same streaming chunk, and (2) sub-agent namespace registration always failing due to ID-space mismatch, causing 4,665 warning messages per execution and sub-agent event misrouting to the main agent context.

## Problem Statement

After enabling native extended thinking for Claude Opus 4.6 (adaptive thinking pipeline), the `[CONTENT_DROP]` diagnostic confirmed real content loss: the LLM produced `"I'll read all 20 files simultaneously."` (38 chars) but only `"I"` (1 char) was captured during streaming. Simultaneously, the logs were flooded with ~4,665 identical `[NAMESPACE]` warnings per execution, all reporting that a sub-agent namespace had no registered mapping.

### Pain Points

- Text content silently dropped when a streaming chunk contained both `type: "thinking"` and `type: "text"` blocks — the thinking detection path returned early without checking for co-located text
- Sub-agent namespace registration used substring matching of the task tool's event `run_id` against LangGraph checkpoint namespace strings, but these are different ID spaces (event UUIDs vs. checkpoint UUIDs), so matching always failed
- Every sub-agent event fell through to main agent context, causing message leakage and potential content mixing
- The namespace warning fired on every event (~20/second), drowning out meaningful log entries

## Solution

Two targeted fixes in `status_builder.py`, plus diagnostic logging for post-deployment validation:

1. **Content drop fix**: After extracting thinking content from a list-format chunk, also extract text content from the same chunk. Only return early if the chunk is purely thinking — otherwise fall through to process the text.
2. **Namespace registration overhaul**: Replace single-strategy substring matching with a three-strategy cascade that handles both legacy and modern LangGraph namespace formats.

## Implementation Details

### Content Drop Fix (`_handle_chat_model_stream_event`)

The thinking detection block previously extracted thinking text and returned immediately if found. Now it also extracts text from the same content list. When both are present (boundary chunk between thinking and response), thinking is accumulated as before, but the method falls through to the text processing path instead of returning.

Added two targeted diagnostic logs:
- `[STREAM_DIAG] Mixed thinking+text chunk` — fires when the exact content-drop scenario is encountered
- `[STREAM_DIAG] List content with no thinking/text` — fires on format mismatches (catches unexpected block types)

### Namespace Registration (`_register_sub_agent_namespace`)

Replaced the single substring-matching strategy with a three-strategy cascade:

1. **Root-prefix matching** (multi-segment namespaces only): Once any namespace variant is registered to a sub-agent, all namespaces sharing the same root segment (before the first `|`) are automatically associated. This handles the common case where a sub-agent's graph emits events with varying second segments (`model:uuid`, `tools:uuid`, etc.) but a stable first segment.
2. **Substring matching** (legacy): Preserved for backwards compatibility — works when the task tool's `run_id` happens to appear in the namespace string.
3. **Causal correlation** (multi-segment namespaces only): When `on_tool_start(name="task")` fires, sets `_pending_sub_agent_id`. The first unregistered multi-segment namespace is associated with that pending sub-agent. This handles the common case where LangGraph checkpoint UUIDs differ from event run_ids.

### Warning Deduplication (`_get_execution_context`)

- Only warns for multi-segment namespaces (single-segment are normal main-agent graph activity)
- Logs once per unique namespace via `_warned_namespaces` set

### Sub-Agent Lifecycle

- `_handle_sub_agent_start`: Sets `_pending_sub_agent_id` for causal correlation; log elevated from DEBUG to INFO for observability
- `_handle_sub_agent_end`: Cleans up `_pending_sub_agent_id` if it matches the ending sub-agent

## Benefits

- Eliminates silent text content loss during streaming when thinking is active
- Sub-agent events correctly route to their SubAgentExecution context (messages, tool calls, usage metrics)
- Log noise reduced from ~4,665 warnings per execution to at most 1 per unique namespace
- Diagnostic logs provide post-deployment confirmation of which fix path activates

## Impact

- **Agent Runner**: All executions with extended thinking or sub-agents benefit
- **CLI users**: Sub-agent output will appear in the correct context instead of leaking into main agent messages
- **Operations**: Warning log volume drops by ~4,664x for sub-agent executions
- **No breaking changes**: Existing single-segment namespace routing (legacy substring matching) preserved; all 19 sub-agent tests pass

## Related Work

- [Diagnose LLM Text Content Dropping](2026-02-24-023238-diagnose-llm-text-content-dropping.md) — Added the `[CONTENT_DROP]` diagnostic that confirmed the bug
- [Connect Model Configuration Pipeline](2026-02-24-023731-connect-model-configuration-pipeline.md) — Enabled adaptive thinking, which activated the code path that triggers the content drop
- [Fix LLM Stream Token Interleaving](2026-02-24-022248-fix-llm-stream-token-interleaving.md) — Run-ID based message isolation (complementary fix)

---

**Status**: ✅ Production Ready (pending e2e validation via diagnostic logs)
**Timeline**: Single session
