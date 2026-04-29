"""Context info, summarization, artifacts, and workspace write-backs.

These functions manage execution metadata that is set once or updated
infrequently (resolved context, summarization events, artifacts).
All receive the ``StatusBuilder`` instance as their first argument.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact
from ai.stigmer.agentic.agentexecution.v1.context_pb2 import (
    ContextInfo,
    McpServerResolutionStatus,
    ResolvedExecutionContext,
    SummarizationEvent,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import SummarizationSource
from graphton.core.summarization_callback import SummarizationEventData

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder


def _utc_timestamp(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat() + "Z"


def set_resolved_context(
    sb: StatusBuilder,
    environment_keys: list[str],
    mcp_servers: dict[str, tuple[bool, str, int]],
    skill_names: list[str],
    excluded_skill_names: list[str] | None = None,
) -> None:
    """Set the resolved execution context on the status proto."""
    resolved_context = ResolvedExecutionContext(
        environment_keys=sorted(environment_keys),
        skill_names=sorted(skill_names),
        excluded_skill_names=sorted(excluded_skill_names or []),
    )

    for slug, (resolved, message, tool_count) in mcp_servers.items():
        resolved_context.mcp_servers[slug].CopyFrom(
            McpServerResolutionStatus(
                resolved=resolved,
                message=message,
                enabled_tool_count=tool_count,
            )
        )

    sb.current_status.resolved_context.CopyFrom(resolved_context)

    resolved_count = sum(1 for r, _, _ in mcp_servers.values() if r)
    failed_count = len(mcp_servers) - resolved_count

    excluded_count = len(excluded_skill_names) if excluded_skill_names else 0
    sb.logger.info(
        f"[CONTEXT] execution={sb.execution_id} "
        f"env_keys={len(environment_keys)} "
        f"mcp_servers={len(mcp_servers)} (resolved={resolved_count}, failed={failed_count}) "
        f"skills={len(skill_names)} "
        f"excluded_skills={excluded_count}"
    )

    if environment_keys:
        sb.logger.debug(f"[CONTEXT] Environment keys: {sorted(environment_keys)}")
    if mcp_servers:
        for slug, (resolved, message, tool_count) in mcp_servers.items():
            status = "OK" if resolved else "FAILED"
            sb.logger.debug(
                f"[CONTEXT] MCP server '{slug}': {status} - {message} "
                f"(tools={tool_count})"
            )
    if skill_names:
        sb.logger.debug(f"[CONTEXT] Skills: {sorted(skill_names)}")


def initialize_context_info(
    sb: StatusBuilder,
    context_window_limit: int,
    trigger_threshold: int,
    target_tokens: int,
    enabled: bool,
) -> None:
    """Initialize context info from model registry data."""
    sb.state.context_info = ContextInfo(
        context_window_limit=context_window_limit,
        summarization_trigger_threshold=trigger_threshold,
        summarization_target_tokens=target_tokens,
        summarization_enabled=enabled,
        current_token_count=0,
        utilization_percent=0.0,
    )

    sb.logger.info(
        f"[CONTEXT] execution={sb.execution_id} "
        f"context_management initialized: "
        f"window={context_window_limit}, "
        f"trigger={trigger_threshold}, "
        f"target={target_tokens}, "
        f"enabled={enabled}"
    )


def on_summarization_complete(sb: StatusBuilder, event: SummarizationEventData) -> None:
    """Callback from SummarizationMiddleware when summarization completes."""
    if sb.state.context_info is None:
        sb.logger.warning(
            f"[CONTEXT] execution={sb.execution_id} "
            "on_summarization_complete called but context_info not initialized"
        )
        return

    try:
        proto_source = SummarizationSource.Value(event.source)
    except ValueError:
        proto_source = SummarizationSource.SUMMARIZATION_SOURCE_UNSPECIFIED

    timestamp = _utc_timestamp()
    proto_event = SummarizationEvent(
        timestamp=timestamp,
        tokens_before=event.tokens_before,
        tokens_after=event.tokens_after,
        compression_ratio=event.compression_ratio,
        duration_ms=event.duration_ms,
        summarization_model=event.summarization_model,
        messages_before=event.messages_before,
        messages_after=event.messages_after,
        source=proto_source,  # type: ignore[arg-type]
        summarization_input_tokens=event.summarization_input_tokens,
        summarization_output_tokens=event.summarization_output_tokens,
        summarization_cost_usd=event.summarization_cost_usd,
    )
    sb.state.context_info.summarization_events.append(proto_event)

    sb.state.context_info.current_token_count = event.tokens_after
    _update_utilization(sb)
    _sync_context_info(sb)
    sb.force_next_update = True

    sb.logger.info(
        f"[CONTEXT] execution={sb.execution_id} "
        f"summarization completed (source={event.source}): "
        f"{event.tokens_before} -> {event.tokens_after} tokens "
        f"({event.compression_ratio * 100:.1f}% reduction), "
        f"duration={event.duration_ms}ms, "
        f"model={event.summarization_model}, "
        f"summarization_cost=${event.summarization_cost_usd:.6f}"
    )


def on_token_count_updated(sb: StatusBuilder, token_count: int) -> None:
    """Callback from SummarizationMiddleware when token count changes."""
    if sb.state.context_info is None:
        return

    sb.state.context_info.current_token_count = token_count
    _update_utilization(sb)

    sb.logger.debug(
        f"[CONTEXT] execution={sb.execution_id} "
        f"token_count={token_count} "
        f"utilization={sb.state.context_info.utilization_percent:.1f}%"
    )


def _update_utilization(sb: StatusBuilder) -> None:
    """Recalculate utilization percentage based on current token count."""
    if sb.state.context_info is None:
        return

    if sb.state.context_info.context_window_limit > 0:
        sb.state.context_info.utilization_percent = (
            sb.state.context_info.current_token_count
            / sb.state.context_info.context_window_limit
            * 100
        )
    else:
        sb.state.context_info.utilization_percent = 0.0


def _sync_context_info(sb: StatusBuilder) -> None:
    """Copy the working context_info to current_status."""
    if sb.state.context_info is not None:
        sb.current_status.context_info.CopyFrom(sb.state.context_info)


def finalize_context_info(sb: StatusBuilder) -> None:
    """Finalize context info and copy to status proto."""
    if sb.state.context_info is not None:
        _sync_context_info(sb)

        summarization_count = len(
            sb.state.context_info.summarization_events,
        )
        sb.logger.info(
            f"[CONTEXT] execution={sb.execution_id} "
            f"context_info finalized: "
            f"final_tokens={sb.state.context_info.current_token_count}, "
            f"utilization={sb.state.context_info.utilization_percent:.1f}%, "
            f"summarizations={summarization_count}"
        )

    already_synced = {a.sandbox_path for a in sb.current_status.artifacts}
    newly_synced = 0
    for artifact in sb.state.artifacts:
        if artifact.sandbox_path not in already_synced:
            sb.current_status.artifacts.append(artifact)
            newly_synced += 1

    if sb.state.artifacts:
        sb.logger.info(
            f"[ARTIFACTS] execution={sb.execution_id} "
            f"finalized {len(sb.state.artifacts)} artifact(s) "
            f"({newly_synced} newly synced, "
            f"{len(sb.state.artifacts) - newly_synced} already live)"
        )


def add_artifact(sb: StatusBuilder, artifact: ExecutionArtifact) -> None:
    """Add a published artifact and make it immediately visible."""
    existing_paths = {a.sandbox_path for a in sb.state.artifacts}
    if artifact.sandbox_path in existing_paths:
        sb.state.artifacts = [
            a for a in sb.state.artifacts
            if a.sandbox_path != artifact.sandbox_path
        ]
    sb.state.artifacts.append(artifact)

    _sync_artifact_to_status(sb, artifact)
    sb.force_next_update = True

    sb.logger.info(
        f"[ARTIFACT] execution={sb.execution_id} "
        f"name={artifact.name} "
        f"size={artifact.size_bytes} bytes "
        f"path={artifact.sandbox_path}"
    )


def _sync_artifact_to_status(sb: StatusBuilder, artifact: ExecutionArtifact) -> None:
    """Upsert artifact into current_status.artifacts by sandbox_path."""
    status_artifacts = sb.current_status.artifacts
    for idx, existing in enumerate(status_artifacts):
        if existing.sandbox_path == artifact.sandbox_path:
            status_artifacts[idx].CopyFrom(artifact)
            return
    status_artifacts.append(artifact)


def add_workspace_write_back(sb: StatusBuilder, wb: Any) -> None:
    """Register a write-back outcome on the execution status."""
    wbs = sb.current_status.workspace_write_backs
    for idx, existing in enumerate(wbs):
        if existing.workspace_entry_name == wb.workspace_entry_name:
            wbs[idx].CopyFrom(wb)
            sb.force_next_update = True
            return
    wbs.append(wb)
    sb.force_next_update = True

    sb.logger.info(
        f"[WRITE_BACK] execution={sb.execution_id} "
        f"entry={wb.workspace_entry_name} "
        f"phase={wb.phase}"
    )
