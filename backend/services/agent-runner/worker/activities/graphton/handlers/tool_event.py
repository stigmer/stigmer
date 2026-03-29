"""Tool lifecycle event handlers: on_tool_start, on_tool_end, tool_progress.

All functions receive the ``StatusBuilder`` instance as their first argument.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import (
    ComponentMetadata,
    ToolCall,
)
from google.protobuf.struct_pb2 import Struct
from worker.activities.graphton.approval_policy import render_approval_message
from graphton.core.backends.platform_mount import humanize_sandbox_paths
from worker.activities.graphton.handlers import formatting
from worker.component_type_inference import infer_component_type

if TYPE_CHECKING:
    from worker.activities.graphton.status_builder import StatusBuilder


def _utc_timestamp(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat() + "Z"


PLANNING_TOOLS = {
    'write_todos',
}

_READ_ONLY_TOOLS: frozenset[str] = frozenset({"read", "read_file"})
_MAX_STATUS_RESULT_CHARS: int = 50_000


async def handle_tool_start(sb: StatusBuilder, event: dict[str, Any], namespace: str = "") -> None:
    """Handle on_tool_start event - updates local status."""
    tool_name = event.get("name", "")
    tool_args_raw = event.get("data", {}).get("input", {})
    run_id = event.get("run_id", "")

    if not tool_name or not run_id:
        return

    tool_args = formatting.unwrap_tool_args(tool_args_raw)

    tool_call_id = sb._tool_call_id_capture.get(run_id)
    if tool_call_id:
        existing = sb.state.tool_calls.get(tool_call_id)
        if existing is not None and not existing.is_streaming:
            if run_id != tool_call_id:
                sb._tool_call_id_capture.register_alias(run_id, tool_call_id)
            sb.logger.info(
                "[IDENTITY_DEDUP] execution=%s tool=%s run_id=%s -> "
                "existing_tc=%s (resume path, alias only)",
                sb.execution_id, tool_name, run_id, tool_call_id,
            )
            if tool_name != "task":
                return

    if tool_name in PLANNING_TOOLS:
        if tool_name == "write_todos":
            todos_data = tool_args.get("todos", [])
            if not todos_data:
                return
            _, sub_agent = sb._get_execution_context(namespace)
            if sub_agent is not None:
                sb._update_sub_agent_todos(sub_agent, todos_data)
            else:
                sb._update_todos(todos_data)
        return

    if tool_name == "task":
        tool_call_id_val: str | None = None
        early_tc = sb._reconcile_early_tool_call(tool_name, run_id, tool_args, namespace)
        if early_tc is not None:
            tool_call_id_val = early_tc.id
        else:
            ns_key = namespace or ""
            display_args = sb._humanize_args_for_display(tool_args) if tool_args else {}
            args_struct = Struct()
            if display_args:
                args_struct.update(display_args)
            now = datetime.utcnow()
            tool_call = ToolCall(
                id=run_id,
                name=tool_name,
                args=args_struct,
                args_preview=sb._create_args_preview(tool_args),
                result="",
                status=ToolCallStatus.TOOL_CALL_RUNNING,
                component_metadata=ComponentMetadata(
                    component_type=infer_component_type(tool_name),
                    component_group="main-agent-tools",
                ),
                started_at=_utc_timestamp(now),
            )
            parent_ai = sb._ensure_parent_ai_message(ns_key, namespace)
            parent_ai.tool_calls.append(tool_call)
            sb.state.tool_calls[run_id] = parent_ai.tool_calls[-1]
            tool_call_id_val = run_id

        await sb._handle_sub_agent_start(event, tool_args, run_id, tool_call_id=tool_call_id_val)
        return

    early_tc = sb._reconcile_early_tool_call(tool_name, run_id, tool_args, namespace)
    if early_tc is not None:
        return

    component_type = infer_component_type(tool_name)
    component_metadata = ComponentMetadata(
        component_type=component_type,
        component_group="main-agent-tools",
    )

    approval_requirement = sb._check_tool_approval_requirement(tool_name, tool_args)

    display_args = sb._humanize_args_for_display(tool_args) if tool_args else {}
    args_struct = Struct()
    if display_args:
        args_struct.update(display_args)

    now = datetime.utcnow()
    initial_status = (
        ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        if approval_requirement.requires_approval
        else ToolCallStatus.TOOL_CALL_RUNNING
    )

    mcp_server_slug = ""
    if sb._approval_config is not None:
        mcp_server_slug = sb._approval_config.get_mcp_server_for_tool(tool_name)

    tool_call = ToolCall(
        id=run_id,
        name=tool_name,
        args=args_struct,
        args_preview=sb._create_args_preview(tool_args),
        result="",
        status=initial_status,
        component_metadata=component_metadata,
        started_at=_utc_timestamp(now),
        mcp_server_slug=mcp_server_slug,
    )

    if approval_requirement.requires_approval:
        rendered_message = render_approval_message(
            template=approval_requirement.message,
            tool_name=tool_name,
            tool_args=tool_args,
        )
        tool_call.requires_approval = True
        tool_call.approval_message = rendered_message
        tool_call.approval_requested_at = _utc_timestamp(now)

    sb.state.tool_start_times[run_id] = now

    context, sub_agent = sb._get_execution_context(namespace)
    ns_key = namespace or ""

    status_name = ToolCallStatus.Name(initial_status)

    parent_ai = sb._ensure_parent_ai_message(ns_key, namespace)
    parent_ai.tool_calls.append(tool_call)
    sb.state.tool_calls[run_id] = parent_ai.tool_calls[-1]

    context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
    sb.logger.debug(
        f"[TOOL] execution={sb.execution_id} {context_desc} "
        f"tool={tool_name} run_id={run_id} status={status_name}"
    )

    if approval_requirement.requires_approval:
        sb._set_waiting_for_approval_phase(tool_name, run_id)


def handle_tool_progress(sb: StatusBuilder, event: dict[str, Any], namespace: str = "") -> None:
    """Handle on_custom_event with name='tool_progress'."""
    run_id = event.get("run_id", "")
    chunk = event.get("data", {}).get("chunk", "")

    if not run_id or not chunk:
        return

    chunk = humanize_sandbox_paths(chunk, sb._workspace_root)

    resolved_id = sb._tool_call_id_capture.resolve(run_id)

    tool_call = sb.get_tool_call(resolved_id)
    if tool_call is None:
        sb.logger.debug(
            f"[TOOL_PROGRESS] execution={sb.execution_id} "
            f"run_id={run_id} resolved_id={resolved_id} "
            f"ignored (tool call not found)"
        )
        return

    was_streaming = tool_call.is_streaming

    current_len = len(tool_call.result)
    if current_len < _MAX_STATUS_RESULT_CHARS:
        remaining = _MAX_STATUS_RESULT_CHARS - current_len
        tool_call.result += chunk[:remaining]
        if len(chunk) > remaining:
            tool_call.result += "\n[output truncated for display]"
    tool_call.is_streaming = True

    if not was_streaming:
        sb.force_next_update = True

    sb.logger.debug(
        f"[TOOL_PROGRESS] execution={sb.execution_id} "
        f"run_id={run_id} resolved_id={resolved_id} "
        f"chunk_len={len(chunk)} total_len={len(tool_call.result)}"
    )


def handle_tool_end(sb: StatusBuilder, event: dict[str, Any], namespace: str = "") -> None:
    """Handle on_tool_end event - updates local status with COMPLETED status."""
    tool_name = event.get("name", "")
    run_id = event.get("run_id", "")
    tool_result_raw = event.get("data", {}).get("output", "")

    if not run_id or tool_name in PLANNING_TOOLS:
        return

    if tool_name == "task":
        sb._handle_sub_agent_end(event, run_id)
        return

    resolved_id = sb._tool_call_id_capture.resolve(run_id)

    tool_result_content = formatting.extract_tool_result_content(tool_result_raw)

    if tool_name in _READ_ONLY_TOOLS:
        persisted_result = f"[content omitted - {len(tool_result_content)} chars]"
    elif len(tool_result_content) > _MAX_STATUS_RESULT_CHARS:
        persisted_result = (
            tool_result_content[:_MAX_STATUS_RESULT_CHARS]
            + "\n[output truncated for display]"
        )
    else:
        persisted_result = tool_result_content

    persisted_result = humanize_sandbox_paths(
        persisted_result, sb._workspace_root,
    )

    now = datetime.utcnow()

    duration_ms = None
    if run_id in sb.state.tool_start_times:
        start_time = sb.state.tool_start_times.pop(run_id)
        duration_ms = int((now - start_time).total_seconds() * 1000)

    context, sub_agent = sb._get_execution_context(namespace)

    completed_at = _utc_timestamp(now)

    tool_call = sb.get_tool_call(resolved_id)
    if tool_call is not None:
        tool_call.result = persisted_result
        tool_call.status = ToolCallStatus.TOOL_CALL_COMPLETED
        tool_call.completed_at = completed_at
        tool_call.is_streaming = False

    context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
    sb.logger.debug(
        f"[TOOL] execution={sb.execution_id} {context_desc} "
        f"tool={tool_name} run_id={run_id} resolved_id={resolved_id} "
        f"status=COMPLETED duration_ms={duration_ms or 'N/A'}"
    )
