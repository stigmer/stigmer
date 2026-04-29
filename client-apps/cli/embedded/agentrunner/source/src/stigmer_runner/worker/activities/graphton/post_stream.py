"""Post-stream processing for Graphton agent execution.

After the LangGraph event stream completes, this module handles:
  - Silent completion detection (final message type check)
  - Auto-publish safety net (file-modifying tool calls -> artifacts)
  - Checkpoint query and validation
  - Phase decision (checkpoint-validated)
  - Finalization (timestamp, usage, gRPC persist)

Extracted from ``execute_graphton.py``.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
from typing import TYPE_CHECKING, Any, cast

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ExecutionPhase,
    MessageType,
)
from langchain_core.runnables import RunnableConfig

from stigmer_runner.worker.activities.graphton.checkpoint_validator import (
    build_error_from_validation,
    validate_against_checkpoint,
)
from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.writeback_coordinator import WriteBackCoordinator
    from stigmer_runner.worker.storage import ArtifactStorage
    from stigmer_runner.worker.workspace import WorkspaceBackend


@dataclasses.dataclass(frozen=True)
class PostStreamResult:
    """Output of :func:`process_post_stream`."""

    final_phase_name: str


async def process_post_stream(
    *,
    status_builder: StatusBuilder,
    execution_id: str,
    agent_graph: Any,
    config: dict[str, Any],
    sandbox: Any,
    artifact_storage: ArtifactStorage,
    workspace_backend: WorkspaceBackend,
    auto_publish_fn: Any,
    pending_publish_tasks: set[asyncio.Task[None]] | None = None,
    writeback_coordinator: WriteBackCoordinator | None = None,
    pending_git_tasks: set[asyncio.Task[None]] | None = None,
    logger: logging.Logger,
    **_kwargs: Any,
) -> PostStreamResult:
    """Run post-stream validation, interrupt capture, and phase decision.

    Mutates ``status_builder.current_status`` in place.
    """
    # Detect silent completions
    messages = status_builder.current_status.messages
    if messages:
        last_message = messages[-1]
        if last_message.type == MessageType.MESSAGE_TOOL:
            logger.warning(
                "[POST_STREAM] execution=%s — Stream ended with a tool "
                "message as the last message (tool_calls=%d). "
                "The agent may not have produced a final summary.",
                execution_id, len(last_message.tool_calls),
            )

    # Drain in-flight inline publish tasks so their artifacts are
    # available before the safety net decides what still needs publishing.
    if pending_publish_tasks:
        logger.info(
            "[POST_STREAM] execution=%s — awaiting %d in-flight "
            "inline publish task(s)",
            execution_id, len(pending_publish_tasks),
        )
        done, _pending = await asyncio.wait(
            pending_publish_tasks, timeout=10.0,
        )
        for t in done:
            try:
                exc = t.exception()
            except asyncio.CancelledError:
                exc = None
            if exc is not None:
                logger.warning(
                    "[POST_STREAM] execution=%s — inline publish task "
                    "failed: %s", execution_id, exc,
                )

    # Auto-publish safety net: publishes artifacts for any completed
    # file-modifying tool calls that were not already published inline.
    # Runs unconditionally regardless of execution phase because:
    #   - It only operates on TOOL_CALL_COMPLETED tool calls
    #   - Dedup via already_published_paths prevents redundant uploads
    #   - For WAITING_FOR_APPROVAL / PAUSED, the write tool already
    #     completed and on_tool_end will NOT fire again on resume
    #   - For FAILED, completed writes are still valid user artifacts
    already_published = {
        a.sandbox_path for a in status_builder.current_status.artifacts
    }
    try:
        await auto_publish_fn(
            tool_calls=list(status_builder.iter_all_tool_calls()),
            sandbox=sandbox,
            storage=artifact_storage,
            execution_id=execution_id,
            status_builder=status_builder,
            local_root=(
                workspace_backend.root_dir if sandbox is None else None
            ),
            logger=logger,
            path_normalizer=(
                workspace_backend._normalize
                if hasattr(workspace_backend, "_normalize")
                else None
            ),
            already_published_paths=already_published,
        )
    except Exception as auto_pub_err:
        logger.warning(
            "[AUTO_PUBLISH] execution=%s — "
            "auto-publish failed (non-fatal): %s",
            execution_id, auto_pub_err,
        )

    # Drain in-flight git write-back tasks before the safety-net finalize
    if pending_git_tasks:
        logger.info(
            "[POST_STREAM] execution=%s — awaiting %d in-flight "
            "git write-back task(s)",
            execution_id, len(pending_git_tasks),
        )
        done, _pending = await asyncio.wait(
            pending_git_tasks, timeout=120.0,
        )
        for t in done:
            try:
                exc = t.exception()
            except asyncio.CancelledError:
                exc = None
            if exc is not None:
                logger.warning(
                    "[POST_STREAM] execution=%s — git write-back task "
                    "failed: %s", execution_id, exc,
                )

    # Git write-back safety net: catch any remaining uncommitted changes
    # (e.g., files modified by shell commands not tracked by the
    # incremental hook).
    if writeback_coordinator is not None:
        try:
            await writeback_coordinator.finalize()
            logger.info(
                "[POST_STREAM] execution=%s — write-back finalize completed",
                execution_id,
            )
        except Exception as wb_err:
            logger.warning(
                "[POST_STREAM] execution=%s — write-back finalize "
                "failed (non-fatal): %s",
                execution_id, wb_err,
            )

    status_builder.finalize_context_info()

    # Checkpoint query
    graph_state = None
    try:
        graph_state = await agent_graph.aget_state(
            cast(RunnableConfig, config)
        )
    except Exception as state_err:
        logger.warning(
            "[CHECKPOINT_QUERY] execution=%s — "
            "aget_state() failed (non-fatal, validation skipped): %s",
            execution_id, state_err,
        )

    # Checkpoint validation
    status_ai_message_count = sum(
        1
        for m in status_builder.current_status.messages
        if m.type == MessageType.MESSAGE_AI
    )

    validation = validate_against_checkpoint(
        graph_state=graph_state,
        active_sub_agent_count=status_builder.active_sub_agent_count,
        status_ai_message_count=status_ai_message_count,
        execution_phase=status_builder.current_status.phase,
        waiting_for_approval_phase=ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        paused_phase=ExecutionPhase.EXECUTION_PAUSED,
    )

    for d in validation.discrepancies:
        log_fn = logger.error if d.severity == "error" else logger.warning
        log_fn(
            "[CHECKPOINT_VALIDATION] execution=%s %s: %s",
            execution_id, d.category, d.description,
        )

    if not validation.discrepancies:
        logger.info(
            "[CHECKPOINT_VALIDATION] execution=%s — all checks passed",
            execution_id,
        )

    # Phase decision
    current_phase = status_builder.current_status.phase

    if current_phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
        logger.info(
            "Stream ended with WAITING_FOR_APPROVAL phase for execution %s. "
            "Not setting COMPLETED. pending_approvals is computed server-side "
            "by Go/Java ComputePendingApprovals on UpdateStatus.",
            execution_id,
        )
    elif current_phase == ExecutionPhase.EXECUTION_PAUSED:
        logger.info(
            "Stream ended with PAUSED phase for execution %s. "
            "Not setting COMPLETED.",
            execution_id,
        )
    elif validation.has_errors:
        logger.error(
            "[CHECKPOINT_VALIDATION] execution=%s — "
            "Checkpoint confirms abnormal termination. Errors: %s",
            execution_id,
            [d.description for d in validation.discrepancies if d.severity == "error"],
        )
        finalized_count = (
            status_builder.finalize_sub_agents_from_checkpoint_validation(
                missed_event_count=validation.missed_event_count,
                confirmed_orphan_count=validation.confirmed_orphan_count,
                error_context="Checkpoint validation: execution terminated abnormally",
            )
        )
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
        status_builder.current_status.error = build_error_from_validation(validation)
        logger.info(
            "[CHECKPOINT_VALIDATION] execution=%s — "
            "Finalized %d sub-agent(s), phase set to EXECUTION_FAILED.",
            execution_id, finalized_count,
        )
    elif validation.missed_event_count > 0:
        logger.info(
            "[CHECKPOINT_VALIDATION] execution=%s — "
            "Checkpoint confirms %d sub-agent(s) completed "
            "(StatusBuilder missed events). Execution completed normally.",
            execution_id, validation.missed_event_count,
        )
        status_builder.finalize_sub_agents_from_checkpoint_validation(
            missed_event_count=validation.missed_event_count,
            confirmed_orphan_count=0,
            error_context="",
        )
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED
    elif status_builder.has_orphaned_sub_agents:
        diag = status_builder.get_orphaned_sub_agents_diagnostic()
        logger.error(
            "[RECONCILIATION] execution=%s — "
            "Checkpoint validation found no errors but StatusBuilder "
            "still tracks %d active sub-agent(s). Details: %s",
            execution_id, diag["total"], diag,
        )
        status_builder.finalize_active_sub_agents_differentiated(
            error_context="Parent execution terminated abnormally"
        )
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
        status_builder.current_status.error = (
            f"Execution terminated with {diag['total']} sub-agent(s) "
            f"still in progress "
            f"({diag['zero_message_count']} never started, "
            f"{diag['mid_execution_count']} mid-execution). "
            f"The graph ended without producing a final response."
        )
    else:
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED

    if not status_builder.current_status.completed_at:
        status_builder.current_status.completed_at = _utc_timestamp()

    return PostStreamResult(
        final_phase_name=ExecutionPhase.Name(status_builder.current_status.phase),
    )
