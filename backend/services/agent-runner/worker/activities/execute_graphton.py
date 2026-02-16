"""Temporal activity for executing Graphton agents."""

import asyncio
import contextlib
import os
import time
import traceback
from pathlib import Path
from typing import Any

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import (
    AgentExecution,
    AgentExecutionStatus,
    ApprovalAction,
    PendingApproval,
)
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ExecutionPhase,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import (
    ApprovalDecisionList,
    SubmitApprovalInput,
)
from graphton import SummarizationConfig, create_deep_agent
from graphton.core import ModelRegistry
from temporalio import activity

from grpc_client.agent_client import AgentClient
from grpc_client.agent_execution_client import AgentExecutionClient
from grpc_client.agent_instance_client import AgentInstanceClient
from grpc_client.environment_client import EnvironmentClient
from grpc_client.execution_context_client import (
    ExecutionContextClient,
)
from grpc_client.mcp_server_client import McpServerClient
from grpc_client.session_client import SessionClient
from grpc_client.skill_client import SkillClient
from worker.activities.graphton.approval_policy import (
    build_approval_config,
    create_approval_checker,
    resolve_platform_tool_name,
)
from worker.activities.graphton.skill_writer import SkillWriter
from worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp
from worker.activities.graphton.subagent_transformer import transform_sub_agents
from worker.checkpointer import create_checkpointer
from worker.mcp import transform_all_mcp_configs
from worker.resilience import (
    GrpcNonRetryableError,
    GrpcRetryExecutor,
    GrpcRetryExhaustedError,
    RetryConfig,
)
from worker.sandbox_manager import (
    DAYTONA_WORKSPACE_MOUNT_PATH,
    SandboxManager,
    get_daytona_volume_id,
)
from worker.storage import ArtifactStorage, create_artifact_storage
from worker.streaming import StreamingConfig, StreamingUpdateScheduler
from worker.token_manager import get_api_key
from worker.tools import publish_artifact


class SetupTimer:
    """Lightweight timer for measuring and logging setup phase durations.
    
    Tracks cumulative time across all setup phases and logs each phase's
    duration. Designed for diagnosing slow activity startup, especially on
    the resume-after-approval path where full setup re-execution is costly.
    
    Usage::
    
        timer = SetupTimer(logger)
        timer.start("chain_resolution")
        # ... do work ...
        timer.stop()  # logs duration
        timer.log_total()  # logs cumulative time
    """

    def __init__(self, logger) -> None:
        self._logger = logger
        self._phases: list[tuple[str, float]] = []  # (phase_name, duration_ms)
        self._current_phase: str | None = None
        self._phase_start: float = 0.0
        self._overall_start: float = time.monotonic()

    def start(self, phase_name: str) -> None:
        """Begin timing a setup phase. Stops the previous phase if still running."""
        if self._current_phase is not None:
            self.stop()
        self._current_phase = phase_name
        self._phase_start = time.monotonic()

    def stop(self) -> float:
        """Stop the current phase, log its duration, and return elapsed ms."""
        if self._current_phase is None:
            return 0.0
        elapsed_ms = (time.monotonic() - self._phase_start) * 1000
        self._phases.append((self._current_phase, elapsed_ms))
        self._logger.info(
            f"[SETUP] {self._current_phase} completed in {elapsed_ms:.0f}ms"
        )
        self._current_phase = None
        return elapsed_ms

    def log_total(self) -> None:
        """Log cumulative setup time and per-phase breakdown."""
        total_ms = (time.monotonic() - self._overall_start) * 1000
        breakdown = ", ".join(
            f"{name}={dur:.0f}ms" for name, dur in self._phases
        )
        self._logger.info(
            f"[SETUP] Total setup completed in {total_ms:.0f}ms — "
            f"phases: [{breakdown}]"
        )


def heartbeat_during_setup(phase_name: str, details: dict | None = None) -> None:
    """Send heartbeat with setup phase info to prevent timeout during initialization.
    
    The ExecuteGraphton activity has a 30-second heartbeat timeout. Without heartbeats
    during the setup phase (Steps 1-8), long-running operations like gRPC calls,
    skill fetching, or attachment downloads can cause Temporal to mark the activity
    as failed.
    
    Args:
        phase_name: Human-readable name of the current setup phase (e.g., "chain_resolution")
        details: Optional dict with additional context (e.g., counts, IDs)
    """
    activity.heartbeat({
        "setup_phase": phase_name,
        "details": details or {},
    })


def _check_workspace_file_exists(
    sandbox,
    local_root: str | None,
    workspace_root: str | None,
    path: str,
    logger,
) -> bool:
    """Check whether a workspace-relative file exists in the sandbox.

    Used as a lightweight sentinel check on the resume fast-path to verify
    that the persistent volume is mounted and prior files are intact.
    Returns ``True`` when the file is confirmed present, ``False`` on any
    error or absence.

    Cloud mode:
        Runs ``test -f <absolute_path>`` inside the sandbox via
        ``sandbox.process.exec`` — the same mechanism used for sandbox
        health checks.

    Local mode:
        Uses ``Path.exists()`` on the local filesystem.

    If neither *sandbox* nor *local_root* is available, returns ``True``
    (vacuously — there is nothing to check against).
    """
    if local_root:
        full_path = Path(local_root) / path
        exists = full_path.exists()
        if not exists:
            logger.warning(
                "[workspace-check] Sentinel file missing on local filesystem: %s",
                full_path,
            )
        return exists

    if sandbox is not None:
        abs_path = f"{workspace_root.rstrip('/')}/{path}" if workspace_root else f"/{path}"
        try:
            result = sandbox.process.exec(f"test -f {abs_path}", timeout=5)
            if result.exit_code != 0:
                logger.warning(
                    "[workspace-check] Sentinel file missing in sandbox: %s "
                    "(exit_code=%d)",
                    abs_path,
                    result.exit_code,
                )
            return result.exit_code == 0
        except Exception as exc:
            logger.warning(
                "[workspace-check] File existence check failed: %s", exc,
            )
            return False

    # Neither sandbox nor local_root — nothing to check against.
    return True


async def inject_attachments(
    sandbox,
    attachments: list,
    storage: ArtifactStorage,
    logger,
    local_root: str | None = None,
    workspace_root: str | None = None,
) -> list[dict]:
    """Inject attachments into sandbox at their mount_path.
    
    All attachments must have a storage_key. The content is downloaded from
    artifact storage and injected into the sandbox. Supports both local
    filesystem and Daytona sandbox modes.
    
    Path convention (aligned with SkillWriter):
    - Workspace-relative paths like ``inputs/data.txt`` are used for
      both the upload destination and the agent-facing prompt.
    - In Daytona mode the workspace root is prepended to create the
      absolute sandbox path for ``FileUpload``.
    - In local mode the ``local_root`` is the workspace root.
    
    Args:
        sandbox: Daytona sandbox instance (None for local mode)
        attachments: List of Attachment proto messages (all must have storage_key)
        storage: ArtifactStorage for downloading attachments (required)
        logger: Activity logger for debugging
        local_root: Root path for local filesystem mode (when sandbox is None)
        workspace_root: Explicit workspace root for Daytona mode (e.g. the
            volume mount path).  When provided, used directly instead of
            calling ``sandbox.get_work_dir()``.  When *None*, falls back to
            ``sandbox.get_work_dir()`` discovery (backward-compatible).
        
    Returns:
        List of dicts with injected file info: [{"filename": str, "path": str, "size": int}]
        
    Raises:
        ValueError: If any attachment is missing storage_key
    """
    if not attachments:
        return []
    
    logger.info("Injecting %d attachments into sandbox", len(attachments))
    
    # Import FileUpload for Daytona sandbox uploads
    try:
        from daytona import FileUpload
    except ImportError:
        FileUpload = None  # noqa: N806 — class reference, PascalCase is correct
    
    # Resolve workspace root for Daytona mode so upload destinations
    # match what the agent's backend will resolve when reading.
    ws_root: str | None = None
    if sandbox is not None:
        if workspace_root:
            ws_root = workspace_root.rstrip("/")
            logger.info(
                "[attachments] Using configured workspace root: %s", ws_root,
            )
        else:
            try:
                ws_root = sandbox.get_work_dir().rstrip("/")
                logger.info(
                    "[attachments] Daytona workspace root: %s", ws_root,
                )
            except Exception as exc:
                logger.warning(
                    "[attachments] sandbox.get_work_dir() failed (%s); "
                    "falling back to /home/daytona",
                    exc,
                )
                ws_root = "/home/daytona"
    
    file_uploads = []  # For Daytona batch upload
    injected_files = []  # Track injected files for return
    
    for attachment in attachments:
        if not attachment.storage_key:
            raise ValueError(f"Attachment missing storage_key: {attachment.filename}")
        
        logger.debug(
            "Downloading %s from storage key: %s",
            attachment.filename,
            attachment.storage_key,
        )
        content = storage.download(attachment.storage_key)
        logger.debug("Downloaded %d bytes for %s", len(content), attachment.filename)
        
        # Determine mount path - workspace-relative (no leading /)
        # Default: inputs/{filename}
        if attachment.mount_path:
            mount_path = attachment.mount_path.lstrip("/")
        else:
            mount_path = f"inputs/{attachment.filename}"
        
        if sandbox is not None:
            # Daytona sandbox mode - collect for batch upload.
            # Use workspace-root-prefixed absolute path so files land
            # where the agent's backend expects them.
            daytona_path = f"{ws_root}/{mount_path}"
            if FileUpload is None:
                raise RuntimeError("Daytona FileUpload not available")
            file_uploads.append(FileUpload(source=content, destination=daytona_path))
            logger.info(
                "Prepared attachment: %s -> %s", attachment.filename, daytona_path,
            )
            injected_files.append({
                "filename": attachment.filename,
                "path": mount_path,  # Workspace-relative for agent
                "size": len(content),
            })
        else:
            # Local filesystem mode - write directly
            if not local_root:
                raise ValueError("local_root required for local filesystem mode")
            
            from pathlib import Path
            file_path = Path(local_root) / mount_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(content)
            
            # Verify file was written correctly
            if file_path.exists():
                actual_size = file_path.stat().st_size
                logger.info(
                    "Wrote attachment to local filesystem: %s -> %s "
                    "(size: %d bytes, expected: %d bytes)",
                    attachment.filename,
                    file_path,
                    actual_size,
                    len(content),
                )
                if actual_size != len(content):
                    logger.warning(
                        "Size mismatch for %s: wrote %d bytes but file is %d bytes",
                        attachment.filename,
                        len(content),
                        actual_size,
                    )
            else:
                logger.error(
                    "Failed to write attachment: %s does not exist after write",
                    file_path,
                )
                raise ValueError(f"Failed to write attachment {attachment.filename}")
            
            injected_files.append({
                "filename": attachment.filename,
                "path": mount_path,  # Workspace-relative for agent
                "size": len(content),
            })
    
    # Batch upload to Daytona sandbox
    if sandbox is not None and file_uploads:
        sandbox.fs.upload_files(file_uploads)
        logger.info("Uploaded %d attachments to sandbox", len(file_uploads))
    
    # Log summary of all injected files
    logger.info(
        "Attachment injection complete. Files available to agent:\n"
        + "\n".join(f"  - {f['path']} ({f['size']} bytes)" for f in injected_files)
    )
    
    return injected_files


async def _auto_publish_written_files(
    tool_calls,
    sandbox,
    storage: ArtifactStorage,
    execution_id: str,
    status_builder: "StatusBuilder",
    local_root: str | None,
    logger,
) -> int:
    """Publish workspace files as artifacts based on completed file-modifying tool calls.

    This is a post-stream safety net.  When the agent created or modified
    files via ``write``, ``write_file``, ``edit``, or ``edit_file`` tools
    but no artifacts were published during execution, the user would receive
    no downloadable output.  This function inspects the completed tool
    calls, groups affected paths by their top-level directory, and publishes
    each group as a downloadable artifact.

    The function preserves the original folder structure: if all affected
    files share a common parent directory, that directory is published as a
    single (zipped) artifact.  If files are scattered across unrelated
    directories, each top-level directory (or individual root-level file)
    is published separately.

    Note: The ``execute`` tool (shell commands) can also create or modify
    files, but it exposes only a ``command`` string — no ``path`` parameter.
    Reliably extracting file paths from arbitrary shell commands is not
    tractable, so ``execute`` is intentionally excluded.  MCP tools are
    similarly opaque.  If this becomes a gap in practice, a filesystem-diff
    approach can be introduced later.

    Args:
        tool_calls: Iterable of ToolCall protos from the execution status.
        sandbox: Daytona sandbox instance (None for local mode).
        storage: ArtifactStorage for uploading artifacts.
        execution_id: Current execution ID.
        status_builder: StatusBuilder to track the new artifacts.
        local_root: Root path for local filesystem mode.
        logger: Activity logger.

    Returns:
        Number of artifacts auto-published (0 if no file-modifying calls found).
    """
    FILE_MODIFYING_TOOL_NAMES = {"write", "write_file", "edit", "edit_file"}

    # Collect paths from completed file-modifying tool calls.
    written_paths: list[str] = []
    for tc in tool_calls:
        if tc.name not in FILE_MODIFYING_TOOL_NAMES:
            continue
        if tc.status != ToolCallStatus.TOOL_CALL_COMPLETED:
            continue
        # tc.args is a google.protobuf.Struct; access fields as a dict.
        path = dict(tc.args).get("path", "")
        if path:
            written_paths.append(path)

    if not written_paths:
        logger.debug(
            f"[AUTO_PUBLISH] execution={execution_id} — "
            f"no completed file-modifying tool calls found, skipping"
        )
        return 0

    logger.info(
        f"[AUTO_PUBLISH] execution={execution_id} — "
        f"detected {len(written_paths)} modified file(s), "
        f"auto-publishing as artifacts: {written_paths}"
    )

    # Determine publish groups by finding the common ancestor directory.
    # If all paths share a common parent (e.g. "my-skill/SKILL.md",
    # "my-skill/scripts/run.sh" → common parent "my-skill"), publish that
    # directory as a single artifact.  Otherwise publish each unique
    # top-level segment separately.
    from pathlib import PurePosixPath

    # Normalise: strip leading slashes so paths are workspace-relative.
    normalised = [p.lstrip("/") for p in written_paths]

    # Compute common prefix directory.
    if len(normalised) == 1:
        p = PurePosixPath(normalised[0])
        if len(p.parts) > 1:
            # Single file inside a subdirectory → publish the parent dir.
            common_dir = str(p.parts[0])
        else:
            # Single file at workspace root → publish the file itself.
            common_dir = None
    else:
        try:
            import posixpath
            common = posixpath.commonpath(normalised)
        except ValueError:
            common = ""
        if common and common != ".":
            common_dir = common
        else:
            common_dir = None

    artifacts_published = 0

    if common_dir:
        # Publish the common directory as a single artifact.
        artifact_name = PurePosixPath(common_dir).name or common_dir
        try:
            artifact = await publish_artifact(
                sandbox=sandbox,
                storage=storage,
                execution_id=execution_id,
                path=common_dir,
                name=artifact_name,
                local_root=local_root,
            )
            status_builder.add_artifact(artifact)
            artifacts_published += 1
            logger.info(
                f"[AUTO_PUBLISH] execution={execution_id} — "
                f"published directory '{common_dir}' as artifact '{artifact_name}'"
            )
        except Exception as e:
            logger.warning(
                f"[AUTO_PUBLISH] execution={execution_id} — "
                f"failed to publish directory '{common_dir}': {e}"
            )
    else:
        # No common directory — publish each file individually.
        for rel_path in normalised:
            file_name = PurePosixPath(rel_path).name
            try:
                artifact = await publish_artifact(
                    sandbox=sandbox,
                    storage=storage,
                    execution_id=execution_id,
                    path=rel_path,
                    name=file_name,
                    local_root=local_root,
                )
                status_builder.add_artifact(artifact)
                artifacts_published += 1
                logger.info(
                    f"[AUTO_PUBLISH] execution={execution_id} — "
                    f"published file '{rel_path}' as artifact '{file_name}'"
                )
            except Exception as e:
                logger.warning(
                    f"[AUTO_PUBLISH] execution={execution_id} — "
                    f"failed to publish file '{rel_path}': {e}"
                )

    logger.info(
        f"[AUTO_PUBLISH] execution={execution_id} — "
        f"auto-published {artifacts_published} artifact(s) from "
        f"{len(written_paths)} modified file(s)"
    )
    return artifacts_published


@activity.defn(name="ExecuteGraphton")
async def execute_graphton(
    execution_id: str,
    thread_id: str,
    approval_decisions_wrapper: ApprovalDecisionList | None = None,
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
            optional comment.  The activity correlates these with pending_approvals
            from the fetched execution to build the LangGraph Command(resume=...) dict.
        
    Returns:
        AgentExecutionStatus: Final status with messages, tool_calls, phase
    """
    activity_logger = activity.logger
    activity_logger.info(f"ExecuteGraphton started for execution: {execution_id}")
    
    # Unwrap ApprovalDecisionList → list[SubmitApprovalInput].
    # The wrapper exists purely for polyglot Temporal serialization (a bare
    # list is not a proto.Message, so the Go/Java SDKs would fall back to
    # json/plain encoding that Python cannot decode).
    if approval_decisions_wrapper is not None and approval_decisions_wrapper.decisions:
        approval_decisions: list[SubmitApprovalInput] = list(
            approval_decisions_wrapper.decisions
        )
    else:
        approval_decisions: list[SubmitApprovalInput] = []
    
    # Top-level error handler for system errors (e.g., activity not registered, connection failures)
    # This catches errors that occur before the main try block or during initialization
    try:
        return await _execute_graphton_impl(
            execution_id, thread_id, approval_decisions, activity_logger
        )
    except Exception as system_error:
        exc_type = type(system_error).__name__
        exc_tb = traceback.format_exc()
        activity_logger.error(
            f"❌ SYSTEM ERROR in ExecuteGraphton for {execution_id}: "
            f"[{exc_type}] {system_error}\n{exc_tb}"
        )
        
        # Create minimal failed status for system errors
        # This handles cases where status_builder was never initialized
        from datetime import datetime

        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
        
        failed_status = AgentExecutionStatus(
            phase=ExecutionPhase.EXECUTION_FAILED,
            error=f"System error: [{exc_type}] {str(system_error)}",
            messages=[
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content="Internal system error occurred. Please contact support if this issue persists.",
                    timestamp=_utc_timestamp(),
                ),
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content=f"Error details: [{exc_type}] {str(system_error)}",
                    timestamp=_utc_timestamp(),
                )
            ]
        )
        
        # Try to update status in database (best effort)
        try:
            api_key = get_api_key()
            if api_key:
                execution_client = AgentExecutionClient(api_key)
                await execution_client.update_status(execution_id, failed_status)
                activity_logger.info(f"✅ Updated execution {execution_id} to FAILED status")
        except Exception as update_error:
            activity_logger.error(f"Failed to update status after system error: {update_error}")
        
        # Return failed status to workflow
        return failed_status


async def _execute_graphton_impl(
    execution_id: str,
    thread_id: str,
    approval_decisions: list[SubmitApprovalInput],
    activity_logger,
) -> AgentExecutionStatus:
    """
    Internal implementation of execute_graphton with existing error handling.
    This function contains the original implementation wrapped in the main try-except.
    
    Durable Execution Support:
    - On retry (attempt > 1), extracts thread_id from last heartbeat for checkpoint resume
    - LangGraph automatically loads checkpoint state when invoked with existing thread_id
    - This enables crash recovery without re-running from the beginning
    """
    # ─────────────────────────────────────────────────────────────────────────────
    # Crash Recovery: Detect retry and resume from checkpoint
    #
    # When Temporal retries this activity after a crash:
    # 1. heartbeat_details contains the last heartbeat from the previous attempt
    # 2. We extract thread_id to resume from the LangGraph checkpoint
    # 3. LangGraph automatically loads state when invoked with the same thread_id
    # ─────────────────────────────────────────────────────────────────────────────
    attempt = activity.info().attempt
    heartbeat_details = activity.info().heartbeat_details
    is_retry = attempt > 1 and heartbeat_details is not None
    
    if is_retry:
        # Extract thread_id from last heartbeat for checkpoint resume
        try:
            # heartbeat_details can be a tuple/list of the heartbeat payload(s)
            last_heartbeat = heartbeat_details[0] if isinstance(heartbeat_details, (list, tuple)) else heartbeat_details
            
            if isinstance(last_heartbeat, dict) and "thread_id" in last_heartbeat:
                resume_thread_id = last_heartbeat["thread_id"]
                activity_logger.info(
                    f"🔄 RETRY DETECTED: attempt={attempt}, "
                    f"resuming from checkpoint with thread_id={resume_thread_id} "
                    f"(original thread_id={thread_id})"
                )
                # Override thread_id with the one from heartbeat for checkpoint resume
                thread_id = resume_thread_id
            else:
                activity_logger.warning(
                    f"⚠️ RETRY DETECTED: attempt={attempt}, but heartbeat missing thread_id. "
                    f"Heartbeat data: {last_heartbeat}. Using provided thread_id={thread_id}"
                )
        except Exception as e:
            activity_logger.warning(
                f"⚠️ RETRY DETECTED: attempt={attempt}, failed to extract thread_id from heartbeat: {e}. "
                f"Using provided thread_id={thread_id}"
            )
    else:
        activity_logger.info(
            f"First attempt (attempt={attempt}): using thread_id={thread_id}"
        )
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Resume-Aware Logging
    #
    # When re-invoked after approval, emit a prominent log banner so operators
    # can immediately distinguish fresh executions from resume paths in logs.
    # ─────────────────────────────────────────────────────────────────────────────
    is_resume = bool(approval_decisions)
    if is_resume:
        activity_logger.info("=" * 80)
        activity_logger.info(
            f"🔄 [RESUME] ExecuteGraphton re-invoked after approval for "
            f"execution={execution_id}, thread_id={thread_id}, "
            f"decisions={len(approval_decisions)}, attempt={attempt}"
        )
        activity_logger.info("=" * 80)
    
    # Initialize setup timer for phase-aware duration tracking.
    # On the resume path this is especially valuable because the full setup
    # re-execution is the most common source of unexplained latency.
    setup_timer = SetupTimer(activity_logger)
    
    # Get API key (for gRPC calls to Stigmer backend)
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("API key not initialized")
    
    # Initialize gRPC clients (for reading agent configuration, sessions, etc.)
    session_client = SessionClient(api_key)
    agent_instance_client = AgentInstanceClient(api_key)
    agent_client = AgentClient(api_key)
    execution_client = AgentExecutionClient(api_key)
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Step 0: Hydrate AgentExecution from database via gRPC
    #
    # Instead of receiving the full AgentExecution proto through Temporal (which
    # can exceed the ~2 MB payload limit as status.tool_calls/messages grow),
    # we fetch it from the database.  The DB always has the latest persisted
    # state because the activity sends progressive gRPC status updates during
    # execution.
    # ─────────────────────────────────────────────────────────────────────────────
    setup_timer.start("execution_fetch")
    activity_logger.info(f"Fetching execution {execution_id} from database via gRPC")
    execution = await execution_client.get(execution_id)
    
    agent_id = execution.spec.agent_id
    user_message = execution.spec.message
    session_id_from_spec = execution.spec.session_id
    
    activity_logger.info(
        f"Execution parameters: agent_id={agent_id}, "
        f"session_id='{session_id_from_spec}' (empty={not session_id_from_spec})"
    )
    
    heartbeat_during_setup("execution_fetch", {
        "execution_id": execution_id,
        "agent_id": agent_id,
    })
    
    # Initialize retry executor for reliable final status updates
    # Uses exponential backoff (1s, 2s, 4s) with max 3 attempts
    retry_executor = GrpcRetryExecutor(RetryConfig.load_from_env())
    
    # NOTE: StatusBuilder is initialized later after MCP servers are fetched
    # so that ApprovalConfig can be built with complete policy data.
    # See Step 5.6 below.
    # Initialize to None here so error handler can check if it was created.
    status_builder = None
    
    # AsyncExitStack manages the checkpointer lifecycle (SQLite connection,
    # MongoDB client, etc.) across the entire activity execution. Created
    # outside the try block so the finally clause can always clean it up.
    exit_stack = contextlib.AsyncExitStack()
    
    try:
        # Step 1: Resolve the full chain: execution → session → agent_instance → agent
        setup_timer.start("chain_resolution")
        activity_logger.info(f"Resolving execution chain for execution: {execution_id}")
        
        # 1a. Get session from execution
        session_id = execution.spec.session_id
        if not session_id:
            raise ValueError(
                f"Session ID is required for execution {execution_id}. "
                "Execution must have a valid session_id to proceed."
            )
        
        session = await session_client.get(session_id)
        activity_logger.info(
            f"Session {session_id}: agent_instance_id={session.spec.agent_instance_id}"
        )
        
        # 1b. Get agent instance from session
        agent_instance = await agent_instance_client.get(session.spec.agent_instance_id)
        activity_logger.info(
            f"AgentInstance {session.spec.agent_instance_id}: agent_id={agent_instance.spec.agent_id}"
        )
        
        # 1c. Get agent template
        agent = await agent_client.get(agent_instance.spec.agent_id)
        activity_logger.info(
            f"Agent {agent_instance.spec.agent_id}: name={agent.metadata.name}"
        )
        
        # Extract agent instructions
        instructions = agent.spec.instructions if agent.spec.instructions else "You are a helpful AI assistant."
        
        # Heartbeat after chain resolution to prevent timeout during setup
        heartbeat_during_setup("chain_resolution", {
            "session_id": session_id,
            "agent_instance_id": session.spec.agent_instance_id,
            "agent_id": agent_instance.spec.agent_id,
        })
        
        # Step 2: Get worker configuration (for sandbox and LLM config)
        setup_timer.start("config_and_checkpointer")
        from worker.config import Config
        worker_config = Config.load_from_env()
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 2.5: Create checkpointer for HITL and conversation persistence
        #
        # The checkpointer enables two critical capabilities:
        # 1. HITL (Human-in-the-Loop) approval flow - interrupt/resume execution
        # 2. Conversational context preservation - multi-turn conversations
        #
        # Checkpointer selection is mode-aware:
        # - local mode: MemorySaver (ephemeral) or SqliteSaver (persistent)
        # - cloud mode: AsyncMongoDBSaver (persistent, multi-instance safe)
        #
        # create_checkpointer is an async context manager. We enter it via the
        # exit_stack so the underlying resources (SQLite connection, MongoDB client)
        # stay alive for the entire activity and are cleaned up in the finally block.
        # ─────────────────────────────────────────────────────────────────────────────
        checkpointer = await exit_stack.enter_async_context(
            create_checkpointer(worker_config.checkpointer)
        )
        activity_logger.info(
            f"Created {worker_config.checkpointer.type} checkpointer "
            f"for HITL approval flow and conversation persistence"
        )
        
        # Model name from execution config or worker config (mode-aware default)
        # Priority: execution config > worker LLM config (env vars + mode-aware defaults)
        model_name = (
            execution.spec.execution_config.model_name 
            if execution.spec.execution_config and execution.spec.execution_config.model_name
            else worker_config.llm.model_name
        )
        
        activity_logger.info(
            f"Agent config: model={model_name} (provider={worker_config.llm.provider}), "
            f"instructions_length={len(instructions)}"
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Create summarization config for automatic context window management (Phase 3)
        #
        # Uses Model Registry to determine model-appropriate thresholds.
        # Supports overrides from ExecutionConfig.context_management:
        # - disable_summarization: Opt out of automatic summarization
        # - custom_trigger_threshold: Override when summarization triggers
        # - custom_target_tokens: Override the target size after summarization
        # ─────────────────────────────────────────────────────────────────────────────
        
        # Parse context management config from execution_config (if present)
        context_management_config = None
        if execution.spec.HasField("execution_config") and execution.spec.execution_config.HasField("context_management"):
            context_management_config = execution.spec.execution_config.context_management
            activity_logger.info(
                f"[CONTEXT] Context management config from spec: "
                f"disable={context_management_config.disable_summarization}, "
                f"custom_trigger={context_management_config.custom_trigger_threshold}, "
                f"custom_target={context_management_config.custom_target_tokens}"
            )
        
        # Build summarization config with optional overrides
        if context_management_config and context_management_config.disable_summarization:
            summarization_config = SummarizationConfig.disabled()
            activity_logger.info("[CONTEXT] Summarization DISABLED via context_management config")
        else:
            # Apply custom thresholds if specified (0 means use model default)
            trigger_override = (
                context_management_config.custom_trigger_threshold
                if context_management_config and context_management_config.custom_trigger_threshold > 0
                else None
            )
            target_override = (
                context_management_config.custom_target_tokens
                if context_management_config and context_management_config.custom_target_tokens > 0
                else None
            )
            
            summarization_config = SummarizationConfig.for_model(
                model_id=model_name,
                enabled=True,
                trigger_threshold_override=trigger_override,
                target_tokens_override=target_override,
            )
            activity_logger.info(
                f"[CONTEXT] Summarization enabled: trigger={summarization_config.trigger_threshold}, "
                f"target={summarization_config.target_tokens}, "
                f"model={summarization_config.summarization_model}"
                + (f", trigger_override={trigger_override}" if trigger_override else "")
                + (f", target_override={target_override}" if target_override else "")
            )
        
        # Get sandbox configuration from worker config
        setup_timer.start("sandbox")
        sandbox_config = worker_config.get_sandbox_config(session_id=session_id)
        
        activity_logger.info(
            f"Sandbox mode: {worker_config.mode} - using {sandbox_config.get('type')} backend"
        )
        
        # Initialize sandbox manager based on mode
        # Note: In local mode (filesystem), SandboxManager is not used
        # The sandbox_config is passed directly to Graphton
        sandbox_manager = None
        if worker_config.mode != "local":
            # Cloud mode - use Daytona SandboxManager
            api_key = os.environ.get("DAYTONA_API_KEY")
            if not api_key:
                raise ValueError("DAYTONA_API_KEY environment variable required for cloud mode")
            
            sandbox_manager = SandboxManager(
                daytona_api_key=api_key,
                volume_id=get_daytona_volume_id(),
            )
            
            if snapshot_id := sandbox_config.get("snapshot_id"):
                activity_logger.info(f"Using Daytona snapshot: {snapshot_id}")
        
        # Get session_id from execution (if exists)
        resolved_session_id: str | None = execution.spec.session_id if execution.spec.session_id else None
        
        # Handle sandbox based on mode
        sandbox = None
        is_new_sandbox = False
        
        if worker_config.is_local_mode():
            # Local mode - no sandbox management needed
            # Graphton will create filesystem backend from config
            activity_logger.info(
                f"Local mode - using filesystem backend at {sandbox_config.get('root_dir')}"
            )
        else:
            # Cloud mode - get or create Daytona sandbox (reuse if session exists)
            activity_logger.info(
                f"{'Checking for existing sandbox in session' if resolved_session_id else 'Creating ephemeral sandbox'}"
            )
            
            if sandbox_manager is None:
                raise RuntimeError("Sandbox manager not initialized for cloud mode")
            
            sandbox, is_new_sandbox = await sandbox_manager.get_or_create_daytona_sandbox(
                sandbox_config=sandbox_config,
                session_id=resolved_session_id,
                session_client=session_client,
            )
            
            activity_logger.info(
                f"Sandbox {'created' if is_new_sandbox else 'reused'}: {sandbox.id} "
                f"for execution {execution_id}"
            )
        
        # Compute the authoritative workspace root for Daytona mode.
        # When a persistent volume is mounted (volume_id + session_id),
        # the workspace root is the volume mount path.  All consumers
        # (SkillWriter, inject_attachments, sandbox_config_for_agent,
        # diagnostics) use this value instead of independently calling
        # sandbox.get_work_dir().
        daytona_workspace_root: str | None = None
        if not worker_config.is_local_mode() and sandbox is not None:
            volume_id = get_daytona_volume_id()
            if volume_id and resolved_session_id:
                daytona_workspace_root = DAYTONA_WORKSPACE_MOUNT_PATH
                activity_logger.info(
                    "Volume-backed workspace: workspace_root=%s "
                    "(volume_id=%s, session_id=%s)",
                    daytona_workspace_root,
                    volume_id,
                    resolved_session_id,
                )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Workspace integrity flag (resume fast-path safety net)
        #
        # When resuming after approval, the fast-path skips skill/attachment
        # writes on the assumption that files persist from the prior execution
        # (backed by the Daytona Volume or local session directory).  Before
        # entering the fast-path, we verify a single sentinel file exists.
        # If the check fails (e.g. volume mount failure, data loss), we set
        # this flag to False and fall back to a full setup — gracefully
        # degrading rather than leaving the agent in an empty workspace.
        #
        # Initialised here so both Step 3 (skills) and Step 3.5 (attachments)
        # can read it.
        # ─────────────────────────────────────────────────────────────────────────────
        workspace_files_intact = True

        # Step 3: Fetch and write skills (from agent template via references)
        # Following the Agent Skills spec progressive disclosure model:
        # - Skills are written to bin/skills/{name}/ in the sandbox
        # - Only metadata (name + description + location) injected into prompt
        # - Agent reads SKILL.md on demand when activating a skill
        #
        # RESUME FAST PATH: On the resume-after-approval path, skills have
        # already been written to the sandbox by the previous activity
        # invocation.  We still fetch the Skill protos (lightweight gRPC)
        # to generate the system-prompt section, but skip the expensive
        # artifact download, sandbox write, diagnostic listing, and
        # post-write verification steps.  A sentinel check (Step 2.75 above)
        # gates the fast-path — if the check fails, we fall through to the
        # full setup instead.
        setup_timer.start("skills")
        skills_prompt_section = ""
        skills = []  # List of Skill protos (populated if skill_refs exist)
        skill_refs = agent.spec.skill_refs  # repeated ApiResourceReference
        
        # Create skill client (needed for both parent skills and subagent skills)
        skill_client = SkillClient(api_key)
        
        if skill_refs:
            
            try:
                # Fetch skills via gRPC using ApiResourceReference (supports version resolution)
                activity_logger.info(
                    f"Fetching {len(skill_refs)} skills: {[ref.slug for ref in skill_refs]}"
                )
                skills = await skill_client.list_by_refs(list(skill_refs))
                
                # ─── Step 2.75: Workspace integrity check (resume only) ───
                # Before trusting the fast-path, verify a single sentinel
                # file from the previous execution is still accessible.
                # This validates the full chain: volume mounted → subpath
                # correct → data intact.  One cheap I/O call.
                if is_resume and skills:
                    sentinel_paths = SkillWriter.compute_skill_paths(skills)
                    first_skill_dir = next(iter(sentinel_paths.values()))
                    sentinel = f"{first_skill_dir}/SKILL.md"
                    workspace_files_intact = _check_workspace_file_exists(
                        sandbox=sandbox,
                        local_root=(
                            sandbox_config.get("root_dir")
                            if worker_config.is_local_mode()
                            else None
                        ),
                        workspace_root=daytona_workspace_root,
                        path=sentinel,
                        logger=activity_logger,
                    )
                    if workspace_files_intact:
                        activity_logger.info(
                            "[RESUME] Workspace integrity verified "
                            "(sentinel=%s) — volume-backed files intact",
                            sentinel,
                        )
                    else:
                        activity_logger.warning(
                            "[RESUME] Workspace integrity check FAILED "
                            "(sentinel=%s). Falling back to full "
                            "skill/attachment setup.",
                            sentinel,
                        )

                if is_resume and workspace_files_intact:
                    # ─── Resume fast path ─────────────────────────────────────
                    # Skills are already in the sandbox.  Compute paths
                    # deterministically (same logic as SkillWriter.write_skills)
                    # and generate the prompt section without any I/O.
                    skill_paths = SkillWriter.compute_skill_paths(skills)
                    skills_prompt_section = SkillWriter.generate_prompt_section(skills, skill_paths)
                    activity_logger.info(
                        "[RESUME] Skipped skill write — reusing %d skills "
                        "already in sandbox: %s",
                        len(skills),
                        [s.metadata.name for s in skills],
                    )
                else:
                    # ─── Fresh execution path (or resume fallback) ────────────
                    if is_resume:
                        activity_logger.warning(
                            "[RESUME-FALLBACK] Re-writing %d skills to "
                            "workspace (integrity check failed)",
                            len(skills),
                        )
                    # Download artifacts for skills that have storage keys
                    artifacts = {}
                    for skill in skills:
                        if skill.status.artifact_storage_key:
                            activity_logger.info(
                                f"Downloading artifact for skill {skill.metadata.name} "
                                f"(key: {skill.status.artifact_storage_key})"
                            )
                            try:
                                artifact_bytes = await skill_client.get_artifact(
                                    skill.status.artifact_storage_key
                                )
                                artifacts[skill.metadata.id] = artifact_bytes
                                activity_logger.info(
                                    f"Downloaded artifact for {skill.metadata.name}: "
                                    f"{len(artifact_bytes)} bytes"
                                )
                            except Exception as e:
                                activity_logger.warning(
                                    f"Failed to download artifact for {skill.metadata.name}: {e}. "
                                    "Falling back to SKILL.md only."
                                )
                                # Continue without artifact - will use SKILL.md only
                    
                    # Write skills to sandbox (both local and cloud modes supported)
                    if worker_config.is_local_mode():
                        # Local mode - write to local filesystem
                        local_root = sandbox_config.get('root_dir', '/tmp/stigmer-sandbox')
                        activity_logger.info(
                            f"Writing {len(skills)} skills to local filesystem at {local_root}/bin/skills/"
                        )
                        skill_writer = SkillWriter(local_root=local_root)
                        skill_paths = skill_writer.write_skills(skills, artifacts=artifacts)
                    else:
                        # Cloud mode - upload to Daytona sandbox
                        if sandbox is None:
                            raise RuntimeError("Sandbox not initialized for cloud mode")
                        
                        activity_logger.info(
                            f"Uploading {len(skills)} skills to Daytona sandbox "
                            f"(sandbox {'newly created' if is_new_sandbox else 'reused, updating skills'})"
                        )
                        skill_writer = SkillWriter(
                            sandbox=sandbox,
                            workspace_root=daytona_workspace_root,
                        )
                        skill_paths = skill_writer.write_skills(skills, artifacts=artifacts)
                    
                    # Generate prompt section with full SKILL.md content and LOCATION headers
                    skills_prompt_section = SkillWriter.generate_prompt_section(skills, skill_paths)
                    
                    activity_logger.info(
                        f"Successfully wrote {len(skills)} skills: {[s.metadata.name for s in skills]}"
                    )
                    
                    # ─── Diagnostic: verify skill files are accessible ───────────
                    # Log workspace root and verify skill paths exist in the
                    # sandbox at the expected location.
                    if not worker_config.is_local_mode() and sandbox is not None:
                        # Use the authoritative workspace root (volume mount
                        # path when present), falling back to get_work_dir().
                        diag_ws_root: str | None = daytona_workspace_root
                        if not diag_ws_root:
                            try:
                                diag_ws_root = sandbox.get_work_dir()
                            except Exception as diag_exc:
                                activity_logger.warning(
                                    "[skill-diag] sandbox.get_work_dir() failed: %s",
                                    diag_exc,
                                )
                        activity_logger.info(
                            "[skill-diag] workspace_root = %r", diag_ws_root,
                        )

                        for _sid, spath in skill_paths.items():
                            # spath is workspace-relative, e.g. "bin/skills/abc…"
                            # SkillWriter writes to {workspace_root}/{spath}
                            if diag_ws_root:
                                abs_path = f"{diag_ws_root.rstrip('/')}/{spath}"
                            else:
                                abs_path = f"/{spath}"
                            diag_result = sandbox.process.exec(
                                f"ls -la {abs_path}/ 2>&1 | head -20", timeout=5,
                            )
                            diag_out = diag_result.output if diag_result.output else ""
                            activity_logger.info(
                                "[skill-diag] ls %s/  exit=%d  output=%s",
                                abs_path,
                                diag_result.exit_code,
                                diag_out[:300],
                            )

                    # ─── Post-write verification ─────────────────────────────
                    # Create the same backend the agent will use and verify
                    # every skill's SKILL.md is readable.  This catches path
                    # mismatches at setup time rather than at agent runtime.
                    if skill_paths:
                        from graphton.core.sandbox_factory import create_sandbox_backend

                        if worker_config.is_local_mode():
                            verify_cfg = sandbox_config.copy()
                        else:
                            if sandbox is None:
                                raise RuntimeError(
                                    "Sandbox not initialized for post-write verification"
                                )
                            verify_cfg = {
                                "type": "daytona",
                                "sandbox_id": sandbox.id,
                            }

                        verify_backend = create_sandbox_backend(verify_cfg)
                        for _vid, vpath in skill_paths.items():
                            skill_md_path = f"{vpath}/SKILL.md"
                            try:
                                content = verify_backend.read(skill_md_path)
                                activity_logger.info(
                                    "Skill post-write verification passed: %s (%d bytes)",
                                    skill_md_path,
                                    len(content),
                                )
                            except Exception as verify_exc:
                                activity_logger.error(
                                    "CRITICAL: Skill at %s not readable through "
                                    "agent backend: %s",
                                    skill_md_path,
                                    verify_exc,
                                )
                                raise RuntimeError(
                                    f"Skill verification failed for {skill_md_path}: "
                                    f"{verify_exc}"
                                ) from verify_exc
                    
            except RuntimeError as e:
                # Catch write/upload failures from SkillWriter
                activity_logger.error(f"Failed to write skills: {e}")
                raise ValueError(f"Skill write failed: {e}") from e
            except Exception as e:
                activity_logger.error(f"Unexpected error preparing skills: {e}")
                raise
        
        # Heartbeat after skill writing to prevent timeout during setup
        heartbeat_during_setup("skills_written", {
            "skill_count": len(skills) if skills else 0,
            "skill_names": [s.metadata.name for s in skills] if skills else [],
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        setup_timer.start("attachments")
        # Step 3.5: Inject Attachments into Sandbox
        #
        # Attachments are files provided by the user with the execution request.
        # They are injected into the sandbox at their specified mount_path
        # (default: inputs/{filename}), making them available to the agent.
        #
        # All attachments must have storage_key (pre-uploaded via uploadAttachment RPC).
        #
        # RESUME FAST PATH: On the resume-after-approval path, attachments
        # have already been injected by the previous activity invocation.
        # We reconstruct the injected_files list from the execution spec
        # (needed for the system prompt) without re-downloading or
        # re-uploading anything.
        # ─────────────────────────────────────────────────────────────────────────────
        attachments = list(execution.spec.attachments) if execution.spec.attachments else []
        injected_files: list[dict] = []  # Track injected files for system prompt
        
        if attachments:
            if is_resume and workspace_files_intact:
                # ─── Resume fast path ─────────────────────────────────────
                # Attachments are already in the sandbox.  Reconstruct the
                # metadata list for the system prompt without any I/O.
                for att in attachments:
                    mount_path = att.mount_path if att.mount_path else f"inputs/{att.filename}"
                    injected_files.append({
                        "filename": att.filename,
                        "path": mount_path,
                        "size": None,  # Not available on resume (content not re-downloaded)
                    })
                activity_logger.info(
                    "[RESUME] Skipped attachment injection — reusing "
                    "%d attachments already in sandbox",
                    len(injected_files),
                )
            else:
                # ─── Fresh execution path (or resume fallback) ────────────
                if is_resume:
                    activity_logger.warning(
                        "[RESUME-FALLBACK] Re-injecting %d attachments "
                        "into workspace (integrity check failed)",
                        len(attachments),
                    )
                activity_logger.info(
                    f"Processing {len(attachments)} attachments: "
                    f"{[a.filename for a in attachments]}"
                )
                
                # Create artifact storage for downloading attachments
                artifact_storage = create_artifact_storage(worker_config.artifact_storage)
                activity_logger.info(
                    f"Created artifact storage ({worker_config.artifact_storage.storage_type}) "
                    "for attachment downloads"
                )
                
                try:
                    injected_files = await inject_attachments(
                        sandbox=sandbox,  # None for local mode
                        attachments=attachments,
                        storage=artifact_storage,
                        logger=activity_logger,
                        local_root=sandbox_config.get('root_dir') if worker_config.is_local_mode() else None,
                        workspace_root=daytona_workspace_root,
                    )
                    activity_logger.info(f"Successfully injected {len(injected_files)} attachments")
                except Exception as e:
                    activity_logger.error(f"Failed to inject attachments: {e}")
                    raise ValueError(f"Attachment injection failed: {e}") from e
        
        # Heartbeat after attachment injection to prevent timeout during setup
        heartbeat_during_setup("attachments_injected", {
            "attachment_count": len(attachments),
            "injected_count": len(injected_files),
        })
        
        # Step 4: Get merged environment variables
        # Try ExecutionContext first (new flow with pre-merged/decrypted env vars)
        # Fall back to legacy environment merging if ExecutionContext not found
        setup_timer.start("environment")
        merged_env_vars = {}
        use_legacy_env_merge = True
        
        try:
            # Try to get pre-merged environment from ExecutionContext
            execution_context_client = ExecutionContextClient(api_key)
            exec_ctx = await execution_context_client.try_get_by_execution_id(execution_id)
            
            if exec_ctx and exec_ctx.spec.data:
                # Use pre-merged and pre-decrypted environment from ExecutionContext
                activity_logger.info(
                    f"Using merged environment from ExecutionContext: "
                    f"context_id={exec_ctx.metadata.id}, env_count={len(exec_ctx.spec.data)}"
                )
                
                # Extract values from ExecutionValue objects
                for key, exec_value in exec_ctx.spec.data.items():
                    merged_env_vars[key] = exec_value.value
                
                use_legacy_env_merge = False
                activity_logger.info(f"ExecutionContext environment: {len(merged_env_vars)} total vars")
            else:
                activity_logger.debug(
                    f"No ExecutionContext found for execution {execution_id} - "
                    "using legacy environment merge"
                )
        except Exception as e:
            activity_logger.warning(
                f"Failed to get ExecutionContext, falling back to legacy merge: {e}"
            )
        
        # Legacy environment merge (backward compatibility)
        if use_legacy_env_merge:
            environment_refs = agent_instance.spec.environment_refs
            
            if environment_refs:
                activity_logger.info(
                    f"[Legacy] Merging {len(environment_refs)} environments: "
                    f"{[ref.slug for ref in environment_refs]}"
                )
                
                try:
                    # Create environment client
                    environment_client = EnvironmentClient(api_key)
                    
                    # Fetch environments (preserves order for proper merging)
                    environments = await environment_client.list_by_refs(list(environment_refs))
                    
                    # Merge environments in order (later overrides earlier)
                    # Start with agent's base env_spec if it exists
                    if agent.spec.env_spec and agent.spec.env_spec.data:
                        # Extract values from EnvironmentValue objects
                        for key, env_value in agent.spec.env_spec.data.items():
                            merged_env_vars[key] = env_value.value
                        activity_logger.info(f"[Legacy] Base env vars from agent: {len(agent.spec.env_spec.data)}")
                    
                    # Layer each environment (order matters!)
                    for idx, env in enumerate(environments):
                        if env.spec.data:
                            # Extract values from EnvironmentValue objects
                            for key, env_value in env.spec.data.items():
                                merged_env_vars[key] = env_value.value
                            activity_logger.info(
                                f"[Legacy] Merged env {idx+1}/{len(environments)} ({env.metadata.name}): "
                                f"{len(env.spec.data)} vars"
                            )
                    
                    # Runtime env vars from execution have highest priority
                    if execution.spec.runtime_env:
                        # Convert ExecutionValue to string values
                        runtime_vars = {
                            key: value.value 
                            for key, value in execution.spec.runtime_env.items()
                        }
                        merged_env_vars.update(runtime_vars)
                        activity_logger.info(f"[Legacy] Applied runtime env overrides: {len(runtime_vars)} vars")
                    
                    activity_logger.info(f"[Legacy] Final merged environment: {len(merged_env_vars)} total vars")
                    
                except Exception as e:
                    activity_logger.error(f"[Legacy] Failed to merge environments: {e}")
                    # Continue without environments rather than failing execution
                    merged_env_vars = {}
        
        # Heartbeat after environment merge to prevent timeout during setup
        heartbeat_during_setup("environment_merged", {
            "env_var_count": len(merged_env_vars),
            "used_legacy_merge": use_legacy_env_merge,
        })
        
        # Step 5: Fetch and transform MCP servers (from agent template via mcp_server_usages)
        # MCP servers provide external tools via Model Context Protocol
        setup_timer.start("mcp_servers")
        mcp_servers_config = {}
        mcp_tools_config = {}
        mcp_servers = []  # Initialize to empty list (populated if usages exist and fetch succeeds)
        mcp_server_usages = agent.spec.mcp_server_usages
        
        if mcp_server_usages:
            activity_logger.info(
                f"Fetching {len(mcp_server_usages)} MCP servers: "
                f"{[usage.mcp_server_ref.slug for usage in mcp_server_usages]}"
            )
            
            try:
                # Create MCP server client
                mcp_server_client = McpServerClient(api_key)
                
                # Extract refs from usages
                mcp_server_refs = [usage.mcp_server_ref for usage in mcp_server_usages]
                
                # Fetch MCP server resources via gRPC
                mcp_servers = await mcp_server_client.list_by_refs(mcp_server_refs)
                
                activity_logger.info(
                    f"Fetched {len(mcp_servers)} MCP servers: "
                    f"{[s.metadata.name for s in mcp_servers]}"
                )
                
                # Transform MCP server configs to LangGraph format
                # Uses merged_env_vars for placeholder resolution (${VAR_NAME})
                mcp_config_result = transform_all_mcp_configs(
                    mcp_servers=mcp_servers,
                    mcp_server_usages=list(mcp_server_usages),
                    env_vars=merged_env_vars,
                )
                
                mcp_servers_config = mcp_config_result.servers
                mcp_tools_config = mcp_config_result.tools
                
                activity_logger.info(
                    f"Transformed MCP configs: servers={list(mcp_servers_config.keys())}, "
                    f"tools={sum(len(t) if t else 0 for t in mcp_tools_config.values())} total"
                )
                
            except ValueError as e:
                # MCP server not found - log error but continue without MCP
                activity_logger.error(f"MCP server fetch failed: {e}")
                activity_logger.warning("Continuing without MCP servers - agent will have limited capabilities")
                mcp_servers_config = {}
                mcp_tools_config = {}
                mcp_servers = []  # Reset to empty on failure
            except Exception as e:
                activity_logger.error(f"Unexpected error preparing MCP servers: {e}")
                activity_logger.warning("Continuing without MCP servers - agent will have limited capabilities")
                mcp_servers_config = {}
                mcp_tools_config = {}
                mcp_servers = []  # Reset to empty on failure
        
        # Heartbeat after MCP server transform to prevent timeout during setup
        heartbeat_during_setup("mcp_servers_transformed", {
            "mcp_server_count": len(mcp_servers),
            "mcp_servers": list(mcp_servers_config.keys()) if mcp_servers_config else [],
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.6: Build ApprovalConfig and Initialize StatusBuilder (HITL Phase 3A)
        #
        # Assembles approval policy configuration from multiple sources:
        # - execution.spec.auto_approve_all (runtime bypass)
        # - mcp_server_usages[].tool_approval_overrides (per-agent customization)
        # - mcp_servers[].spec.default_tool_approvals (platform/org defaults)
        #
        # StatusBuilder is initialized here (not earlier) to receive the complete
        # ApprovalConfig for tool approval detection during execution.
        # ─────────────────────────────────────────────────────────────────────────────
        
        approval_config = build_approval_config(
            execution=execution,
            mcp_server_usages=list(mcp_server_usages) if mcp_server_usages else [],
            mcp_servers=mcp_servers,
            mcp_tools_config=mcp_tools_config,
        )
        
        activity_logger.info(
            f"Built ApprovalConfig: auto_approve_all={approval_config.auto_approve_all}, "
            f"overrides={len(approval_config.tool_approval_overrides)}, "
            f"default_policies={len(approval_config.default_tool_approvals)} servers, "
            f"tool_mapping={len(approval_config.tool_to_mcp_server)} tools"
        )
        
        # Initialize status builder with approval config
        status_builder = StatusBuilder(execution_id, execution.status, approval_config)
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.7: Build ResolvedExecutionContext (Phase 2.5)
        #
        # Captures what resources the agent actually has access to for visibility,
        # debugging, and auditing. Populated once before streaming begins.
        # ─────────────────────────────────────────────────────────────────────────────
        
        # Build MCP server resolution status
        # Track which servers were requested vs successfully resolved
        mcp_server_status = {}
        requested_mcp_slugs = (
            {usage.mcp_server_ref.slug for usage in mcp_server_usages}
            if mcp_server_usages else set()
        )
        resolved_mcp_slugs = set(mcp_servers_config.keys())
        
        for slug in requested_mcp_slugs:
            if slug in resolved_mcp_slugs:
                # Server successfully resolved - count enabled tools
                tool_count = len(mcp_tools_config.get(slug, []) or [])
                mcp_server_status[slug] = (True, "Configured successfully", tool_count)
            else:
                # Server resolution failed
                mcp_server_status[slug] = (False, "Server not found or resolution failed", 0)
        
        # Extract skill names from fetched skill protos
        skill_names = [s.metadata.name for s in skills] if skills else []
        
        # Set resolved context on status builder
        status_builder.set_resolved_context(
            environment_keys=list(merged_env_vars.keys()),
            mcp_servers=mcp_server_status,
            skill_names=skill_names,
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.8: Initialize Context Management Tracking (Phase 3)
        #
        # Sets up context info for tracking context window utilization and
        # summarization events. The StatusBuilder implements SummarizationCallback
        # to receive events from the middleware during execution.
        # ─────────────────────────────────────────────────────────────────────────────
        
        # Get model metadata for context window info
        model_metadata = ModelRegistry.get_or_default(model_name)
        
        # Initialize context info on status builder
        status_builder.initialize_context_info(
            context_window_limit=model_metadata.context_window_tokens,
            trigger_threshold=summarization_config.trigger_threshold,
            target_tokens=summarization_config.target_tokens,
            enabled=summarization_config.enabled,
        )
        
        # Step 6: Create Graphton agent at runtime with EXISTING sandbox
        # Note: MCP servers are passed if configured, providing external tool access
        setup_timer.start("agent_creation")
        activity_logger.info(f"Creating Graphton agent for execution {execution_id}")
        
        # Enhance system prompt with skills section
        enhanced_system_prompt = instructions
        if skills_prompt_section:
            enhanced_system_prompt += skills_prompt_section
            activity_logger.info("Enhanced system prompt with skills metadata")
        
        # Add input files section to system prompt if attachments were injected
        if injected_files:
            input_files_section = "\n\n## Input Files\n\n"
            input_files_section += (
                "The following files have been provided as input for this task. "
                "Use the `read` tool to access them:\n\n"
            )
            for f in injected_files:
                size_info = f" ({f['size']} bytes)" if f.get('size') is not None else ""
                input_files_section += f"- `{f['path']}`{size_info}\n"
            input_files_section += (
                "\nThese files are available in your workspace. "
                "Read them using the `read` tool with the paths shown above."
            )
            enhanced_system_prompt += input_files_section
            activity_logger.info(
                f"Enhanced system prompt with {len(injected_files)} input files"
            )
        
        # Configure sandbox for Graphton agent
        if worker_config.is_local_mode():
            # Local mode - pass filesystem config directly
            sandbox_config_for_agent = sandbox_config.copy()
            activity_logger.info(
                f"Configuring agent for local mode with filesystem backend at {sandbox_config.get('root_dir')}"
            )
        else:
            # Cloud mode - pass Daytona config with sandbox_id to reuse existing sandbox
            if sandbox is None:
                raise RuntimeError("Sandbox not initialized for cloud mode")
            
            sandbox_config_for_agent: dict[str, Any] = {
                "type": "daytona",
                "sandbox_id": sandbox.id,  # Reuse existing sandbox with skills
            }
            # When a persistent volume is mounted, tell the backend factory
            # to use the volume mount path as the agent's workspace root.
            if daytona_workspace_root:
                sandbox_config_for_agent["workspace_root"] = daytona_workspace_root
            activity_logger.info(
                "Configuring agent to use existing sandbox %s "
                "(workspace_root=%s)",
                sandbox.id,
                daytona_workspace_root or "<sandbox default>",
            )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Resolve model name to API model ID
        #
        # Platform-friendly names like "claude-sonnet-4.5" are resolved to actual API
        # model IDs like "claude-sonnet-4-5-20250929". This allows users to use
        # simpler names while ensuring the correct model ID is sent to the provider.
        #
        # The resolve_or_passthrough() method handles unknown models gracefully by
        # passing them through as-is (useful for custom/unlisted models).
        # ─────────────────────────────────────────────────────────────────────────────
        api_model_id, resolved_metadata = ModelRegistry.resolve_or_passthrough(
            model_name,
            provider=worker_config.llm.provider,
        )
        
        if api_model_id != model_name:
            activity_logger.info(
                f"Resolved model '{model_name}' to API model ID '{api_model_id}'"
            )
        
        # Create LLM instance with explicit configuration
        # This ensures base_url is properly set for Ollama connections from Docker
        llm_model: Any  # ChatOllama | ChatAnthropic | ChatOpenAI | str
        if worker_config.llm.provider == "ollama":
            from langchain_ollama import ChatOllama
            llm_model = ChatOllama(
                model=api_model_id,
                base_url=worker_config.llm.base_url,  # Explicitly pass base_url
            )
            activity_logger.info(f"Created ChatOllama with base_url={worker_config.llm.base_url}")
        elif worker_config.llm.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            llm_model = ChatAnthropic(  # type: ignore[call-arg]  # pydantic model accepts 'model' at runtime
                model=api_model_id,
                api_key=worker_config.llm.api_key,
            )
        elif worker_config.llm.provider == "openai":
            from langchain_openai import ChatOpenAI
            llm_model = ChatOpenAI(
                model=api_model_id,
                api_key=worker_config.llm.api_key,
            )
        else:
            # Fallback: pass resolved model ID as string and let Graphton handle it
            llm_model = api_model_id
        
        # Create approval checker for HITL tool approval flow (Phase 3B)
        # The checker evaluates the approval policy chain for each tool invocation
        approval_checker = create_approval_checker(approval_config)
        
        activity_logger.info(
            f"Created approval checker for HITL flow "
            f"(auto_approve_all={approval_config.auto_approve_all})"
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.9: Transform SubAgents (Sub-agent Execution Support)
        #
        # Transforms proto SubAgent definitions from AgentSpec.sub_agents to graphton
        # format. Each subagent gets:
        # - Filtered MCP access based on McpAccess grants (subset of parent's tools)
        # - Resolved skills injected into system_prompt
        # - Tool wrappers for allowed MCP tools
        #
        # Permission model:
        # - SubAgent can only access MCP servers explicitly listed in mcp_access
        # - SubAgent tools = intersection of parent's enabled tools and subagent's request
        # - SubAgent skills are independent (can reference any Skill resource)
        # ─────────────────────────────────────────────────────────────────────────────
        
        transformed_subagents = None
        
        if agent.spec.sub_agents:
            activity_logger.info(
                f"Transforming {len(agent.spec.sub_agents)} sub-agent(s): "
                f"{[sa.name for sa in agent.spec.sub_agents]}"
            )
            
            try:
                # Build skill writer kwargs based on mode
                if worker_config.is_local_mode():
                    skill_writer_kwargs = {
                        "local_root": sandbox_config.get('root_dir', '/tmp/stigmer-sandbox')
                    }
                else:
                    if sandbox is None:
                        raise RuntimeError("Sandbox not initialized for cloud mode")
                    skill_writer_kwargs = {"sandbox": sandbox}
                
                # Transform subagents with MCP filtering and skill resolution
                transformed_subagents = await transform_sub_agents(
                    sub_agents=list(agent.spec.sub_agents),
                    parent_mcp_servers=mcp_servers_config or {},
                    parent_mcp_tools=mcp_tools_config or {},
                    parent_mcp_usages=list(agent.spec.mcp_server_usages) if agent.spec.mcp_server_usages else [],
                    skill_client=skill_client,
                    skill_writer_class=SkillWriter,
                    skill_writer_kwargs=skill_writer_kwargs,
                    approval_checker=approval_checker,
                    activity_logger=activity_logger,
                )
                
                if transformed_subagents:
                    activity_logger.info(
                        f"Successfully transformed {len(transformed_subagents)} sub-agent(s) "
                        f"with MCP tools and skills"
                    )
                else:
                    activity_logger.warning(
                        "No valid sub-agents after transformation (all may have invalid configs)"
                    )
                    
            except Exception as e:
                activity_logger.error(f"Failed to transform sub-agents: {e}")
                activity_logger.warning("Continuing without sub-agents - agent will not delegate tasks")
                transformed_subagents = None
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.10: Create Artifact Storage (for post-stream auto-publish)
        #
        # Artifact storage is used by the post-stream auto-publish safety net
        # to upload files created or modified by the agent as downloadable
        # artifacts.  The agent does NOT receive a publish_artifact tool —
        # publishing is handled structurally by the platform after the stream
        # completes, based on completed file-modifying tool calls (write,
        # write_file, edit, edit_file).  This eliminates dependence on LLM
        # compliance for artifact delivery.
        # ─────────────────────────────────────────────────────────────────────────────
        artifact_storage = create_artifact_storage(worker_config.artifact_storage)
        activity_logger.info(
            f"Created artifact storage ({worker_config.artifact_storage.storage_type}) "
            "for post-stream auto-publish"
        )
        
        # Create Graphton agent.
        #
        # Recursion limit: 1000 for the top-level graph. deepagents 0.4.x
        # uses langchain's create_agent() which defaults subagent graphs to
        # DEFAULT_RECURSION_LIMIT (10,000 in langgraph 1.0.x). This gives
        # subagents generous room while the top-level graph is capped at 1000.
        # Graphton's loop detection middleware provides additional protection
        # against infinite loops via pattern-based intervention.
        #
        # Sandbox tools: graphton creates platform tool wrappers (read, write,
        # edit, execute, ls, glob, grep) backed by the sandbox. deepagents also
        # creates in-memory filesystem tools (read_file, write_file, edit_file)
        # via its FilesystemMiddleware. Both sets coexist in the tool registry.
        agent_graph = create_deep_agent(
            model=llm_model,
            system_prompt=enhanced_system_prompt,
            mcp_servers=mcp_servers_config if mcp_servers_config else None,
            mcp_tools=mcp_tools_config if mcp_tools_config else None,
            tools=None,
            subagents=transformed_subagents,
            sandbox_config=sandbox_config_for_agent,
            recursion_limit=1000,
            checkpointer=checkpointer,
            approval_checker=approval_checker,
            summarization_config=summarization_config,
            summarization_callback=status_builder,
        )
        
        activity_logger.info(f"Graphton agent created successfully with {'new' if is_new_sandbox else 'reused'} sandbox")
        
        # Heartbeat after agent creation to prevent timeout during setup
        heartbeat_during_setup("agent_created", {
            "model": api_model_id,
            "sandbox_new": is_new_sandbox,
            "has_subagents": transformed_subagents is not None and len(transformed_subagents) > 0,
        })
        
        # Step 7: Prepare invocation input
        # Append organization context to message
        context_section = f"\n\n---\nContext:\n- Organization: {execution.metadata.org}"
        message_with_context = user_message + context_section
        
        langgraph_input = {
            "messages": [{"role": "user", "content": message_with_context}]
        }
        
        # Prepare config with thread_id for state persistence.
        #
        # recursion_limit is set here as defense-in-depth. The primary limit
        # is applied via graphton's with_config() during agent creation, but
        # setting it at invoke-time ensures the limit is enforced even if the
        # graph's default config is somehow lost during config merging.
        # Note: LangGraph's merge_configs strips recursion_limit values equal
        # to DEFAULT_RECURSION_LIMIT (10,000), but 1000 != 10,000 so this
        # value is preserved.
        config = {
            "recursion_limit": 1000,
            "configurable": {
                "thread_id": thread_id,
                "org": execution.metadata.org,
            },
        }
        
        activity_logger.info(
            f"Using thread_id: {thread_id} for Graphton execution {execution_id}"
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 7.5: Check for Resume from HITL Approval (Batch Approval)
        #
        # If the workflow passed approval_decisions, it means the execution was
        # previously interrupted for approval (WAITING_FOR_APPROVAL) and the user
        # has submitted decisions.  We correlate the decisions (passed as activity
        # args — small, bounded) with pending_approvals from the DB-fetched
        # execution status (which has interrupt_ids) to build the LangGraph
        # Command(resume={id_A: decision_A, ...}) dict.
        #
        # With **Batch Approval**, the LLM may have issued N tool calls that each
        # required approval.  All N decisions are collected before the Temporal
        # workflow re-invokes this activity.  We build a dict that maps each
        # LangGraph interrupt_id to its decision value and pass it as a single
        #   Command(resume={id_A: decision_A, id_B: decision_B, ...})
        # so the graph processes every interrupt in one re-execution of the
        # tools node — avoiding repeated node re-runs and idempotency issues.
        # ─────────────────────────────────────────────────────────────────────────────
        
        resume_decision: dict[str, Any] | None = None
        is_resume_from_approval = False
        
        # Proto enum → action string for interrupt resume values
        _action_map = {
            ApprovalAction.APPROVAL_ACTION_APPROVE: "approve",
            ApprovalAction.APPROVAL_ACTION_SKIP: "skip",
            ApprovalAction.APPROVAL_ACTION_REJECT: "reject",
        }
        
        # --- Build resume dict from approval_decisions + pending_approvals -------
        #
        # approval_decisions: passed by the workflow as activity args (small payload)
        #   Each SubmitApprovalInput has: tool_call_id, action, comment
        #
        # pending_approvals: fetched from the DB-persisted execution status
        #   Each PendingApproval has: tool_call_id, interrupt_id, tool_name, ...
        #
        # We join on tool_call_id to pair each decision with its interrupt_id.
        if approval_decisions:
            # Index decisions by tool_call_id for O(1) lookup
            decisions_by_tool_call: dict[str, SubmitApprovalInput] = {
                d.tool_call_id: d for d in approval_decisions
            }
            
            pending_approvals = list(execution.status.pending_approvals)
            resume_dict: dict[str, dict[str, str]] = {}
            
            for pa in pending_approvals:
                decision = decisions_by_tool_call.get(pa.tool_call_id)
                if not decision:
                    # No decision for this pending approval — shouldn't happen
                    # because the workflow collects all signals before re-invoking,
                    # but handle gracefully.
                    activity_logger.warning(
                        f"⚠️ pending_approvals entry tool_call_id={pa.tool_call_id} "
                        f"has no matching approval_decision. Skipping batch resume."
                    )
                    resume_dict = {}
                    break
                
                action_str = _action_map.get(decision.action, "unknown")
                decision_value = {"action": action_str}
                if decision.comment:
                    decision_value["comment"] = decision.comment
                
                if pa.interrupt_id:
                    # Batch path: map interrupt_id → decision
                    resume_dict[pa.interrupt_id] = decision_value
                else:
                    # Legacy entry without interrupt_id — fall back to single-
                    # decision resume below.
                    activity_logger.warning(
                        f"⚠️ pending_approvals entry tool_call_id={pa.tool_call_id} "
                        f"has no interrupt_id. Falling back to single resume."
                    )
                    resume_dict = {}
                    break
            
            if resume_dict:
                is_resume_from_approval = True
                resume_decision = resume_dict
                activity_logger.info(
                    f"🔄 Batch resume from {len(resume_dict)} approval(s) for "
                    f"execution {execution_id}: "
                    + ", ".join(
                        f"interrupt_id={iid} action={d['action']}"
                        for iid, d in resume_dict.items()
                    )
                )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 7.6: Reconcile Loaded Status for Resume Path
        #
        # On resume, the StatusBuilder was initialized with the DB-persisted status
        # from the *previous* invocation.  That status contains tool calls that were
        # interrupted for approval with TOOL_CALL_WAITING_APPROVAL status — they
        # were never updated because the previous invocation ended at the interrupt.
        #
        # Without reconciliation, these stale WAITING_APPROVAL entries poison the
        # post-stream interrupt capture: when the next tool triggers an interrupt,
        # the capture code matches the interrupt to the stale entry (first hit in
        # the tool_calls list by tool_name + WAITING_APPROVAL) instead of the new
        # tool call.  The resulting PendingApproval carries the old tool_call_id,
        # which the CLI has already prompted for — so the approval prompt is skipped.
        #
        # We fix this by:
        # 1. Updating each approved/skipped/rejected tool call to a non-WAITING
        #    status so it cannot be matched by the interrupt capture code.
        # 2. Clearing the stale pending_approvals from the loaded status.
        # 3. Pre-populating StatusBuilder's fingerprint set from existing tool calls
        #    to prevent duplicate entries when LangGraph re-fires on_tool_start for
        #    resumed tools.
        # ─────────────────────────────────────────────────────────────────────────────
        if is_resume_from_approval and approval_decisions:
            # Map approval action enum to the appropriate ToolCallStatus
            _approval_to_tool_status = {
                ApprovalAction.APPROVAL_ACTION_APPROVE: ToolCallStatus.TOOL_CALL_RUNNING,
                ApprovalAction.APPROVAL_ACTION_SKIP: ToolCallStatus.TOOL_CALL_SKIPPED,
                ApprovalAction.APPROVAL_ACTION_REJECT: ToolCallStatus.TOOL_CALL_FAILED,
            }
            
            # Index decisions by tool_call_id for O(1) lookup
            decisions_by_tc = {d.tool_call_id: d for d in approval_decisions}
            
            reconciled_count = 0
            for tc in status_builder.current_status.tool_calls:
                if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                    continue
                decision = decisions_by_tc.get(tc.id)
                if decision is None:
                    continue
                new_status = _approval_to_tool_status.get(
                    decision.action, ToolCallStatus.TOOL_CALL_RUNNING
                )
                tc.status = new_status
                tc.approval_action = decision.action
                tc.approval_decided_at = _utc_timestamp()
                if decision.comment:
                    tc.approved_by = decision.comment
                reconciled_count += 1
                activity_logger.info(
                    f"[RESUME_RECONCILE] execution={execution_id} "
                    f"tool_call={tc.id} name={tc.name} "
                    f"WAITING_APPROVAL -> {ToolCallStatus.Name(new_status)}"
                )
            
            # Clear stale pending_approvals — they are no longer pending
            del status_builder.current_status.pending_approvals[:]
            
            # Pre-populate fingerprints from existing tool calls to prevent
            # duplicates when LangGraph re-fires on_tool_start for resumed tools
            status_builder.populate_fingerprints_from_existing_tool_calls()
            
            activity_logger.info(
                f"[RESUME_RECONCILE] execution={execution_id} "
                f"reconciled {reconciled_count} tool call(s), "
                f"cleared pending_approvals, "
                f"populated {len(status_builder.tool_call_fingerprints)} fingerprint(s)"
            )
        
        # Log total setup time before entering the streaming phase.
        # This is the boundary between "setup" and "execution" — any time
        # spent beyond this point is in the LangGraph streaming loop.
        setup_timer.stop()
        setup_timer.log_total()
        
        # Step 8: Set phase to IN_PROGRESS (status built locally)
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        activity_logger.info(f"Execution {execution_id} phase set to IN_PROGRESS (building locally)")
        
        # Step 9: Stream execution and build status from events
        # 
        # Streaming Update Strategy (Phase 1.2):
        # - Time-based updates: Send every 500ms minimum (configurable)
        # - Burst protection: Force update after 50 events (configurable)
        # - Keepalive: Send update every 5 seconds during long operations
        # 
        # This replaces the naive event-count based approach which caused:
        # - Poor UX for slow tools (no update for 30+ seconds)
        # - Wasteful updates during fast streaming (10+ updates/second)
        events_processed = 0
        last_heartbeat_time = time.monotonic()
        heartbeat_interval_ms = 2000  # Send heartbeat every 2 seconds
        
        # Initialize streaming update scheduler
        streaming_config = StreamingConfig.load_from_env()
        update_scheduler = StreamingUpdateScheduler(streaming_config)
        
        # gRPC timeout for progressive status updates inside the event loop.
        # Also used for the pre-stream status update on the resume path.
        # A hanging gRPC call blocks event processing and stalls the entire
        # activity.  Default: 10 seconds.
        _DEFAULT_GRPC_UPDATE_TIMEOUT_SECONDS = 10
        grpc_update_timeout_seconds = int(
            os.environ.get(
                "GRAPHTON_GRPC_UPDATE_TIMEOUT_SECONDS",
                _DEFAULT_GRPC_UPDATE_TIMEOUT_SECONDS,
            )
        )
        
        # Determine graph input based on whether this is a resume or fresh execution
        graph_input: Any  # Command[Any] | dict — depends on resume vs fresh execution
        if is_resume_from_approval and resume_decision is not None:
            # Resume from approval: use Command(resume=decision) to continue from
            # interrupt(s).  resume_decision is either:
            #   - dict[str, dict]: {interrupt_id -> decision} for batch / targeted resume
            #   - dict with "action" key: bare single-decision value (legacy)
            from langgraph.types import Command
            
            graph_input = Command(resume=resume_decision)
            
            # Build a human-readable summary for logging
            if isinstance(resume_decision, dict) and "action" not in resume_decision:
                # Batch form: {interrupt_id: decision, ...}
                summary = ", ".join(
                    f"{iid[:12]}...={d.get('action', '?')}"
                    for iid, d in resume_decision.items()
                )
                activity_logger.info(
                    f"🔄 Resuming Graphton agent (batch) for execution {execution_id} "
                    f"({len(resume_decision)} interrupt(s): {summary})"
                )
            else:
                activity_logger.info(
                    f"🔄 Resuming Graphton agent (legacy) for execution {execution_id} "
                    f"(decision={resume_decision.get('action', '?')})"
                )
        else:
            # Fresh execution: use normal input
            graph_input = langgraph_input
            activity_logger.info(
                f"🔍 Starting Graphton agent stream for execution {execution_id} "
                f"(streaming: min_interval={streaming_config.min_interval_ms}ms, "
                f"max_interval={streaming_config.max_interval_ms}ms, "
                f"burst_threshold={streaming_config.burst_threshold})"
            )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Pre-Stream Status Update (Resume Path)
        #
        # On the resume-after-approval path, send an immediate status update
        # to the database *before* entering the streaming loop.  This gives
        # the user visible feedback that their approval was received and the
        # agent is about to continue — eliminating the "black hole" feeling
        # when the agent takes time to produce its first event after resume.
        #
        # The update transitions the phase to IN_PROGRESS and appends a
        # system message so the UI can render a "Resuming..." indicator.
        # ─────────────────────────────────────────────────────────────────────────────
        if is_resume_from_approval:
            from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage
            from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
            
            resume_msg = AgentMessage(
                type=MessageType.MESSAGE_SYSTEM,
                content="✅ Approval received — resuming execution.",
                timestamp=_utc_timestamp(),
            )
            status_builder.current_status.messages.append(resume_msg)
            
            try:
                activity_logger.info(
                    "📤 [RESUME] Sending pre-stream IN_PROGRESS status update"
                )
                await asyncio.wait_for(
                    execution_client.update_status(
                        execution_id=execution_id,
                        status=status_builder.current_status,
                    ),
                    timeout=grpc_update_timeout_seconds,
                )
                activity_logger.info(
                    "✅ [RESUME] Pre-stream status update sent successfully"
                )
            except Exception as pre_update_err:
                # Non-fatal — the streaming loop will send updates anyway
                activity_logger.warning(
                    f"[RESUME] Pre-stream status update failed: {pre_update_err}"
                )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Pause/Resume Support (Gap A3)
        #
        # The activity can be cancelled gracefully by the Java workflow when a pause
        # signal is received. On cancellation:
        # 1. We check activity.is_cancelled() between events
        # 2. LangGraph automatically saves checkpoint (thread_id preserved)
        # 3. We return EXECUTION_PAUSED status instead of failing
        # 4. On resume, workflow re-invokes activity with same thread_id
        # 5. LangGraph loads checkpoint and continues from where it left off
        # ─────────────────────────────────────────────────────────────────────────────
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Background Heartbeat Task
        #
        # During astream_events(), heartbeats are only sent when events arrive.
        # But when the LLM is "thinking" (processing a long prompt before generating
        # output), no events are emitted — this gap can exceed the 30-second Temporal
        # heartbeat timeout, causing Temporal to kill the activity.
        #
        # This background task sends heartbeats at a fixed 10-second interval,
        # independent of event arrival. It runs concurrently with the event stream
        # and is cancelled when the stream completes (or errors).
        # ─────────────────────────────────────────────────────────────────────────────
        async def _background_heartbeat() -> None:
            """Send periodic heartbeats to Temporal, independent of event stream."""
            background_heartbeat_interval = 10.0  # seconds (well within 30s timeout)
            while True:
                await asyncio.sleep(background_heartbeat_interval)
                try:
                    activity.heartbeat({
                        "thread_id": thread_id,
                        "paused": activity.is_cancelled(),
                        "events_processed": events_processed,
                        "messages": len(status_builder.current_status.messages),
                        "tool_calls": len(status_builder.current_status.tool_calls),
                        "phase": status_builder.current_status.phase,
                        "source": "background",
                    })
                except Exception as hb_err:
                    # Heartbeat failure is not critical — log at debug level and continue.
                    # The in-loop heartbeat (when events arrive) provides redundancy.
                    activity_logger.debug(f"Background heartbeat failed: {hb_err}")
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Stall Detection Timeout
        #
        # Detects when the agent stream produces no events for an extended period.
        # This is distinct from Temporal's startToCloseTimeout (hard cap on total
        # activity duration) — this catches the specific case where the LLM hangs,
        # a tool blocks, or the graph enters an infinite wait state.
        #
        # The deadline is **reset on every event**, so a busy agent that is making
        # progress will never hit this timeout regardless of how long the total
        # execution takes.
        #
        # Default: 300 seconds (5 minutes).  Configurable via env var.
        # ─────────────────────────────────────────────────────────────────────────────
        _DEFAULT_STALL_TIMEOUT_SECONDS = 300
        stall_timeout_seconds = int(
            os.environ.get("GRAPHTON_STALL_TIMEOUT_SECONDS", _DEFAULT_STALL_TIMEOUT_SECONDS)
        )
        
        activity_logger.info(
            f"[STALL_GUARD] Stall detection timeout: {stall_timeout_seconds}s "
            f"(resets on every event), "
            f"gRPC update timeout: {grpc_update_timeout_seconds}s"
        )
        
        heartbeat_task: asyncio.Task[None] | None = None
        try:
            heartbeat_task = asyncio.create_task(_background_heartbeat())
            
            async with asyncio.timeout(stall_timeout_seconds) as stall_deadline:
                async for event in agent_graph.astream_events(
                    graph_input,
                    config=config,  # type: ignore[arg-type]  # LangGraph accepts dict config at runtime
                    version="v2",  # Use v2 schema for consistent event structure
                ):
                    # Reset stall deadline — the agent is making progress.
                    stall_deadline.reschedule(
                        asyncio.get_event_loop().time() + stall_timeout_seconds
                    )
                    
                    # ─────────────────────────────────────────────────────────────────
                    # Check for pause (activity cancellation) between events
                    # This allows graceful checkpoint save before exiting
                    # ─────────────────────────────────────────────────────────────────
                    if activity.is_cancelled():
                        activity_logger.info(
                            f"⏸️ PAUSE: Activity cancelled for execution {execution_id}, "
                            f"saving checkpoint (thread_id={thread_id})"
                        )
                        # LangGraph automatically saves checkpoint on iteration
                        # Raise CancelledError to exit the loop gracefully
                        raise asyncio.CancelledError("Paused by user")
                    
                    # Process event locally (builds status in memory)
                    await status_builder.process_event(event)  # type: ignore[arg-type]
                    
                    events_processed += 1
                    
                    # Send activity heartbeat to prevent Temporal timeout
                    # Time-based: every 2 seconds (independent of status updates)
                    # 
                    # CRASH RECOVERY: Heartbeat includes thread_id for checkpoint resume
                    # On retry, we extract thread_id from heartbeat_details to resume from
                    # the LangGraph checkpoint instead of restarting from the beginning.
                    # 
                    # PAUSE/RESUME: Heartbeat includes paused flag for resume detection
                    now = time.monotonic()
                    time_since_heartbeat_ms = (now - last_heartbeat_time) * 1000
                    if time_since_heartbeat_ms >= heartbeat_interval_ms:
                        try:
                            activity.heartbeat({
                                "thread_id": thread_id,  # For checkpoint resume on retry/resume
                                "paused": activity.is_cancelled(),  # For pause detection
                                "events_processed": events_processed,
                                "messages": len(status_builder.current_status.messages),
                                "tool_calls": len(status_builder.current_status.tool_calls),
                                "phase": status_builder.current_status.phase,
                            })
                            last_heartbeat_time = now
                        except Exception as e:
                            # Heartbeat failure is not critical - log and continue
                            activity_logger.debug(f"Heartbeat failed (event {events_processed}): {e}")
                    
                    # Send progressive status update via gRPC using hybrid scheduler
                    # Triggers on: time threshold (500ms), burst (50 events), or keepalive (5s)
                    if update_scheduler.should_send_update(events_processed):
                        reason = update_scheduler.get_update_reason_str()
                        time_since_last = update_scheduler.get_time_since_last_update_ms()
                        events_since_last = update_scheduler.get_events_since_last_update(events_processed)
                        
                        try:
                            activity_logger.info(
                                f"[STREAM] execution={execution_id} "
                                f"update_sent=true "
                                f"reason={reason} "
                                f"events_total={events_processed} "
                                f"events_since_last={events_since_last} "
                                f"time_since_last_ms={time_since_last:.0f} "
                                f"messages={len(status_builder.current_status.messages)} "
                                f"tool_calls={len(status_builder.current_status.tool_calls)}"
                            )
                            
                            # Call stigmer-service updateStatus endpoint (merges status).
                            # Wrapped in wait_for() to prevent a hanging gRPC call
                            # from blocking the event processing loop indefinitely.
                            await asyncio.wait_for(
                                execution_client.update_status(
                                    execution_id=execution_id,
                                    status=status_builder.current_status,
                                ),
                                timeout=grpc_update_timeout_seconds,
                            )
                            
                            update_scheduler.mark_update_sent(events_processed)
                            
                        except asyncio.TimeoutError:
                            # gRPC call exceeded the configured timeout — skip this
                            # update and continue processing events.  The next
                            # scheduled update will try again.
                            activity_logger.warning(
                                f"[STREAM] execution={execution_id} "
                                f"update_sent=false "
                                f"reason=grpc_timeout "
                                f"timeout_seconds={grpc_update_timeout_seconds}"
                            )
                            update_scheduler.mark_update_sent(events_processed)
                        except Exception as e:
                            # Log but don't fail - keep processing events
                            # Still mark as sent to avoid retry storm on persistent failures
                            activity_logger.warning(
                                f"[STREAM] execution={execution_id} "
                                f"update_sent=false "
                                f"reason={reason} "
                                f"error={str(e)}"
                            )
                            update_scheduler.mark_update_sent(events_processed)
                    
                        # Log progress periodically (every 50 events for reduced noise)
                        if events_processed % 50 == 0:
                            activity_logger.debug(f"Processed {events_processed} events")
        
        except asyncio.CancelledError:
            # ─────────────────────────────────────────────────────────────────────────────
            # Graceful Pause Handling (Gap A3)
            #
            # Activity was cancelled (paused by user). LangGraph has already saved
            # the checkpoint automatically. We return EXECUTION_PAUSED status so the
            # workflow knows this is a pause, not a failure.
            #
            # On resume:
            # 1. Workflow sends resume signal
            # 2. Workflow re-invokes this activity with same execution/thread_id
            # 3. LangGraph loads checkpoint via thread_id
            # 4. Agent continues from where it was paused
            # ─────────────────────────────────────────────────────────────────────────────
            activity_logger.info(
                f"⏸️ Graceful pause for execution {execution_id} - checkpoint saved "
                f"(thread_id={thread_id}, events_processed={events_processed})"
            )
            
            # Finalize context info before returning (capture any accumulated data)
            status_builder.finalize_context_info()
            
            # Set phase to PAUSED (not FAILED - this is a pause, not an error)
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_PAUSED
            
            # Add message indicating pause
            from datetime import datetime

            from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage
            from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
            
            pause_msg = AgentMessage(
                type=MessageType.MESSAGE_SYSTEM,
                content="⏸️ Execution paused by user. Use resume to continue from this checkpoint.",
                timestamp=_utc_timestamp(),
            )
            status_builder.current_status.messages.append(pause_msg)
            
            # Send paused status update via gRPC (best effort)
            try:
                activity_logger.info("📤 [PAUSE] Sending PAUSED status update")
                await execution_client.update_status(
                    execution_id=execution_id,
                    status=status_builder.current_status
                )
                activity_logger.info("✅ [PAUSE] Status update sent successfully")
            except Exception as update_error:
                activity_logger.warning(f"[PAUSE] Failed to send status update: {update_error}")
                # Continue - status will be returned to workflow anyway
            
            activity_logger.info(
                f"⏸️ Returning PAUSED status to workflow for execution {execution_id}"
            )
            
            # Return paused status to workflow
            return status_builder.current_status
        except TimeoutError:
            # ─────────────────────────────────────────────────────────────────────────────
            # Stall Detection: No events received within the stall timeout window.
            #
            # This means the LLM, a tool execution, or the graph itself has been
            # unresponsive for longer than stall_timeout_seconds.  We treat this as
            # a hard failure (not a pause) so the workflow can surface the error to
            # the user rather than silently retrying.
            # ─────────────────────────────────────────────────────────────────────────────
            stall_msg = (
                f"Agent stream stalled: no events received for "
                f"{stall_timeout_seconds}s after processing {events_processed} events. "
                f"The LLM or a tool may be hanging."
            )
            activity_logger.error(
                f"⏱️ [STALL] execution={execution_id} — {stall_msg}"
            )
            
            # Finalize any accumulated data before reporting failure
            status_builder.finalize_context_info()
            
            from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage
            from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
            
            stall_error_msg = AgentMessage(
                type=MessageType.MESSAGE_SYSTEM,
                content=(
                    f"⏱️ Execution timed out: the agent produced no output for "
                    f"{stall_timeout_seconds} seconds. This typically means the LLM "
                    f"or a tool stopped responding. The execution has been stopped."
                ),
                timestamp=_utc_timestamp(),
            )
            status_builder.current_status.messages.append(stall_error_msg)
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
            status_builder.current_status.error = stall_msg
            
            # Best-effort status persistence
            try:
                activity_logger.info("📤 [STALL] Sending FAILED status update")
                await execution_client.update_status(
                    execution_id=execution_id,
                    status=status_builder.current_status,
                )
            except Exception as update_err:
                activity_logger.warning(f"[STALL] Failed to send status update: {update_err}")
            
            return status_builder.current_status
        finally:
            # Always cancel the background heartbeat task — whether the stream
            # completed normally, was paused (CancelledError), or raised an error.
            if heartbeat_task is not None:
                heartbeat_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await heartbeat_task
        
        # Verify stream processed data
        if events_processed == 0:
            raise RuntimeError(
                "Graphton stream completed without processing any events. "
                "This may indicate a configuration error."
            )
        
        activity_logger.info(
            f"📊 Execution {execution_id} stream finished — processed {events_processed} events"
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Post-Stream Validation: Detect silent completions
        #
        # When the LangGraph stream ends naturally, it typically means the LLM
        # produced a final response. However, if the last message in the status
        # is a tool message (not an AI message), the graph may have terminated
        # abnormally — the user sees tool output followed by immediate completion
        # with no summary. Log a warning for observability so we can track and
        # diagnose these cases.
        #
        # Similarly, if no artifacts were published, log a notice. This is not
        # always an error (some executions don't produce artifacts), but it helps
        # when debugging "where did my files go?" issues.
        # ─────────────────────────────────────────────────────────────────────────────
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType

        messages = status_builder.current_status.messages
        if messages:
            last_message = messages[-1]
            if last_message.type == MessageType.MESSAGE_TOOL:
                activity_logger.warning(
                    f"[POST_STREAM] execution={execution_id} — Stream ended with a tool "
                    f"message as the last message (tool_calls={len(last_message.tool_calls)}). "
                    f"The agent may not have produced a final summary for the user. "
                    f"This typically means the LLM's post-tool response was empty or the "
                    f"graph terminated before routing back to the LLM."
                )

        if not status_builder._artifacts:
            activity_logger.info(
                f"[POST_STREAM] execution={execution_id} — No artifacts were published. "
                f"Checking for modified files to auto-publish."
            )
            
            # ─────────────────────────────────────────────────────────────────
            # Auto-Publish Safety Net
            #
            # When the agent created or modified files via write, write_file,
            # edit, or edit_file tool calls but no artifacts were published
            # during execution, the user receives no downloadable output.
            # Rather than depending on LLM compliance with a multi-step
            # workflow, the platform automatically publishes all affected
            # files as artifacts after the stream completes.
            #
            # The safety net only fires when ALL of these conditions hold:
            #   1. Zero artifacts were published during the execution.
            #   2. At least one file-modifying tool call completed.
            #   3. The execution is completing normally (not failed/paused).
            #
            # Note: The execute tool (shell commands) and MCP tools are
            # excluded — they lack a path parameter, so affected files
            # cannot be reliably identified.
            # ─────────────────────────────────────────────────────────────────
            current_phase = status_builder.current_status.phase
            if current_phase not in (
                ExecutionPhase.EXECUTION_FAILED,
                ExecutionPhase.EXECUTION_PAUSED,
                ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
            ):
                try:
                    await _auto_publish_written_files(
                        tool_calls=status_builder.current_status.tool_calls,
                        sandbox=sandbox,
                        storage=artifact_storage,
                        execution_id=execution_id,
                        status_builder=status_builder,
                        local_root=(
                            sandbox_config.get("root_dir")
                            if worker_config.is_local_mode()
                            else None
                        ),
                        logger=activity_logger,
                    )
                except Exception as auto_pub_err:
                    activity_logger.warning(
                        f"[AUTO_PUBLISH] execution={execution_id} — "
                        f"auto-publish failed (non-fatal): {auto_pub_err}"
                    )
        
        # Finalize context info before returning (Phase 3)
        # Copies accumulated context info and summarization events to status proto
        status_builder.finalize_context_info()
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Post-Stream Interrupt Capture (Batch Approval — Multiple Interrupts)
        #
        # When the event stream ends because of interrupt() calls, LangGraph has
        # already checkpointed the graph state with pending interrupts.  We query
        # the graph state to discover ALL pending interrupts (there may be more
        # than one when the LLM issued multiple tool calls that each require
        # approval).
        #
        # For every interrupt we build a PendingApproval proto with the
        # LangGraph-assigned interrupt_id.  This enables the resume logic to
        # construct Command(resume={id_A: decision_A, ...}) which LangGraph
        # requires when multiple interrupts coexist.
        # ─────────────────────────────────────────────────────────────────────────────
        if status_builder.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
            try:
                graph_state = await agent_graph.aget_state(config)
                
                if graph_state and graph_state.interrupts:
                    pending_approvals: list[PendingApproval] = []
                    matched_tc_ids: set[str] = set()
                    
                    for intr in graph_state.interrupts:
                        intr_value = intr.value if hasattr(intr, "value") else {}
                        tool_name = intr_value.get("tool_name", "") if isinstance(intr_value, dict) else ""
                        tool_args = intr_value.get("tool_args", {}) if isinstance(intr_value, dict) else {}
                        message = intr_value.get("message", "") if isinstance(intr_value, dict) else ""
                        from_sub_agent = intr_value.get("from_sub_agent", False) if isinstance(intr_value, dict) else False
                        sub_agent_name = intr_value.get("sub_agent_name", "") if isinstance(intr_value, dict) else ""
                        
                        # Match interrupt to a tool call by tool_name + WAITING_APPROVAL
                        # status. Track already-matched IDs to handle multiple calls to
                        # the same tool (e.g., two writes to different files).
                        #
                        # Alias-aware matching: the interrupt payload uses the canonical
                        # tool name (e.g. "write") while the tool call may have been
                        # registered under an alias (e.g. "write_file").  Resolve both
                        # sides to canonical names before comparing.
                        matched_tool_call_id = ""
                        for tc in status_builder.current_status.tool_calls:
                            tc_canonical = resolve_platform_tool_name(tc.name)
                            if (
                                (tc.name == tool_name or tc_canonical == tool_name)
                                and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                                and tc.id not in matched_tc_ids
                            ):
                                matched_tool_call_id = tc.id
                                matched_tc_ids.add(tc.id)
                                break
                        
                        # Create args preview via StatusBuilder's sanitiser
                        args_preview = status_builder._create_args_preview(tool_args)
                        
                        pa = PendingApproval(
                            tool_call_id=matched_tool_call_id,
                            tool_name=tool_name,
                            message=message,
                            args_preview=args_preview,
                            requested_at=_utc_timestamp(),
                            from_sub_agent=from_sub_agent,
                            sub_agent_name=sub_agent_name,
                            interrupt_id=intr.id,
                        )
                        pending_approvals.append(pa)
                    
                    if pending_approvals:
                        # Populate the repeated field with all pending approvals
                        del status_builder.current_status.pending_approvals[:]
                        status_builder.current_status.pending_approvals.extend(pending_approvals)
                        
                        activity_logger.info(
                            f"[INTERRUPT_CAPTURE] execution={execution_id} "
                            f"captured {len(pending_approvals)} pending interrupt(s): "
                            + ", ".join(
                                f"tool={pa.tool_name} interrupt_id={pa.interrupt_id}"
                                for pa in pending_approvals
                            )
                        )
                else:
                    activity_logger.debug(
                        f"[INTERRUPT_CAPTURE] execution={execution_id} "
                        f"WAITING_FOR_APPROVAL phase but no interrupts in graph state."
                    )
            except Exception as capture_err:
                # Non-fatal: if we can't capture interrupt IDs, the existing
                # pending_approvals from the status_builder will be used (they
                # may lack interrupt_id but will still work for single-interrupt
                # scenarios).
                activity_logger.warning(
                    f"[INTERRUPT_CAPTURE] execution={execution_id} "
                    f"failed to capture interrupt IDs from graph state: {capture_err}."
                )
        
        # Determine final phase based on current state.
        #
        # When LangGraph's interrupt() is called (HITL approval), the event stream
        # ends naturally — the graph pauses at a checkpoint, producing no more events.
        # The status_builder will have already set the phase to WAITING_FOR_APPROVAL
        # during event processing. We must NOT overwrite that phase with COMPLETED,
        # because the Temporal workflow uses the returned phase to decide whether to
        # enter the HITL approval loop.
        #
        # Similarly, if the phase is PAUSED (set during graceful cancellation handling
        # above), we must preserve it.
        current_phase = status_builder.current_status.phase
        
        if current_phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
            activity_logger.info(
                f"Stream ended with WAITING_FOR_APPROVAL phase for execution {execution_id}. "
                f"Not setting COMPLETED — execution is paused at interrupt checkpoint."
            )
        elif current_phase == ExecutionPhase.EXECUTION_PAUSED:
            activity_logger.info(
                f"Stream ended with PAUSED phase for execution {execution_id}. "
                f"Not setting COMPLETED — execution is paused at checkpoint."
            )
        else:
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED
        
        final_phase_name = ExecutionPhase.Name(status_builder.current_status.phase)
        
        # Send final status update via gRPC with retry.
        # This is critical for data persistence — use retry to handle transient failures.
        # The update is sent regardless of phase so that the latest messages, tool_calls,
        # and context info are always persisted.
        try:
            activity_logger.info(
                f"📤 [FINAL] Sending {final_phase_name} status update with retry"
            )
            await retry_executor.execute(
                operation=lambda: execution_client.update_status(
                    execution_id=execution_id,
                    status=status_builder.current_status
                ),
                operation_name="final_status_update",
                context={"execution_id": execution_id, "phase": final_phase_name},
            )
            activity_logger.info(f"✅ [FINAL] Status update sent successfully (phase={final_phase_name})")
        except GrpcRetryExhaustedError as e:
            activity_logger.error(
                f"[FINAL] All retries exhausted for status update: {e.attempts} attempts, "
                f"{e.total_duration_ms:.0f}ms total. Last error: {e.last_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except GrpcNonRetryableError as e:
            activity_logger.error(
                f"[FINAL] Non-retryable error on status update: {e.status_code.name} - {e.original_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except Exception as e:
            activity_logger.error(f"[FINAL] Unexpected error on status update: {e}")
            # Continue - we'll still return status to workflow as fallback
        
        # Diagnostic logging for final status
        activity_logger.info("=" * 80)
        activity_logger.info(f"📊 [FINAL_STATUS] Execution {execution_id}:")
        activity_logger.info(f"   messages: {len(status_builder.current_status.messages)}")
        activity_logger.info(f"   tool_calls: {len(status_builder.current_status.tool_calls)}")
        activity_logger.info(f"   sub_agent_executions: {len(status_builder.current_status.sub_agent_executions)}")
        activity_logger.info(f"   todos: {len(status_builder.current_status.todos)}")
        activity_logger.info(f"   phase: {ExecutionPhase.Name(status_builder.current_status.phase)}")
        activity_logger.info("=" * 80)
        
        activity_logger.info(
            "✅ ExecuteGraphton completed - returning status to workflow for persistence"
        )
        
        # Verify status is not None before returning
        if status_builder.current_status is None:
            activity_logger.error(f"❌ CRITICAL: current_status is None for execution {execution_id}")
            raise RuntimeError("Status builder returned None - this should never happen")
        
        activity_logger.info(
            f"✅ Returning AgentExecutionStatus to workflow: "
            f"type={type(status_builder.current_status).__name__}, "
            f"is_none={status_builder.current_status is None}"
        )
        
        # Return final status to workflow (workflow will call Java persistence activity)
        return status_builder.current_status
    
    except Exception as e:
        # Capture the full exception context for diagnostics.  str(e) alone
        # is often cryptic (e.g. a bare field name like "size_bytes") —
        # the exception type and traceback are essential for root-cause analysis.
        exc_type = type(e).__name__
        exc_tb = traceback.format_exc()
        activity_logger.error(
            f"ExecuteGraphton failed for execution {execution_id}: "
            f"[{exc_type}] {e}\n{exc_tb}"
        )
        
        # Build a human-readable error message that includes the exception type
        # so cryptic bare-string exceptions are at least classifiable.
        error_str = str(e)
        error_message = f"Execution failed: [{exc_type}] {error_str}"
        
        # Import required types for error message
        from datetime import datetime

        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
        
        error_msg = AgentMessage(
            type=MessageType.MESSAGE_SYSTEM,
            content=f"❌ Error: {error_message}",
            timestamp=_utc_timestamp(),
        )
        
        # Check if status_builder was initialized before the error occurred
        # If not, create a minimal failed status (handles early failures like attachment injection)
        if status_builder is not None:
            # Use status_builder for rich error reporting
            status_builder.current_status.messages.append(error_msg)
            
            # Finalize context info before returning (Phase 3)
            # Even on failure, we want to capture any context tracking data
            status_builder.finalize_context_info()
            
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
            status_builder.current_status.error = error_message
            failed_status = status_builder.current_status
        else:
            # Early failure before status_builder was created
            # Create minimal failed status (similar to outer handler)
            activity_logger.warning(
                f"status_builder not initialized - creating minimal failed status for {execution_id}"
            )
            failed_status = AgentExecutionStatus(
                phase=ExecutionPhase.EXECUTION_FAILED,
                error=error_message,
                messages=[
                    error_msg,
                    AgentMessage(
                        type=MessageType.MESSAGE_SYSTEM,
                        content="Execution failed during initialization before agent could start.",
                        timestamp=_utc_timestamp(),
                    )
                ]
            )
        
        activity_logger.info(f"Execution {execution_id} phase set to FAILED - returning error status to workflow")
        
        # Verify status is not None before returning
        if failed_status is None:
            activity_logger.error(f"❌ CRITICAL: failed_status is None in error handler for execution {execution_id}")
            raise RuntimeError("Failed status is None in error handler - this should never happen")
        
        # Send failed status update via gRPC with retry
        # This is critical for data persistence - use retry to handle transient failures
        try:
            activity_logger.info("📤 [FINAL] Sending FAILED status update with retry")
            await retry_executor.execute(
                operation=lambda: execution_client.update_status(
                    execution_id=execution_id,
                    status=failed_status
                ),
                operation_name="final_status_update",
                context={"execution_id": execution_id, "phase": "FAILED"},
            )
            activity_logger.info("✅ [FINAL] Failed status update sent successfully")
        except GrpcRetryExhaustedError as retry_err:
            activity_logger.error(
                f"[FINAL] All retries exhausted for failed status update: {retry_err.attempts} attempts, "
                f"{retry_err.total_duration_ms:.0f}ms total. Last error: {retry_err.last_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except GrpcNonRetryableError as grpc_err:
            activity_logger.error(
                f"[FINAL] Non-retryable error on failed status update: {grpc_err.status_code.name} - {grpc_err.original_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except Exception as update_error:
            activity_logger.error(f"[FINAL] Unexpected error on failed status update: {update_error}")
            # Continue - we'll still return status to workflow as fallback
        
        activity_logger.info(
            f"✅ Returning failed AgentExecutionStatus to workflow: "
            f"type={type(failed_status).__name__}"
        )
        
        # Return failed status to workflow (already persisted via gRPC above)
        return failed_status
    
    finally:
        # Clean up checkpointer resources (SQLite connection, MongoDB client, etc.)
        # This runs regardless of success or failure, ensuring no resource leaks.
        await exit_stack.aclose()
