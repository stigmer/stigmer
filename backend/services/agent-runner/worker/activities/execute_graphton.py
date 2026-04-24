"""Temporal activity for executing Graphton agents."""

import contextlib
import logging
import os
import traceback
from datetime import UTC, datetime
from typing import cast

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ExecutionPhase,
    MessageType,
    SubAgentStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import (
    ApprovalDecisionList,
    SubmitApprovalInput,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import AgentMessage
from temporalio import activity

from grpc_client.agent_execution_client import AgentExecutionClient
from grpc_client.channel import ChannelProvider
from worker import execution_tracker

# ─── Re-exports for backward compatibility with test imports ─────────────
from worker.activities.graphton.attachments import (
    _MAX_ZIP_EXTRACTED_SIZE,  # noqa: F401 — re-exported for tests
    _MAX_ZIP_FILES,  # noqa: F401 — re-exported for tests
    _validate_zip_for_extraction,  # noqa: F401 — re-exported for tests
    inject_attachments,  # noqa: F401 — re-exported for tests
)
from worker.activities.graphton.attachments import (
    auto_publish_written_files as _auto_publish_written_files,  # noqa: F401
)
from worker.activities.graphton.hitl import (
    ResumeReconciler,  # noqa: F401 — re-exported for tests
    _build_decision_value,  # noqa: F401 — re-exported for tests
    _summarize_resume_entry,  # noqa: F401 — re-exported for tests
    extract_interrupt_tool_call_ids,  # noqa: F401 — re-exported for tests
    resolve_resume_input,
)
from worker.activities.graphton.prompt_builder import (
    _format_entry_description,  # noqa: F401 — re-exported for tests
    build_referenced_files_prompt_section,  # noqa: F401 — re-exported for tests
    build_workspace_prompt_section,  # noqa: F401 — re-exported for tests
    enhance_system_prompt,  # noqa: F401 — re-exported for tests
)

# Sentinel re-exported from setup.py for any code that references it here.
from worker.activities.graphton.setup import (  # noqa: F401
    _LANGGRAPH_UNLIMITED_RECURSION,
    SetupResult,
    perform_setup,
)
from worker.activities.graphton.status_builder import (
    StatusBuilder,  # noqa: F401 — re-exported for backward compat
    _utc_timestamp,
)
from worker.activities.graphton.temporal_helpers import (  # noqa: F401
    SetupTimer,
    heartbeat_during_setup,
    report_setup_progress,
)
from worker.activities.graphton.temporal_helpers import (
    run_sync_with_heartbeat as _run_sync_with_heartbeat,  # noqa: F401
)
from worker.activities.graphton.temporal_helpers import (
    slim_status_for_temporal as _slim_status_for_temporal,
)
from worker.auth import get_token
from worker.resilience import (
    GrpcNonRetryableError,
    GrpcRetryExecutor,
    GrpcRetryExhaustedError,
    RetryConfig,
)
from worker.storage import (  # noqa: F401 — ArtifactStorage re-exported for tests
    ArtifactStorage,
    create_artifact_storage,
)
from worker.streaming import (  # noqa: F401 — StreamingUpdateScheduler re-exported for tests
    StreamingConfig,
    StreamingUpdateScheduler,
)
from worker.workspace import (
    WorkspaceBackend,  # noqa: F401 — re-exported for tests
)


async def _persist_and_return_failed_status(
    *,
    failed_status: AgentExecutionStatus,
    execution_id: str,
    execution_client: AgentExecutionClient | None,
    retry_executor: GrpcRetryExecutor | None,
    logger: logging.Logger,
) -> AgentExecutionStatus:
    """Persist a failed execution status via gRPC (best effort) and return
    the slim version suitable for Temporal workflow return values.

    When *retry_executor* is provided the update uses exponential-backoff
    retry; otherwise a single best-effort call is made.  All gRPC errors
    are logged and swallowed — the caller always receives the slim status
    so the Temporal workflow can proceed.
    """
    if execution_client is not None:
        try:
            if retry_executor is not None:
                await retry_executor.execute(
                    operation=lambda: execution_client.update_status(
                        execution_id=execution_id,
                        status=failed_status,
                    ),
                    operation_name="failed_status_update",
                    context={"execution_id": execution_id, "phase": "FAILED"},
                )
            else:
                await execution_client.update_status(execution_id, failed_status)
            logger.info(
                "Failed status update sent successfully for %s", execution_id,
            )
        except GrpcRetryExhaustedError as e:
            logger.error(
                "[FINAL] All retries exhausted for failed status update: "
                "%d attempts, %.0fms total. Last error: %s",
                e.attempts, e.total_duration_ms, e.last_error,
            )
        except GrpcNonRetryableError as e:
            logger.error(
                "[FINAL] Non-retryable error on failed status update: "
                "%s - %s",
                e.status_code.name, e.original_error,
            )
        except Exception as e:
            logger.error(
                "[FINAL] Unexpected error on failed status update: %s", e,
            )
    return _slim_status_for_temporal(failed_status)


@activity.defn(name="ExecuteGraphton")
async def execute_graphton(
    execution_id: str,
    thread_id: str,
    approval_decisions_wrapper: ApprovalDecisionList | None = None,
    invoker_identity_account_id: str | None = None,
) -> AgentExecutionStatus:
    """
    Execute Graphton agent and return final status.

    Slim-Payload Pattern:
    The activity receives only an execution_id (not the full AgentExecution proto)
    and hydrates the execution from the database via gRPC.  This keeps Temporal
    activity payloads small and bounded, avoiding the ~2 MB payload limit that
    can be hit when status.tool_calls / status.messages accumulate.

    Polyglot Workflow Pattern:
    1. Fetches AgentExecution via gRPC get(execution_id)
    2. Fetches Agent configuration via gRPC chain resolution
    3. Creates Graphton agent at runtime
    4. Creates/reuses Daytona sandbox
    5. Executes agent and builds status locally
    6. Returns final status to workflow

    Args:
        execution_id: The AgentExecution ID to fetch and execute
        thread_id: LangGraph thread ID for state persistence
        approval_decisions_wrapper: Approval decisions wrapped in ApprovalDecisionList
            for polyglot Temporal serialization (None on first invocation).
            Each entry carries a tool_call_id, action (APPROVE/SKIP/REJECT), and
            optional comment.  The activity queries the LangGraph checkpoint to
            match decisions to interrupts and build the Command(resume=...) dict.
        invoker_identity_account_id: Identity account ID of the user who triggered
            the execution. Used by the runner for on-behalf-of gRPC impersonation
            (x-on-behalf-of header). None for backward compatibility.

    Returns:
        AgentExecutionStatus: Final status with messages, tool_calls, phase
    """
    activity_logger = cast(logging.Logger, activity.logger)
    activity_logger.info(f"ExecuteGraphton started for execution: {execution_id}")

    # Unwrap ApprovalDecisionList → list[SubmitApprovalInput].
    if approval_decisions_wrapper is not None and approval_decisions_wrapper.decisions:
        approval_decisions: list[SubmitApprovalInput] = list(
            approval_decisions_wrapper.decisions
        )
    else:
        approval_decisions = []

    execution_tracker.increment()
    try:
        return await _execute_graphton_impl(
            execution_id, thread_id, approval_decisions, activity_logger,
            invoker_identity_account_id,
        )
    except Exception as system_error:
        exc_type = type(system_error).__name__
        activity_logger.error(
            "SYSTEM ERROR in ExecuteGraphton for %s: [%s] %s\n%s",
            execution_id, exc_type, system_error, traceback.format_exc(),
        )

        failed_status = AgentExecutionStatus(
            phase=ExecutionPhase.EXECUTION_FAILED,
            error=f"System error: [{exc_type}] {system_error}",
            messages=[
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content="Internal system error occurred. "
                    "Please contact support if this issue persists.",
                    timestamp=_utc_timestamp(),
                ),
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content=f"Error details: [{exc_type}] {system_error}",
                    timestamp=_utc_timestamp(),
                ),
            ],
        )

        best_effort_client: AgentExecutionClient | None = None
        with contextlib.suppress(Exception):
            token = get_token()
            if token:
                best_effort_client = AgentExecutionClient(token)

        return await _persist_and_return_failed_status(
            failed_status=failed_status,
            execution_id=execution_id,
            execution_client=best_effort_client,
            retry_executor=None,
            logger=activity_logger,
        )
    finally:
        execution_tracker.decrement()


async def _execute_graphton_impl(
    execution_id: str,
    thread_id: str,
    approval_decisions: list[SubmitApprovalInput],
    activity_logger: logging.Logger,
    invoker_identity_account_id: str | None = None,
) -> AgentExecutionStatus:
    """Internal implementation of execute_graphton.

    Phases:
      1. Crash recovery (heartbeat-based thread_id override)
      2. Setup (delegated to ``perform_setup``)
      3. HITL resume resolution
      4. Streaming (delegated to ``StreamExecutor``)
      5. Post-stream processing (delegated to ``process_post_stream``)
      6. Final status persistence
    """
    # ─────────────────────────────────────────────────────────────────────
    # Phase 1: Crash recovery — detect Temporal retry and resume from
    # checkpoint via heartbeat-stored thread_id.
    # ─────────────────────────────────────────────────────────────────────
    attempt = activity.info().attempt
    heartbeat_details = activity.info().heartbeat_details
    is_retry = attempt > 1 and heartbeat_details is not None

    if is_retry:
        try:
            last_heartbeat = (
                heartbeat_details[0]
                if isinstance(heartbeat_details, (list, tuple))
                else heartbeat_details
            )
            if isinstance(last_heartbeat, dict) and "thread_id" in last_heartbeat:
                resume_thread_id = last_heartbeat["thread_id"]
                activity_logger.info(
                    "RETRY DETECTED: attempt=%d, resuming from checkpoint "
                    "with thread_id=%s (original thread_id=%s)",
                    attempt, resume_thread_id, thread_id,
                )
                thread_id = resume_thread_id
            else:
                activity_logger.warning(
                    "RETRY DETECTED: attempt=%d, but heartbeat missing "
                    "thread_id. Heartbeat data: %s. Using provided "
                    "thread_id=%s",
                    attempt, last_heartbeat, thread_id,
                )
        except Exception as e:
            activity_logger.warning(
                "RETRY DETECTED: attempt=%d, failed to extract thread_id "
                "from heartbeat: %s. Using provided thread_id=%s",
                attempt, e, thread_id,
            )
    else:
        activity_logger.info(
            "First attempt (attempt=%d): using thread_id=%s",
            attempt, thread_id,
        )

    is_resume = bool(approval_decisions)
    if is_resume:
        activity_logger.info("=" * 80)
        activity_logger.info(
            "[RESUME] ExecuteGraphton re-invoked after approval for "
            "execution=%s, thread_id=%s, "
            "decisions=%d (Temporal args), attempt=%d",
            execution_id, thread_id,
            len(approval_decisions), attempt,
        )
        activity_logger.info("=" * 80)

    # ─────────────────────────────────────────────────────────────────────
    # Pre-setup: resources that must be accessible in the error handler
    # and finally block regardless of whether setup completes.
    # ─────────────────────────────────────────────────────────────────────
    token = get_token()
    if not token:
        raise RuntimeError("Auth token not initialized")

    grpc_provider = ChannelProvider(token)
    execution_client = AgentExecutionClient(
        token, channel=grpc_provider.channel,
    )
    retry_executor = GrpcRetryExecutor(RetryConfig.load_from_env())
    exit_stack = contextlib.AsyncExitStack()

    setup: SetupResult | None = None
    try:
        # ─────────────────────────────────────────────────────────────────
        # Phase 2: Setup — hydrate execution, resolve chain, provision
        # workspace, load skills / MCP / env, create agent graph.
        # ─────────────────────────────────────────────────────────────────
        setup = await perform_setup(
            execution_id=execution_id,
            thread_id=thread_id,
            is_resume=is_resume,
            token=token,
            grpc_provider=grpc_provider,
            execution_client=execution_client,
            retry_executor=retry_executor,
            exit_stack=exit_stack,
            logger=activity_logger,
        )

        # ─────────────────────────────────────────────────────────────────
        # Phase 3: HITL resume resolution
        # ─────────────────────────────────────────────────────────────────
        resume = await resolve_resume_input(
            approval_decisions=approval_decisions,
            agent_graph=setup.agent_graph,
            config=setup.config,
            execution=setup.execution,
            status_builder=setup.status_builder,
            execution_client=execution_client,
            execution_id=execution_id,
            langgraph_input=setup.langgraph_input,
            logger=activity_logger,
        )
        if resume.terminal_status is not None:
            return resume.terminal_status

        # ─────────────────────────────────────────────────────────────────
        # Phase 4: Stream execution
        # ─────────────────────────────────────────────────────────────────
        setup.status_builder.current_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        setup.status_builder.current_status.started_at = (
            datetime.now(UTC).isoformat().replace("+00:00", "Z")
        )
        activity_logger.info(
            "Execution %s phase set to IN_PROGRESS (building locally)",
            execution_id,
        )

        streaming_config = StreamingConfig.load_from_env()
        grpc_update_timeout_seconds = int(
            os.environ.get("GRAPHTON_GRPC_UPDATE_TIMEOUT_SECONDS", 10)
        )
        stall_timeout_seconds = int(
            os.environ.get("GRAPHTON_STALL_TIMEOUT_SECONDS", 300)
        )

        if not resume.is_resume_from_approval:
            activity_logger.info(
                "Starting Graphton agent stream for execution %s "
                "(streaming: min_interval=%dms, max_interval=%dms, "
                "burst_threshold=%d)",
                execution_id,
                streaming_config.min_interval_ms,
                streaming_config.max_interval_ms,
                streaming_config.burst_threshold,
            )

        from worker.activities.graphton.streaming import StreamExecutor
        stream_executor = StreamExecutor(
            agent_graph=setup.agent_graph,
            config=setup.config,
            execution_id=execution_id,
            thread_id=thread_id,
            status_builder=setup.status_builder,
            execution_client=execution_client,
            streaming_config=streaming_config,
            stall_timeout_seconds=stall_timeout_seconds,
            grpc_update_timeout_seconds=grpc_update_timeout_seconds,
            effective_recursion_limit=setup.effective_recursion_limit,
            heartbeat_fn=activity.heartbeat,
            is_cancelled_fn=activity.is_cancelled,
            slim_status_fn=_slim_status_for_temporal,
            logger=activity_logger,
            on_file_written=setup.inline_publisher.publish,
            on_git_file_modified=(
                setup.writeback_coordinator.on_file_modified
                if setup.writeback_coordinator is not None
                else None
            ),
        )
        stream_result = await stream_executor.execute(
            resume.graph_input, is_resume=resume.is_resume_from_approval,
        )

        # ─────────────────────────────────────────────────────────────────
        # Phase 5: Handle terminal status or post-stream processing
        # ─────────────────────────────────────────────────────────────────
        if stream_result.terminal_status is not None:
            terminal_phase = setup.status_builder.current_status.phase
            try:
                activity_logger.info(
                    "Sending terminal status update with retry (phase=%s)",
                    ExecutionPhase.Name(terminal_phase),
                )
                await retry_executor.execute(
                    operation=lambda: execution_client.update_status(
                        execution_id=execution_id,
                        status=setup.status_builder.current_status,
                    ),
                    operation_name="terminal_status_update",
                    context={
                        "execution_id": execution_id,
                        "phase": ExecutionPhase.Name(terminal_phase),
                    },
                )
            except GrpcRetryExhaustedError as e:
                activity_logger.error(
                    "Terminal status persistence failed after retries: %s", e,
                )
            except Exception as e:
                activity_logger.error(
                    "Unexpected error persisting terminal status: %s", e,
                )
            return stream_result.terminal_status

        from graphton.core.backends.platform_mount import (
            humanize_platform_refs,
            resolve_display_env_vars,
        )

        from worker.activities.graphton.approval_policy import (
            resolve_platform_tool_name,
        )
        from worker.activities.graphton.post_stream import process_post_stream

        post_result = await process_post_stream(
            status_builder=setup.status_builder,
            execution_id=execution_id,
            agent_graph=setup.agent_graph,
            config=setup.config,
            sandbox=setup.sandbox,
            artifact_storage=setup.artifact_storage,
            workspace_backend=setup.workspace_backend,
            merged_env_vars=setup.merged_env_vars,
            secret_keys=setup.secret_keys,
            auto_publish_fn=_auto_publish_written_files,
            pending_publish_tasks=stream_executor.pending_publish_tasks,
            writeback_coordinator=setup.writeback_coordinator,
            pending_git_tasks=stream_executor.pending_git_tasks,
            resolve_platform_tool_name=resolve_platform_tool_name,
            humanize_platform_refs=humanize_platform_refs,
            resolve_display_env_vars=resolve_display_env_vars,
            logger=activity_logger,
        )
        final_phase_name = post_result.final_phase_name

        # ─────────────────────────────────────────────────────────────────
        # Phase 6: Final status persistence
        # ─────────────────────────────────────────────────────────────────
        try:
            activity_logger.info(
                "[FINAL] Sending %s status update with retry",
                final_phase_name,
            )
            await retry_executor.execute(
                operation=lambda: execution_client.update_status(
                    execution_id=execution_id,
                    status=setup.status_builder.current_status,
                ),
                operation_name="final_status_update",
                context={
                    "execution_id": execution_id,
                    "phase": final_phase_name,
                },
            )
            activity_logger.info(
                "[FINAL] Status update sent successfully (phase=%s)",
                final_phase_name,
            )
        except GrpcRetryExhaustedError as e:
            activity_logger.error(
                "[FINAL] All retries exhausted for status update: "
                "%d attempts, %.0fms total. Last error: %s",
                e.attempts, e.total_duration_ms, e.last_error,
            )
        except GrpcNonRetryableError as e:
            activity_logger.error(
                "[FINAL] Non-retryable error on status update: "
                "%s - %s",
                e.status_code.name, e.original_error,
            )
        except Exception as e:
            activity_logger.error(
                "[FINAL] Unexpected error on status update: %s", e,
            )

        activity_logger.info("=" * 80)
        activity_logger.info(
            "[FINAL_STATUS] Execution %s:", execution_id,
        )
        activity_logger.info(
            "   messages: %d",
            len(setup.status_builder.current_status.messages),
        )
        activity_logger.info(
            "   tool_calls: %d",
            setup.status_builder.tool_call_count(),
        )
        activity_logger.info(
            "   sub_agent_executions: %d",
            len(setup.status_builder.current_status.sub_agent_executions),
        )
        activity_logger.info(
            "   todos: %d",
            len(setup.status_builder.current_status.todos),
        )
        activity_logger.info(
            "   artifacts: %d",
            len(setup.status_builder.current_status.artifacts),
        )
        activity_logger.info(
            "   phase: %s",
            ExecutionPhase.Name(setup.status_builder.current_status.phase),
        )
        activity_logger.info("=" * 80)

        activity_logger.info(
            "ExecuteGraphton completed - returning slim status to workflow"
        )

        return _slim_status_for_temporal(setup.status_builder.current_status)

    except Exception as e:
        exc_type = type(e).__name__
        activity_logger.error(
            "ExecuteGraphton failed for execution %s: [%s] %s\n%s",
            execution_id, exc_type, e, traceback.format_exc(),
        )

        error_message = f"Execution failed: [{exc_type}] {e}"
        fail_system_msg = AgentMessage(
            type=MessageType.MESSAGE_SYSTEM,
            content=f"Error: {error_message}",
            timestamp=_utc_timestamp(),
        )

        status_builder = setup.status_builder if setup is not None else None

        if status_builder is not None:
            status_builder.finalize_active_sub_agents(
                SubAgentStatus.SUB_AGENT_FAILED,
                f"Parent execution failed: {error_message}",
            )
            status_builder.current_status.messages.append(fail_system_msg)
            status_builder.finalize_context_info()
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
            status_builder.current_status.error = error_message
            if not status_builder.current_status.completed_at:
                status_builder.current_status.completed_at = _utc_timestamp()
            failed_status = status_builder.current_status
        else:
            activity_logger.warning(
                "status_builder not initialized — creating minimal failed "
                "status for %s", execution_id,
            )
            failed_status = AgentExecutionStatus(
                phase=ExecutionPhase.EXECUTION_FAILED,
                error=error_message,
                messages=[
                    fail_system_msg,
                    AgentMessage(
                        type=MessageType.MESSAGE_SYSTEM,
                        content="Execution failed during initialization "
                        "before agent could start.",
                        timestamp=_utc_timestamp(),
                    ),
                ],
            )

        return await _persist_and_return_failed_status(
            failed_status=failed_status,
            execution_id=execution_id,
            execution_client=execution_client,
            retry_executor=retry_executor,
            logger=activity_logger,
        )

    finally:
        if setup is not None:
            mcp_mw = getattr(
                setup.agent_graph, "_graphton_mcp_middleware", None,
            )
            if mcp_mw is not None:
                with contextlib.suppress(Exception):
                    await mcp_mw._exit_stack.aclose()

            if setup.workspace_backend is not None:
                setup.workspace_backend.close()

        await exit_stack.aclose()
        await grpc_provider.close()
