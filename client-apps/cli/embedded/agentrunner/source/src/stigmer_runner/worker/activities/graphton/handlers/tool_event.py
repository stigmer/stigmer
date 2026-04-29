"""Tool lifecycle event handlers: on_tool_start, on_tool_end, tool_progress.

All functions receive the ``StatusBuilder`` instance as their first argument.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    TodoStatus,
    ToolCallStatus,
    ToolCallStreamingSource,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import ToolCall
from ai.stigmer.agentic.agentexecution.v1.subagent_pb2 import SubAgentExecution
from ai.stigmer.agentic.agentexecution.v1.todo_pb2 import TodoItem
from google.protobuf.struct_pb2 import Struct
from graphton.core.backends.platform_mount import (
    humanize_platform_refs,
    humanize_sandbox_paths,
    resolve_display_env_vars,
)

from stigmer_runner.worker.activities.graphton.approval_policy import (
    ApprovalRequirement,
    render_approval_message,
    resolve_tool_approval,
)
from stigmer_runner.worker.activities.graphton.handlers import formatting

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder


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
            resolved_id = sb._tool_call_id_capture.resolve(run_id)
            ns_key = namespace or ""
            display_args = humanize_args_for_display(sb, tool_args) if tool_args else {}
            args_struct = Struct()
            if display_args:
                args_struct.update(display_args)
            now = datetime.utcnow()
            tool_call = ToolCall(
                id=resolved_id,
                name=tool_name,
                args=args_struct,
                args_preview=create_args_preview(sb, tool_args),
                result="",
                status=ToolCallStatus.TOOL_CALL_RUNNING,
                started_at=_utc_timestamp(now),
            )
            parent_ai = sb._ensure_parent_ai_message(ns_key, namespace)
            parent_ai.tool_calls.append(tool_call)
            sb.state.tool_calls[resolved_id] = parent_ai.tool_calls[-1]
            if resolved_id != run_id:
                sb._tool_call_id_capture.register_alias(run_id, resolved_id)
            tool_call_id_val = resolved_id

        await sb._handle_sub_agent_start(event, tool_args, run_id, tool_call_id=tool_call_id_val)
        return

    early_tc = sb._reconcile_early_tool_call(tool_name, run_id, tool_args, namespace)
    if early_tc is not None:
        return

    resolved_id = sb._tool_call_id_capture.resolve(run_id)

    if resolved_id == run_id:
        for existing_tc in sb.iter_all_tool_calls():
            if (existing_tc.name == tool_name
                    and existing_tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
                    and existing_tc.status == ToolCallStatus.TOOL_CALL_RUNNING):
                sb._tool_call_id_capture.register_alias(run_id, existing_tc.id)
                sb.logger.info(
                    "[IDENTITY_DEDUP] execution=%s tool=%s run_id=%s -> "
                    "existing_tc=%s (resume phantom guard)",
                    sb.execution_id, tool_name, run_id, existing_tc.id,
                )
                return

    approval_requirement = check_approval_requirement(sb, tool_name, tool_args)

    display_args = humanize_args_for_display(sb, tool_args) if tool_args else {}
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
        id=resolved_id,
        name=tool_name,
        args=args_struct,
        args_preview=create_args_preview(sb, tool_args),
        result="",
        status=initial_status,
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
    sb.state.tool_calls[resolved_id] = parent_ai.tool_calls[-1]
    if resolved_id != run_id:
        sb._tool_call_id_capture.register_alias(run_id, resolved_id)

    context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
    sb.logger.debug(
        f"[TOOL] execution={sb.execution_id} {context_desc} "
        f"tool={tool_name} run_id={run_id} resolved_id={resolved_id} status={status_name}"
    )

    if approval_requirement.requires_approval:
        set_waiting_for_approval_phase(sb, tool_name, run_id)


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
    tool_call.streaming_source = ToolCallStreamingSource.TOOL_CALL_STREAMING_SOURCE_OUTPUT

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
        tool_call.streaming_source = ToolCallStreamingSource.TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED

    context_desc = f"sub_agent={sub_agent.id}" if sub_agent else "main_agent"
    sb.logger.debug(
        f"[TOOL] execution={sb.execution_id} {context_desc} "
        f"tool={tool_name} run_id={run_id} resolved_id={resolved_id} "
        f"status=COMPLETED duration_ms={duration_ms or 'N/A'}"
    )


def check_approval_requirement(
    sb: StatusBuilder,
    tool_name: str,
    tool_args: dict[str, Any],
) -> ApprovalRequirement:
    """Check if a tool requires approval based on the configured policy chain."""
    if sb._approval_config is None:
        return ApprovalRequirement(
            requires_approval=False,
            message="",
            source="none",
        )

    mcp_server_name = sb._approval_config.get_mcp_server_for_tool(tool_name)
    pinned_policies = sb._approval_config.get_pinned_policies_for_tool(tool_name)
    status_policies = sb._approval_config.get_status_policies_for_tool(tool_name)

    return resolve_tool_approval(
        tool_name=tool_name,
        mcp_server_name=mcp_server_name,
        auto_approve_all=sb._approval_config.auto_approve_all,
        tool_approval_overrides=sb._approval_config.tool_approval_overrides,
        pinned_tool_approvals=pinned_policies,
        status_tool_approvals=status_policies,
    )


def set_waiting_for_approval_phase(
    sb: StatusBuilder, tool_name: str, run_id: str,
) -> None:
    """Transition execution phase to WAITING_FOR_APPROVAL."""
    post_approval_statuses = frozenset({
        ToolCallStatus.TOOL_CALL_RUNNING,
        ToolCallStatus.TOOL_CALL_COMPLETED,
        ToolCallStatus.TOOL_CALL_FAILED,
        ToolCallStatus.TOOL_CALL_SKIPPED,
    })
    tc_id = sb._tool_call_id_capture.resolve(run_id)
    existing_tc = sb.get_tool_call(tc_id)
    if existing_tc is not None and existing_tc.status in post_approval_statuses:
        sb.logger.warning(
            "[APPROVAL_GUARD] execution=%s tool=%s tc_id=%s "
            "skipping phase transition — tool call already in "
            "post-approval state %s",
            sb.execution_id, tool_name, tc_id,
            ToolCallStatus.Name(existing_tc.status),
        )
        return

    if sb.state.approval.saved_phase is None:
        sb.state.approval.saved_phase = sb.current_status.phase
        from datetime import datetime as _dt
        sb.state.approval.wait_started_at = _dt.utcnow()
    sb.current_status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL

    sb.state.approval.pending.append(run_id)
    sb.force_next_update = True

    sb.logger.info(
        f"[APPROVAL] execution={sb.execution_id} "
        f"tool={tool_name} run_id={run_id} tc_id={tc_id} "
        f"status=WAITING_APPROVAL "
        f"pending_count={len(sb.state.approval.pending)}"
    )


def update_todos(sb: StatusBuilder, todos_data: list) -> None:
    """Replace the todo snapshot in the local execution status."""
    status_map = {
        "pending": TodoStatus.TODO_PENDING,
        "in_progress": TodoStatus.TODO_IN_PROGRESS,
        "completed": TodoStatus.TODO_COMPLETED,
        "cancelled": TodoStatus.TODO_CANCELLED,
    }

    sb.current_status.todos.clear()

    now = _utc_timestamp()
    for idx, todo_dict in enumerate(todos_data):
        todo_id = todo_dict.get("id") or f"todo-{idx}"
        status_str = todo_dict.get("status", "pending").lower()
        status_enum = status_map.get(status_str, TodoStatus.TODO_PENDING)
        todo_item = TodoItem(
            id=todo_id,
            content=todo_dict.get("content", ""),
            status=status_enum,
            created_at=todo_dict.get("created_at", now),
            updated_at=now,
        )
        sb.current_status.todos[todo_id].CopyFrom(todo_item)

    sb.logger.info("Updated todos: %d item(s) in snapshot", len(todos_data))


def update_sub_agent_todos(
    sb: StatusBuilder, sub_agent: SubAgentExecution, todos_data: list,
) -> None:
    """Replace the todo snapshot on a sub-agent execution."""
    status_map = {
        "pending": TodoStatus.TODO_PENDING,
        "in_progress": TodoStatus.TODO_IN_PROGRESS,
        "completed": TodoStatus.TODO_COMPLETED,
        "cancelled": TodoStatus.TODO_CANCELLED,
    }

    sub_agent.todos.clear()

    now = _utc_timestamp()
    for idx, todo_dict in enumerate(todos_data):
        todo_id = todo_dict.get("id") or f"todo-{idx}"
        status_str = todo_dict.get("status", "pending").lower()
        status_enum = status_map.get(status_str, TodoStatus.TODO_PENDING)
        todo_item = TodoItem(
            id=todo_id,
            content=todo_dict.get("content", ""),
            status=status_enum,
            created_at=todo_dict.get("created_at", now),
            updated_at=now,
        )
        sub_agent.todos[todo_id].CopyFrom(todo_item)

    sb.logger.info(
        "Updated sub-agent todos: %d item(s) (sub_agent_id=%s)",
        len(todos_data), sub_agent.id,
    )


def _humanize_display_string(text: str, sb: StatusBuilder) -> str:
    """Apply the full display humanization pipeline to a string value.

    Pipeline order: platform env refs -> agent env vars -> sandbox paths.
    """
    text = humanize_platform_refs(text)
    text = resolve_display_env_vars(text, sb._display_env_vars, sb._secret_keys)
    text = humanize_sandbox_paths(text, sb._workspace_root)
    return text


def humanize_args_for_display(
    sb: StatusBuilder, tool_args: dict[str, Any],
) -> dict[str, Any]:
    """Return a deep copy of *tool_args* with all string values humanized."""
    if not tool_args:
        return tool_args

    def _humanize_value(value: Any) -> Any:
        if isinstance(value, str):
            return _humanize_display_string(value, sb)
        if isinstance(value, dict):
            return {k: _humanize_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [_humanize_value(v) for v in value]
        return value

    return {k: _humanize_value(v) for k, v in tool_args.items()}


def create_args_preview(sb: StatusBuilder, tool_args: dict[str, Any]) -> str:
    """Create a sanitized preview of tool arguments for UI display."""
    if not tool_args:
        return "{}"

    sensitive_patterns = [
        "password", "passwd", "pwd",
        "token", "api_key", "apikey", "api-key",
        "secret", "credential", "auth",
        "private_key", "privatekey", "private-key",
    ]

    def sanitize_value(key: str, value: Any) -> Any:
        key_lower = key.lower()
        for pattern in sensitive_patterns:
            if pattern in key_lower:
                return "***REDACTED***"
        if isinstance(value, str):
            return _humanize_display_string(value, sb)
        if isinstance(value, dict):
            return {k: sanitize_value(k, v) for k, v in value.items()}
        if isinstance(value, list):
            return [sanitize_value(str(i), v) for i, v in enumerate(value)]
        return value

    sanitized = {k: sanitize_value(k, v) for k, v in tool_args.items()}

    try:
        return json.dumps(sanitized, indent=2, default=str)
    except (TypeError, ValueError):
        return "{}"
