"""Streaming buffer management for early tool calls, thinking, and tool input.

These functions manage the partial-data buffers that accumulate during LLM
token streaming.  They are called by both the chat-model handlers (which
create and fill the buffers) and the tool-event handlers (which reconcile
early tool calls on ``on_tool_start``).

All functions receive the ``StatusBuilder`` instance as their first argument
and operate on its ``state`` and collaborators.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    MessageType,
    ToolCallStatus,
    ToolCallStreamingSource,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    AgentMessage,
    ToolCall,
)
from google.protobuf.struct_pb2 import Struct

from stigmer_runner.worker.activities.graphton.approval_policy import render_approval_message

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder

# ---------------------------------------------------------------------------
# Module-level constants (moved from status_builder.py)
# ---------------------------------------------------------------------------

_TOOL_CONTENT_FIELDS: dict[str, list[str]] = {
    "write":          ["contents", "content", "file_content"],
    "write_file":     ["contents", "content", "file_content"],
    "create_file":    ["contents", "content", "file_content"],
    "overwrite_file": ["contents", "content", "file_content"],
    "edit":           ["new_text", "new_string", "replacement", "content"],
    "edit_file":      ["new_text", "new_string", "replacement", "content"],
    "think":          ["thought"],
}

_JSON_ESCAPES: dict[str, str] = {
    "n": "\n", "t": "\t", "r": "\r",
    '"': '"', "\\": "\\", "/": "/",
    "b": "\b", "f": "\f",
}


def _find_json_string_value_start(partial_json: str, field_name: str) -> int:
    """Return the index of the first content character of a JSON string value.

    Searches *partial_json* for ``"<field_name>"`` followed by ``:`` and ``"``,
    skipping optional whitespace.  Returns the index immediately after the
    opening quote, or ``-1`` if the pattern has not yet appeared.

    Robust against missing whitespace (``"key":"val"``) and extra whitespace
    (``"key" :  "val"``).
    """
    marker = f'"{field_name}"'
    pos = partial_json.find(marker)
    if pos < 0:
        return -1
    after_key = pos + len(marker)
    colon_pos = partial_json.find(":", after_key)
    if colon_pos < 0:
        return -1
    quote_pos = partial_json.find('"', colon_pos + 1)
    if quote_pos < 0:
        return -1
    return quote_pos + 1


def _json_unescape_partial(s: str) -> str:
    """Unescape a partial JSON string value.

    Converts standard JSON escape sequences (``\\n``, ``\\t``, ``\\"``, etc.)
    to their Python equivalents.  Processing stops at the closing ``"`` (end of
    JSON string) or at the end of the input (string is still being generated).

    A trailing backslash with no following character is silently dropped to
    avoid showing a garbled escape that is not yet complete.
    """
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch == "\\":
            if i + 1 >= n:
                break
            nxt = s[i + 1]
            if nxt == "u":
                if i + 5 < n:
                    try:
                        out.append(chr(int(s[i + 2 : i + 6], 16)))
                        i += 6
                        continue
                    except ValueError:
                        pass
                break
            out.append(_JSON_ESCAPES.get(nxt, nxt))
            i += 2
        elif ch == '"':
            break
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _utc_timestamp(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat() + "Z"


# ---------------------------------------------------------------------------
# Streaming buffer operations
# ---------------------------------------------------------------------------


def create_early_tool_call(
    sb: StatusBuilder,
    tool_name: str,
    tool_use_id: str,
    ns_key: str,
    namespace: str,
    llm_run_id: str = "",
) -> None:
    """Create a ToolCall as soon as a ``tool_use`` block appears in the stream.

    The CLI shows an idle "Thinking..." indicator when no events arrive
    for >= 2 s.  While the LLM generates tool arguments (``input_json_delta``
    chunks) the status builder has nothing to report, so the CLI falls
    back to the idle indicator even though the model has already decided
    to call a tool.

    By creating the ToolCall here -- before ``on_tool_start`` fires -- the
    CLI immediately displays the tool name with a running badge.  When
    ``on_tool_start`` arrives, ``reconcile_early_tool_call`` reconciles
    the early ToolCall (populates args, registers the real run-ID alias)
    instead of creating a duplicate.
    """
    if sb.state.thinking.buffers.get(ns_key):
        flush_thinking_buffer(sb, ns_key, namespace)

    temp_id = tool_use_id or f"early-{uuid4()}"

    if sb.get_tool_call(temp_id) is not None:
        _, sub_agent = sb._get_execution_context(namespace)
        sa_id = sub_agent.id if sub_agent else None
        sb.state.early_tool_call_queue.append((temp_id, sa_id))
        sb.logger.info(
            "[RESUME_DEDUP] execution=%s skipping early tool call "
            "creation for %s (id=%s already exists from prior cycle, "
            "re-queued for reconciliation)",
            sb.execution_id, tool_name, temp_id,
        )
        return

    mcp_server_slug = ""
    if sb._approval_config is not None:
        mcp_server_slug = sb._approval_config.get_mcp_server_for_tool(tool_name)

    now = datetime.utcnow()
    tool_call = ToolCall(
        id=temp_id,
        name=tool_name,
        result="",
        status=ToolCallStatus.TOOL_CALL_RUNNING,
        is_streaming=True,
        streaming_source=ToolCallStreamingSource.TOOL_CALL_STREAMING_SOURCE_INPUT,
        started_at=_utc_timestamp(now),
        mcp_server_slug=mcp_server_slug,
    )

    parent_ai = ensure_parent_ai_message(
        sb, ns_key, namespace, llm_run_id=llm_run_id,
    )
    parent_ai.tool_calls.append(tool_call)
    sb.state.tool_calls[temp_id] = parent_ai.tool_calls[-1]

    _, sub_agent = sb._get_execution_context(namespace)
    sa_id = sub_agent.id if sub_agent else None
    sb.state.early_tool_call_queue.append((temp_id, sa_id))
    sb.state.tool_start_times[temp_id] = now

    sb.state.tool_input.active_tc[ns_key] = temp_id
    sb.state.tool_input.buffers[temp_id] = ""

    sb.force_next_update = True


def reconcile_early_tool_call(
    sb: StatusBuilder,
    tool_name: str,
    run_id: str,
    tool_args: dict[str, Any],
    namespace: str,
) -> ToolCall | None:
    """Match an ``on_tool_start`` event to an early-created ToolCall.

    Pops the first queued entry whose ToolCall name matches *tool_name*
    and whose sub-agent context matches the current namespace.  This
    prevents cross-contamination when concurrent sub-agents invoke the
    same tool (e.g., two sub-agents both calling ``read_file``).

    If found, the existing ToolCall is updated in place (args populated,
    ``is_streaming`` cleared) and the real *run_id* is registered as an
    alias so that downstream handlers (``on_tool_end``, ``tool_progress``)
    resolve to the same proto.

    On the **resume path**, a TC from the prior cycle may be re-queued
    by ``create_early_tool_call``.  In that case only the run_id alias
    is registered -- existing state is preserved to avoid overwriting
    approval decisions already recorded.

    Returns the reconciled ToolCall, or ``None`` if no match exists.
    """
    _, sub_agent = sb._get_execution_context(namespace)
    sa_id = sub_agent.id if sub_agent else None

    for idx, (temp_id, queued_sa_id) in enumerate(sb.state.early_tool_call_queue):
        existing = sb.get_tool_call(temp_id)
        if existing is None or existing.name != tool_name:
            continue
        if queued_sa_id != sa_id:
            continue

        sb.state.early_tool_call_queue.pop(idx)

        is_resume_requeue = not existing.is_streaming
        if is_resume_requeue:
            sb._tool_call_id_capture.register_alias(run_id, temp_id)
            sb.logger.info(
                "[RECONCILE] execution=%s resume-path reconciliation: "
                "tool=%s run_id=%s -> existing_tc=%s "
                "(alias only, preserving prior-cycle state)",
                sb.execution_id, tool_name, run_id, temp_id,
            )
            return existing

        had_input_content = bool(sb.state.tool_input.buffers.get(temp_id))
        flush_tool_input_buffer(sb, temp_id)

        if not had_input_content:
            existing.result = ""

        if tool_args:
            display_args = sb._humanize_args_for_display(tool_args)
            args_struct = Struct()
            args_struct.update(display_args)
            existing.args.CopyFrom(args_struct)
            existing.args_preview = sb._create_args_preview(tool_args)

        existing.is_streaming = False
        existing.streaming_source = ToolCallStreamingSource.TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED

        if sb._approval_config is not None:
            slug = sb._approval_config.get_mcp_server_for_tool(tool_name)
            if slug and not existing.mcp_server_slug:
                existing.mcp_server_slug = slug

        approval = sb._check_tool_approval_requirement(tool_name, tool_args)
        if approval.requires_approval:
            existing.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
            existing.requires_approval = True
            existing.approval_message = render_approval_message(
                template=approval.message,
                tool_name=tool_name,
                tool_args=tool_args,
            )
            existing.approval_requested_at = _utc_timestamp(datetime.utcnow())

        sb._tool_call_id_capture.register_alias(run_id, temp_id)
        sb.state.tool_start_times[run_id] = sb.state.tool_start_times.pop(
            temp_id, datetime.utcnow()
        )

        if approval.requires_approval:
            sb._set_waiting_for_approval_phase(tool_name, run_id)

        return existing

    return None


def start_thinking_stream(
    sb: StatusBuilder,
    ns_key: str,
    namespace: str,
    initial_text: str,
    llm_run_id: str = "",
) -> None:
    """Create a RUNNING ToolCall for native thinking and begin streaming.

    Called when the first thinking content block arrives for a namespace.
    The ToolCall starts with ``is_streaming=True`` and the initial thinking
    text in ``result``.  Subsequent blocks update ``result`` via
    ``update_thinking_stream``, and ``flush_thinking_buffer`` transitions
    the ToolCall to COMPLETED when thinking ends.

    During streaming the CLI renders ``result`` via ``renderStreamingTool``
    (last N lines with a cursor indicator).  After completion the CLI reads
    ``args.thought`` via ``resolveDisplayContent`` (the ``toolDisplayMap``
    entry uses ``contentSourceInput``).
    """
    now = datetime.utcnow()
    tc_id = f"think-native-{uuid4()}"

    tool_call = ToolCall(
        id=tc_id,
        name="think",
        args=Struct(),
        result=initial_text,
        status=ToolCallStatus.TOOL_CALL_RUNNING,
        is_streaming=True,
        started_at=_utc_timestamp(now),
    )

    parent_ai = ensure_parent_ai_message(
        sb, ns_key, namespace, llm_run_id=llm_run_id,
    )
    parent_ai.tool_calls.append(tool_call)
    sb.state.tool_calls[tc_id] = parent_ai.tool_calls[-1]

    sb.state.thinking.tool_call_ids[ns_key] = tc_id
    sb.state.thinking.started_at[ns_key] = now

    sb.force_next_update = True

    sb.logger.debug(
        "[THINK] execution=%s streaming_started id=%s namespace=%s",
        sb.execution_id,
        tc_id,
        namespace or "main",
    )


def update_thinking_stream(sb: StatusBuilder, ns_key: str) -> None:
    """Update the streaming think ToolCall with the latest accumulated content."""
    tc_id = sb.state.thinking.tool_call_ids.get(ns_key)
    if not tc_id:
        return

    buf = sb.state.thinking.buffers.get(ns_key, "")

    tool_call = sb.get_tool_call(tc_id)
    if tool_call is not None:
        tool_call.result = buf


def accumulate_tool_input(
    sb: StatusBuilder, ns_key: str, partial_json: str,
) -> None:
    """Accumulate an ``input_json_delta`` fragment and update the early ToolCall.

    Appends *partial_json* to the buffer for the early ToolCall currently
    active in this namespace.  If the accumulated JSON already contains the
    tool's content field (e.g. ``"contents": "...``), the extracted value is
    written to ``tool_call.result`` so the CLI can stream it progressively.
    """
    temp_id = sb.state.tool_input.active_tc.get(ns_key)
    if not temp_id:
        return

    buf = sb.state.tool_input.buffers.get(temp_id)
    if buf is None:
        return

    sb.state.tool_input.buffers[temp_id] = buf + partial_json

    tool_call = sb.get_tool_call(temp_id)
    if tool_call is None:
        return

    content = extract_content_from_partial_json(
        tool_call.name, sb.state.tool_input.buffers[temp_id],
    )
    if content:
        tool_call.result = content


def extract_content_from_partial_json(
    tool_name: str, partial_json: str,
) -> str:
    """Extract the displayable content value from an in-progress args JSON.

    For tools listed in ``_TOOL_CONTENT_FIELDS`` (write, edit, think) the
    function locates the content field's opening quote and JSON-unescapes
    everything that has arrived so far.  Trailing incomplete escape
    sequences are silently dropped to avoid garbled output.

    Returns an empty string when the content field has not yet appeared in
    the accumulated JSON (e.g. the LLM is still generating the ``path``
    argument).
    """
    fields = _TOOL_CONTENT_FIELDS.get(tool_name)
    if not fields:
        return ""

    for field in fields:
        start = _find_json_string_value_start(partial_json, field)
        if start >= 0:
            return _json_unescape_partial(partial_json[start:])

    return ""


def flush_tool_input_buffer(sb: StatusBuilder, temp_id: str) -> None:
    """Clean up input-streaming state for a reconciled early ToolCall."""
    sb.state.tool_input.buffers.pop(temp_id, None)
    for ns_key, tid in list(sb.state.tool_input.active_tc.items()):
        if tid == temp_id:
            del sb.state.tool_input.active_tc[ns_key]
            break


def flush_thinking_buffer(sb: StatusBuilder, ns_key: str, namespace: str) -> None:
    """Finalize the streaming think ToolCall or create a completed one.

    If a streaming ToolCall exists (created by ``start_thinking_stream``),
    transitions it from RUNNING to COMPLETED in place: populates
    ``args.thought`` with the full thinking text, sets ``result`` to
    ``"ok"``, and clears the streaming flag.

    Falls back to creating a new COMPLETED ToolCall from scratch if no
    streaming ToolCall exists (defensive -- should not happen in normal flow
    since ``start_thinking_stream`` is called on the first thinking block).
    """
    thinking_text = sb.state.thinking.buffers.pop(ns_key, "")
    started_at = sb.state.thinking.started_at.pop(ns_key, None)
    tc_id = sb.state.thinking.tool_call_ids.pop(ns_key, None)
    if not thinking_text:
        return

    now = datetime.utcnow()

    args_struct = Struct()
    args_struct.update({"thought": thinking_text})

    _, sub_agent = sb._get_execution_context(namespace)
    completed_ts = _utc_timestamp(now)

    if tc_id:
        tool_call = sb.get_tool_call(tc_id)
        if tool_call is not None:
            tool_call.args.CopyFrom(args_struct)
            tool_call.result = "ok"
            tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
            tool_call.is_streaming = False
            tool_call.completed_at = completed_ts

            sb.logger.info(
                "[THINK] execution=%s streaming_completed id=%s "
                "chars=%d namespace=%s",
                sb.execution_id,
                tc_id,
                len(thinking_text),
                namespace or "main",
            )
            return

    fallback_tc = ToolCall(
        id=f"think-native-{uuid4()}",
        name="think",
        args=args_struct,
        result="ok",
        status=ToolCallStatus.TOOL_CALL_COMPLETED,
        started_at=_utc_timestamp(started_at or now),
        completed_at=completed_ts,
    )

    parent_ai = ensure_parent_ai_message(sb, ns_key, namespace)
    parent_ai.tool_calls.append(fallback_tc)
    sb.state.tool_calls[fallback_tc.id] = parent_ai.tool_calls[-1]

    sb.logger.info(
        "[THINK] execution=%s synthetic_think_tool_call "
        "chars=%d namespace=%s (fallback)",
        sb.execution_id,
        len(thinking_text),
        namespace or "main",
    )


def ensure_parent_ai_message(
    sb: StatusBuilder,
    ns_key: str,
    namespace: str,
    llm_run_id: str = "",
) -> AgentMessage:
    """Return the current parent AI message, creating an empty one if needed.

    When a tool call (including thinking) fires before the LLM has produced
    any text, there is no AI message to attach it to.  This method creates
    a zero-content ``MESSAGE_AI`` so the tool call has a parent.
    """
    existing = sb.state.current_ai_message.get(ns_key)
    if existing is not None:
        return existing

    _, sub_agent = sb._get_execution_context(namespace)
    messages_list = sub_agent.messages if sub_agent else sb.current_status.messages

    now = datetime.utcnow()
    ai_message = AgentMessage(
        type=MessageType.MESSAGE_AI,
        content="",
        timestamp=_utc_timestamp(now),
        is_streaming=False,
    )
    messages_list.append(ai_message)
    managed = messages_list[-1]
    sb.state.current_ai_message[ns_key] = managed

    if llm_run_id:
        sb.state.messages_by_run[llm_run_id] = managed

    sb.logger.debug(
        "[AI_MSG] execution=%s created empty parent AI message "
        "namespace=%s llm_run_id=%s (tool call arrived before text)",
        sb.execution_id,
        namespace or "main",
        llm_run_id or "none",
    )
    return managed
