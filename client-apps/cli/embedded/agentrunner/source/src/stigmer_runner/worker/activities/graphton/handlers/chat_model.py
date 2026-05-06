"""Chat-model event handlers extracted from StatusBuilder.

Handles ``on_chat_model_stream`` and ``on_chat_model_end`` events,
building and finalising AI messages in the execution status proto.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import AgentMessage

from stigmer_runner.worker.activities.graphton.handlers import formatting, streaming_buffers
from stigmer_runner.worker.activities.graphton.handlers.tool_event import PLANNING_TOOLS

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder


def _utc_timestamp(dt: datetime | None = None) -> str:
    """Return a UTC datetime as an RFC 3339 timestamp string.

    Appends the ``Z`` suffix so that consumers using strict RFC 3339 / ISO 8601
    parsers (e.g. Go's ``time.Parse(time.RFC3339, …)``) can parse the value
    without ambiguity.

    Args:
        dt: A UTC datetime to format. If *None*, ``datetime.utcnow()`` is used.
    """
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat() + "Z"


def handle_chat_model_stream(sb: StatusBuilder, event: dict[str, Any], namespace: str = "") -> None:
    """Handle on_chat_model_stream event - updates local status."""
    chunk_data = event.get("data", {}).get("chunk", {})

    if not chunk_data:
        return

    # Try to register namespace for event routing
    if namespace:
        sb._register_sub_agent_namespace(namespace, event)

    # ─────────────────────────────────────────────────────────────────────
    # LLM Turn-Boundary Detection
    #
    # Each LLM invocation carries a unique run_id.  When the run_id
    # changes we know a new LLM turn has started.  Clear the cached
    # _last_ai_message for this namespace so that thinking/tool_use
    # blocks from the new turn create a fresh parent AI message
    # instead of piling onto the previous turn's parent.
    #
    # For text-producing turns this is harmless — the text path
    # already creates a new AI message per new run_id.  The fix
    # matters for thinking-only turns where no text path runs and
    # _last_ai_message would otherwise remain stale.
    # ─────────────────────────────────────────────────────────────────────
    run_id = event.get("run_id", "")
    ns_key = namespace or ""
    if run_id and run_id != sb.state.last_llm_run_id.get(ns_key):
        sb.state.current_ai_message.pop(ns_key, None)
        sb.state.last_llm_run_id[ns_key] = run_id

    # ─────────────────────────────────────────────────────────────────────
    # Native Thinking Detection
    #
    # When Anthropic extended thinking is active, content blocks arrive as
    # dicts with type:"thinking" BEFORE the text/tool_use blocks.  We
    # accumulate thinking content in a per-namespace buffer and skip AI
    # message creation for these chunks.  When the first non-thinking
    # content arrives we flush the buffer into a synthetic think ToolCall.
    #
    # A single chunk may contain BOTH thinking and text blocks (e.g., at
    # the boundary between thinking and response output).  We must
    # process thinking content AND check for co-located text — only
    # returning early if the chunk is purely thinking content.
    # ─────────────────────────────────────────────────────────────────────
    if hasattr(chunk_data, "content") and isinstance(chunk_data.content, list):
        ns_key = namespace or ""
        thinking_text = formatting.extract_thinking_content(chunk_data.content)
        text_in_same_chunk = formatting.extract_string_content(chunk_data.content)

        # Diagnostic: log mixed chunks and empty extractions
        if thinking_text and text_in_same_chunk:
            sb.logger.info(
                f"[STREAM_DIAG] Mixed thinking+text chunk: "
                f"execution={sb.execution_id} "
                f"run_id={event.get('run_id', '')} "
                f"namespace={namespace or 'main'} "
                f"thinking_len={len(thinking_text)} "
                f"text_len={len(text_in_same_chunk)} "
                f"text={text_in_same_chunk[:100]!r}"
            )
        elif not thinking_text and not text_in_same_chunk:
            expected_non_text_types = frozenset({
                "thinking", "tool_use", "input_json_delta",
            })
            block_types = [
                formatting.block_attr(b, "type", type(b).__name__)
                for b in chunk_data.content[:5]
            ]
            is_expected = (
                not block_types
                or all(bt in expected_non_text_types for bt in block_types)
            )
            if not is_expected:
                sb.logger.info(
                    f"[STREAM_DIAG] List content with no thinking/text: "
                    f"execution={sb.execution_id} "
                    f"run_id={event.get('run_id', '')} "
                    f"namespace={namespace or 'main'} "
                    f"blocks={len(chunk_data.content)} "
                    f"block_types={block_types}"
                )

        # ── Early Tool Call Creation ─────────────────────────────────────
        # When a tool_use block appears in the stream, create the ToolCall
        # right away so the CLI replaces the idle "Thinking…" indicator
        # with the actual tool name (e.g. "Write: …").
        skip_early_tools = frozenset(PLANNING_TOOLS)
        for block in chunk_data.content:
            try:
                if formatting.block_attr(block, "type") == "tool_use":
                    t_name = formatting.block_attr(block, "name")
                    t_id = formatting.block_attr(block, "id")
                    if t_name and t_name not in skip_early_tools:
                        sb._create_early_tool_call(
                            t_name, t_id, ns_key, namespace,
                            llm_run_id=run_id,
                        )
            except Exception:
                sb.logger.exception(
                    f"[TOOL_EARLY_ERROR] execution={sb.execution_id} "
                    f"block={block!r:.200} namespace={namespace or 'main'}"
                )

        # ── Tool Input Streaming ─────────────────────────────────────────
        # Accumulate input_json_delta fragments and extract displayable
        # content into the early ToolCall's result field so the CLI can
        # render it progressively (same mechanism as thinking streaming).
        for block in chunk_data.content:
            try:
                if formatting.block_attr(block, "type") == "input_json_delta":
                    partial = formatting.block_attr(block, "partial_json")
                    if partial:
                        streaming_buffers.accumulate_tool_input(sb, ns_key, partial)
            except Exception:
                sb.logger.exception(
                    f"[TOOL_INPUT_ERROR] execution={sb.execution_id} "
                    f"namespace={namespace or 'main'}"
                )

        if thinking_text:
            sb.state.thinking.buffers[ns_key] = (
                sb.state.thinking.buffers.get(ns_key, "") + thinking_text
            )
            if ns_key not in sb.state.thinking.tool_call_ids:
                streaming_buffers.start_thinking_stream(sb,
                    ns_key, namespace, sb.state.thinking.buffers[ns_key],
                    llm_run_id=run_id,
                )
            else:
                streaming_buffers.update_thinking_stream(sb, ns_key)

            if not text_in_same_chunk:
                return
            # Fall through: chunk has both thinking AND text.
            # Thinking is accumulated above; text is processed below.

    # Extract token
    token = ""
    if hasattr(chunk_data, "content"):
        chunk_content = chunk_data.content
        if isinstance(chunk_content, str):
            token = chunk_content
        elif isinstance(chunk_content, list):
            token = formatting.extract_string_content(chunk_content)

    if not token:
        return

    # Flush any accumulated thinking before processing text content.
    # This ensures the synthetic think ToolCall appears in the status
    # timeline before the AI message that follows it.
    ns_key = namespace or ""
    if sb.state.thinking.buffers.get(ns_key):
        streaming_buffers.flush_thinking_buffer(sb, ns_key, namespace)

    # ─────────────────────────────────────────────────────────────────────
    # run_id-Based Message Isolation
    #
    # Each LLM invocation has a unique run_id. We use it to map tokens
    # to the correct AgentMessage, preventing interleaving when multiple
    # LLM streams are active (e.g., concurrent sub-agents whose namespace
    # routing fell through to the main agent).
    #
    # When run_id is absent, we fall back to the legacy backwards-scan
    # for the last streaming AI message in the resolved context.
    # ─────────────────────────────────────────────────────────────────────
    run_id = event.get("run_id", "")
    context, sub_agent = sb._get_execution_context(namespace)
    messages_list = sub_agent.messages if sub_agent else sb.current_status.messages

    # Fast path: run_id already mapped to a message from an earlier token.
    if run_id:
        ai_message = sb.state.messages_by_run.get(run_id)
        if ai_message is not None:
            # Empty parent AI messages created by _ensure_parent_ai_message
            # for thinking/tool_use blocks must NOT receive text content.
            # Text should go to a separate AI message so the frontend
            # renders the thread in chronological order: thinking tool
            # group first, then the text response.  Remove the stale
            # registration so the "first token" path below creates a
            # proper text AI message and re-registers the run_id.
            if not ai_message.content and len(ai_message.tool_calls) > 0:
                del sb.state.messages_by_run[run_id]
            else:
                ai_message.content += token
                return

    if not run_id:
        # Legacy fallback: no run_id available — find the last streaming
        # AI message in this context (pre-isolation behaviour).
        for idx in range(len(messages_list) - 1, -1, -1):
            message = messages_list[idx]
            if message.type == MessageType.MESSAGE_AI and message.is_streaming:
                message.content += token
                return

    # First token for this run_id (or no existing streaming message in
    # legacy mode) — create a new AgentMessage.
    now = datetime.utcnow()
    ai_message = AgentMessage(
        type=MessageType.MESSAGE_AI,
        content=token,
        timestamp=_utc_timestamp(now),
        is_streaming=True,
    )
    messages_list.append(ai_message)

    # Store the proto-managed reference (not the original, which is
    # disconnected after protobuf repeated-message append).
    managed_ai_message = messages_list[-1]

    if run_id:
        sb.state.messages_by_run[run_id] = managed_ai_message

    # Track as the most recent AI message for this namespace so that
    # subsequent tool calls (on_tool_start, early tool_use) are attached
    # to the correct parent AI message.
    ns_key = namespace or ""
    sb.state.current_ai_message[ns_key] = managed_ai_message

    # Track start time for duration calculation
    new_message_index = len(messages_list) - 1
    if sub_agent:
        sb.state.sub_agent_message_start_times[(sub_agent.id, new_message_index)] = now
        sb.logger.debug(f"Started new AI message in sub_agent={sub_agent.id} at index {new_message_index} run_id={run_id}")
    else:
        sb.state.message_start_times[new_message_index] = now
        sb.logger.debug(f"Started new AI message at index {new_message_index} run_id={run_id}")


def handle_chat_model_end(sb: StatusBuilder, event: dict[str, Any], namespace: str = "") -> None:
    """
    Handle on_chat_model_end event - finalize AI message and capture usage metrics.

    This event is emitted when the LLM completes generating a response. It contains:
    - Final message content (already captured via streaming)
    - Usage metadata (token counts) - only available in this event
    - Model information

    Args:
        sb: The StatusBuilder instance
        event: The astream_events v2 event dictionary
        namespace: LangGraph checkpoint namespace for sub-agent routing
    """
    output_data = event.get("data", {}).get("output", {})

    if not output_data:
        return

    # Flush any remaining thinking content that wasn't followed by text
    # (e.g. the model only produced thinking + tool_use, no text block).
    ns_key = namespace or ""
    if sb.state.thinking.buffers.get(ns_key):
        streaming_buffers.flush_thinking_buffer(sb, ns_key, namespace)

    # ─────────────────────────────────────────────────────────────────────
    # run_id-Based Message Resolution (with backwards-scan fallback)
    # ─────────────────────────────────────────────────────────────────────
    run_id = event.get("run_id", "")
    context, sub_agent = sb._get_execution_context(namespace)
    messages_list = sub_agent.messages if sub_agent else sb.current_status.messages

    ai_message_index = None

    # Primary path: resolve via run_id map (matches stream handler)
    tracked_message = sb.state.messages_by_run.pop(run_id, None) if run_id else None
    if tracked_message is not None:
        for idx in range(len(messages_list) - 1, -1, -1):
            if messages_list[idx] is tracked_message:
                ai_message_index = idx
                break

    # Fallback: backwards scan for last streaming AI message
    if ai_message_index is None:
        for idx in range(len(messages_list) - 1, -1, -1):
            message = messages_list[idx]
            if message.type == MessageType.MESSAGE_AI and message.is_streaming:
                ai_message_index = idx
                break

    if ai_message_index is None:
        context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
        sb.logger.warning(
            f"on_chat_model_end received but no AI message found to finalize "
            f"({context_desc} run_id={run_id})"
        )
        return

    # Calculate generation duration if we tracked the start time
    generation_duration_ms = None
    if sub_agent:
        # Check sub-agent timing dict
        timing_key = (sub_agent.id, ai_message_index)
        if timing_key in sb.state.sub_agent_message_start_times:
            start_time = sb.state.sub_agent_message_start_times[timing_key]
            duration = datetime.utcnow() - start_time
            generation_duration_ms = int(duration.total_seconds() * 1000)
            del sb.state.sub_agent_message_start_times[timing_key]
    else:
        # Check main agent timing dict
        if ai_message_index in sb.state.message_start_times:
            start_time = sb.state.message_start_times[ai_message_index]
            duration = datetime.utcnow() - start_time
            generation_duration_ms = int(duration.total_seconds() * 1000)
            del sb.state.message_start_times[ai_message_index]

    # ─────────────────────────────────────────────────────────────────────────
    # Diagnostic: capture output_data shape for zero-usage debugging.
    # Log the concrete type, usage_metadata value, and whether
    # response_metadata carries a raw ``usage`` dict (Anthropic always
    # populates this even during streaming).
    # ─────────────────────────────────────────────────────────────────────────
    _rm = getattr(output_data, "response_metadata", None)
    _rm_usage = _rm.get("usage") if isinstance(_rm, dict) else None
    sb.logger.debug(
        "[USAGE_DIAG] execution=%s run_id=%s "
        "output_data_type=%s "
        "has_usage_metadata=%s usage_metadata=%r "
        "response_metadata_keys=%s "
        "response_metadata_usage=%r",
        sb.execution_id,
        run_id,
        type(output_data).__name__,
        hasattr(output_data, "usage_metadata"),
        getattr(output_data, "usage_metadata", "N/A"),
        list(_rm.keys()) if isinstance(_rm, dict) else "N/A",
        _rm_usage,
    )
    del _rm, _rm_usage

    # ─────────────────────────────────────────────────────────────────────────
    # Extract usage metadata from LangChain response (Phase 3)
    #
    # LangChain normalises provider token counts into a unified
    # ``usage_metadata`` structure:
    #   input_tokens   — TOTAL input including cache (both providers)
    #   output_tokens  — output / completion tokens
    #   input_token_details.cache_creation — Anthropic cache writes
    #   input_token_details.cache_read     — cache reads (both)
    #
    # For cost calculation we need four disjoint buckets:
    #   regular_input = input_tokens - cache_creation - cache_read
    # ─────────────────────────────────────────────────────────────────────────
    total_input_tokens = 0
    output_tokens = 0
    cache_creation_tokens = 0
    cache_read_tokens = 0
    model_name = ""

    # Resolve usage_metadata from AIMessage attribute or raw dict.
    usage: dict | None = None
    if hasattr(output_data, "usage_metadata") and output_data.usage_metadata:
        usage = output_data.usage_metadata
    elif isinstance(output_data, dict):
        usage = output_data.get("usage_metadata") or output_data.get("usage")

    # UsageMetadata is a TypedDict (plain dict at runtime) in all
    # langchain-core versions.  Use dict .get() for key access;
    # getattr() silently returns the default on dicts.
    if usage and isinstance(usage, dict):
        total_input_tokens = usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0) or 0
        output_tokens = usage.get("output_tokens", 0) or usage.get("completion_tokens", 0) or 0
        details = usage.get("input_token_details") or {}
        if isinstance(details, dict):
            cache_creation_tokens = details.get("cache_creation", 0) or 0
            cache_read_tokens = details.get("cache_read", 0) or 0

    # Derive the non-cached regular input (disjoint bucket for cost)
    regular_input_tokens = max(0, total_input_tokens - cache_creation_tokens - cache_read_tokens)

    # Extract model name from response_metadata
    if hasattr(output_data, "response_metadata"):
        response_meta = output_data.response_metadata
        if isinstance(response_meta, dict):
            model_name = response_meta.get("model", "") or response_meta.get("model_name", "")
    elif isinstance(output_data, dict):
        response_meta = output_data.get("response_metadata", {})
        model_name = response_meta.get("model", "") or response_meta.get("model_name", "")

    # ─────────────────────────────────────────────────────────────────────────
    # Finalize AI message streaming state fields
    # ─────────────────────────────────────────────────────────────────────────
    ai_message = messages_list[ai_message_index]

    ai_message.is_streaming = False

    # ─────────────────────────────────────────────────────────────────────────
    # Diagnostic: detect text content dropped during streaming
    #
    # The output_data contains the FULL final AIMessage with all content
    # blocks.  Extract the text portion and compare with what the stream
    # handler accumulated.  A mismatch proves tokens were silently dropped.
    # ─────────────────────────────────────────────────────────────────────────
    try:
        final_text = ""
        if hasattr(output_data, "content"):
            oc = output_data.content
            if isinstance(oc, str):
                final_text = oc
            elif isinstance(oc, list):
                final_text = formatting.extract_string_content(oc)
        elif isinstance(output_data, dict) and "content" in output_data:
            oc = output_data["content"]
            if isinstance(oc, str):
                final_text = oc
            elif isinstance(oc, list):
                final_text = formatting.extract_string_content(oc)

        streamed_text = ai_message.content
        if final_text and final_text != streamed_text:
            sb.logger.warning(
                f"[CONTENT_DROP] execution={sb.execution_id} run_id={run_id} "
                f"namespace={namespace or 'main'} "
                f"streamed_len={len(streamed_text)} final_len={len(final_text)} "
                f"streamed={streamed_text[:200]!r} "
                f"final={final_text[:200]!r}"
            )
            # Reconcile: overwrite with the authoritative final content
            # so the CLI shows the complete message even if streaming
            # was disrupted (e.g. by proto copy semantics).
            ai_message.content = final_text
        elif final_text:
            sb.logger.debug(
                f"[CONTENT_OK] execution={sb.execution_id} run_id={run_id} "
                f"len={len(streamed_text)} content={streamed_text[:100]!r}"
            )
    except Exception:
        pass

    # ─────────────────────────────────────────────────────────────────────────
    sb.logger.debug(
        "AI message finalized at index %d (tokens: %d, duration: %sms)",
        ai_message_index,
        total_input_tokens + output_tokens,
        generation_duration_ms or "N/A",
    )
