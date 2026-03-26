"""Temporal activity for executing Graphton agents."""

import asyncio
import contextlib
import functools
import logging
import os
import time
import traceback
from collections.abc import Callable
from typing import Any, TypeVar, cast

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import PendingApproval
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    MessageType,
    SubAgentStatus,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import (
    ApprovalDecisionList,
    SubmitApprovalInput,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import AgentMessage
from graphton import SummarizationConfig, create_deep_agent
from graphton.core import ModelRegistry
from graphton.core.backends.platform_mount import (
    humanize_platform_refs,
    resolve_display_env_vars,
)
from langchain_core.runnables import RunnableConfig
from temporalio import activity

from grpc_client.agent_client import AgentClient
from grpc_client.agent_execution_client import AgentExecutionClient
from grpc_client.agent_instance_client import AgentInstanceClient
from grpc_client.channel import ChannelProvider
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
from worker.activities.graphton.session_context_merge import (
    merge_mcp_server_usages,
    merge_skill_refs,
)
from worker.activities.graphton.skill_writer import SkillWriter
from worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp
from worker.activities.graphton.subagent_transformer import transform_sub_agents
from worker.activities.relevance import (
    WorkspaceRoot,
    build_relevance_prompt_section,
)
from worker.checkpointer import create_checkpointer
from worker.mcp import transform_all_mcp_configs
from worker.resilience import (
    GrpcNonRetryableError,
    GrpcRetryExecutor,
    GrpcRetryExhaustedError,
    RetryConfig,
)
from worker.sandbox_manager import SandboxManager
from worker.storage import ArtifactStorage, create_artifact_storage
from worker.streaming import StreamingConfig, StreamingUpdateScheduler
from worker.token_manager import get_api_key
from worker.tools import publish_artifact
from worker.workspace import (
    GitMetadata,
    LocalWorkspaceBackend,
    ProvisionResult,
    SourceType,
    WorkspaceBackend,
    WorkspaceProvisioner,
    WorkspaceProvisionError,
    initialize_workspace,
)
from worker.workspace.tree import (
    TREE_DEFAULT_MAX_ENTRIES as _TREE_MAX_ENTRIES,
)
from worker.workspace.tree import (
    build_directory_tree as _build_directory_tree,
)
from worker.workspace.tree import (
    human_size as _human_size,
)


def _slim_status_for_temporal(status: AgentExecutionStatus) -> AgentExecutionStatus:
    """Build a slim copy of the status for the Temporal activity return value.

    The full status (messages, tool_calls, sub_agent_executions, etc.) is
    already persisted to the database via progressive gRPC updates during
    execution.  Returning only the workflow-critical fields keeps the
    Temporal payload well under the ~2 MB limit.

    Kept: phase, pending_approvals, error, usage, started_at, completed_at.
    Stripped: messages, tool_calls, sub_agent_executions, todos, artifacts,
              context_info, resolved_context, callback_token.
    """
    slim = AgentExecutionStatus(
        phase=status.phase,
        error=status.error,
        started_at=status.started_at,
        completed_at=status.completed_at,
    )
    for pa in status.pending_approvals:
        slim.pending_approvals.append(pa)
    if status.HasField("usage"):
        slim.usage.CopyFrom(status.usage)
    return slim


def _try_enrich_phase1_entry(
    status_builder: StatusBuilder,
    tool_name: str,
    from_sub_agent: bool,
    interrupt_id: str,
) -> bool:
    """Fallback enrichment when the interrupt could not be matched by run_id or name.

    Searches ``current_status.pending_approvals`` for a Phase 1 entry that
    matches ``tool_name`` and does not already have an ``interrupt_id``.

    Two passes:
      1. Strict — matches ``tool_name`` + ``from_sub_agent``.
      2. Relaxed — matches ``tool_name`` only, ignoring ``from_sub_agent``.
         This handles the case where the interrupt payload carries
         ``from_sub_agent=False`` but Phase 1 correctly recorded ``True``
         (or vice-versa due to legacy wrappers).

    If found, sets the ``interrupt_id`` on that entry and returns True.

    This handles the case where the interrupt-to-tool-call matching (run_id or
    scoped name search) fails — typically because the sub-agent's tool call
    wasn't reachable via the standard matching paths.  Rather than creating a
    degraded PendingApproval with empty ``tool_call_id`` (which triggers the
    "clear" sentinel in the controller merge logic), we preserve the Phase 1
    entry's valid ``tool_call_id`` and graft the ``interrupt_id`` onto it.
    """
    # Pass 1: strict match (tool_name + from_sub_agent)
    for pa in status_builder.current_status.pending_approvals:
        if (
            pa.tool_name == tool_name
            and pa.from_sub_agent == from_sub_agent
            and not pa.interrupt_id
        ):
            pa.interrupt_id = interrupt_id
            return True
    # Pass 2: relaxed match (tool_name only, ignore from_sub_agent)
    for pa in status_builder.current_status.pending_approvals:
        if pa.tool_name == tool_name and not pa.interrupt_id:
            pa.interrupt_id = interrupt_id
            return True
    return False


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
    """Send a heartbeat with setup-phase context between discrete setup steps.

    The ExecuteGraphton activity is configured with a **2-minute**
    heartbeat timeout (``HeartbeatTimeout`` in
    ``InvokeAgentExecutionWorkflowImpl.java``).  Calling this function
    between setup steps (Steps 1-8) ensures Temporal sees liveness
    signals during initialisation.

    For long-running *blocking* operations within a single step (e.g.,
    git clone via Daytona), use :func:`_run_sync_with_heartbeat` instead
    — it dispatches the work to a thread and heartbeats continuously
    while waiting.

    Args:
        phase_name: Human-readable name of the current setup phase
            (e.g., ``"chain_resolution"``).
        details: Optional dict with additional context (e.g., counts, IDs).
    """
    activity.heartbeat({
        "setup_phase": phase_name,
        "details": details or {},
    })


# ─────────────────────────────────────────────────────────────────────────────
# Async wrapper for long-running synchronous operations
# ─────────────────────────────────────────────────────────────────────────────

_T = TypeVar("_T")

_HEARTBEAT_INTERVAL_S: float = 30.0
"""Default interval (seconds) between heartbeats while waiting for a
synchronous callable.  Must be well below the Temporal HeartbeatTimeout
(currently 2 minutes) to guarantee at least 3 heartbeats per window."""

_heartbeat_logger = logging.getLogger(f"{__name__}.sync_heartbeat")


async def _run_sync_with_heartbeat(
    fn: Callable[..., _T],
    *args: Any,
    heartbeat_interval_s: float = _HEARTBEAT_INTERVAL_S,
    phase_name: str,
    log: logging.Logger | None = None,
    **kwargs: Any,
) -> _T:
    """Run a synchronous callable in a thread, heartbeating periodically.

    Prevents Temporal heartbeat timeout during long-running synchronous
    operations (e.g., git clone via Daytona API) that would otherwise
    block the asyncio event loop and starve heartbeat delivery.

    The callable is dispatched via ``asyncio.to_thread`` so the event
    loop remains free.  Every *heartbeat_interval_s* seconds, a Temporal
    heartbeat is sent with progress information.  Between heartbeats the
    activity cancellation flag is checked — if the Temporal server has
    already cancelled the activity (e.g., due to a prior heartbeat
    timeout on a different attempt), the wrapper stops waiting and
    raises ``asyncio.CancelledError`` so the worker can clean up
    promptly instead of blocking until the callable returns.

    Args:
        fn: Synchronous callable to execute.
        *args: Positional arguments forwarded to *fn*.
        heartbeat_interval_s: Seconds between heartbeats (default 30).
        phase_name: Label included in each heartbeat payload for
            observability (e.g., ``"workspace_provisioning"``).
        log: Optional logger; falls back to a module-level logger.
        **kwargs: Keyword arguments forwarded to *fn*.

    Returns:
        The return value of *fn*.

    Raises:
        asyncio.CancelledError: If the Temporal activity is cancelled
            while waiting.
        Exception: Any exception raised by *fn* is re-raised.
    """
    _log = log or _heartbeat_logger
    task = asyncio.ensure_future(
        asyncio.to_thread(functools.partial(fn, *args, **kwargs))
    )
    heartbeat_count = 0
    start = time.monotonic()

    while not task.done():
        done, _ = await asyncio.wait({task}, timeout=heartbeat_interval_s)
        if done:
            break

        heartbeat_count += 1
        elapsed_s = time.monotonic() - start
        _log.info(
            "[HEARTBEAT] %s — heartbeat #%d (%.0fs elapsed)",
            phase_name,
            heartbeat_count,
            elapsed_s,
        )
        activity.heartbeat({
            "setup_phase": phase_name,
            "heartbeat_count": heartbeat_count,
            "elapsed_s": round(elapsed_s, 1),
        })

        if activity.is_cancelled():
            _log.warning(
                "[HEARTBEAT] %s — activity cancelled by Temporal after %.0fs; "
                "abandoning wait (background thread will finish independently)",
                phase_name,
                elapsed_s,
            )
            raise asyncio.CancelledError(
                f"Activity cancelled during {phase_name}"
            )

    return task.result()


# ─────────────────────────────────────────────────────────────────────────────
# Zip Extraction Safety
# ─────────────────────────────────────────────────────────────────────────────

_MAX_ZIP_FILES = 1000
_MAX_ZIP_EXTRACTED_SIZE = 100 * 1024 * 1024  # 100 MB


def _validate_zip_for_extraction(
    zip_data: bytes,
    attachment_filename: str,
    logger,
) -> list[tuple[str, int]]:
    """Validate a zip archive before extraction and return its file manifest.

    This runs BEFORE any extraction in both Daytona and local modes.
    User-supplied attachments are untrusted, so we enforce strict safety
    checks that the platform's internal skill extraction does not need.

    Checks (in order):
        1. Valid zip format
        2. Path traversal — reject entries with absolute paths or ``..``
           components that could escape the target directory
        3. Zip bomb — reject archives exceeding file count or total
           uncompressed size limits

    Args:
        zip_data: Raw bytes of the zip archive.
        attachment_filename: Original filename (for error messages).
        logger: Activity logger.

    Returns:
        Sorted list of ``(relative_path, uncompressed_size)`` tuples
        (directory entries excluded).

    Raises:
        ValueError: If the archive is invalid or fails safety checks.
    """
    import io
    import zipfile

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_data))
    except zipfile.BadZipFile as exc:
        raise ValueError(
            f"Attachment '{attachment_filename}' is not a valid zip archive: {exc}",
        ) from exc

    entries: list[tuple[str, int]] = []
    total_uncompressed: int = 0

    for info in zf.infolist():
        if info.is_dir():
            continue

        name = info.filename

        # Path traversal: reject absolute paths
        if name.startswith("/") or name.startswith("\\"):
            zf.close()
            raise ValueError(
                f"Attachment '{attachment_filename}' contains an absolute "
                f"path entry and cannot be safely extracted: {name}",
            )

        # Path traversal: reject .. components
        normalized = os.path.normpath(name)
        if normalized.startswith("..") or "/../" in f"/{normalized}/":
            zf.close()
            raise ValueError(
                f"Attachment '{attachment_filename}' contains a path "
                f"traversal entry and cannot be safely extracted: {name}",
            )

        entries.append((name, info.file_size))
        total_uncompressed += info.file_size

    if not entries:
        zf.close()
        raise ValueError(
            f"Attachment '{attachment_filename}' is an empty zip archive",
        )

    if len(entries) > _MAX_ZIP_FILES:
        zf.close()
        raise ValueError(
            f"Attachment '{attachment_filename}' contains {len(entries)} "
            f"files (limit: {_MAX_ZIP_FILES})",
        )

    if total_uncompressed > _MAX_ZIP_EXTRACTED_SIZE:
        size_mb = total_uncompressed / (1024 * 1024)
        limit_mb = _MAX_ZIP_EXTRACTED_SIZE / (1024 * 1024)
        zf.close()
        raise ValueError(
            f"Attachment '{attachment_filename}' would extract to "
            f"{size_mb:.1f} MB (limit: {limit_mb:.0f} MB)",
        )

    zf.close()

    logger.info(
        "[attachments] Validated zip '%s': %d files, %.1f KB uncompressed",
        attachment_filename,
        len(entries),
        total_uncompressed / 1024,
    )

    return sorted(entries, key=lambda e: e[0])


async def inject_attachments(
    *,
    backend: WorkspaceBackend,
    attachments: list,
    storage: ArtifactStorage,
    logger,
    allow_local_path: bool = False,
) -> list[dict]:
    """Inject attachments into the workspace via ``WorkspaceBackend``.

    All file operations go through the backend — no branching on
    deployment mode.

    Args:
        backend: Workspace backend for file operations.
        attachments: List of Attachment proto messages (all must have
            ``storage_key``).
        storage: ArtifactStorage for downloading content.
        logger: Activity logger.
        allow_local_path: When ``True``, attachments that carry a
            ``local_path`` will be read directly from the local
            filesystem instead of downloading from artifact storage.
            Falls back to storage download if the local file is missing.
            Callers should pass ``worker_config.is_local_mode()``.

    Returns:
        List of dicts: ``[{"filename": str, "path": str, "size": int}]``.

    Raises:
        ValueError: If any attachment is missing both ``local_path``
            (when allowed) and ``storage_key``.
    """
    import io
    import zipfile
    from pathlib import Path

    if not attachments:
        return []

    logger.info("Injecting %d attachments into workspace", len(attachments))

    all_files: list[tuple[str, bytes]] = []
    injected_files: list[dict] = []

    for attachment in attachments:
        content: bytes | None = None

        if allow_local_path and getattr(attachment, "local_path", ""):  # type: ignore[arg-type]
            local_file = Path(attachment.local_path)
            if local_file.is_file():
                content = local_file.read_bytes()
                logger.debug(
                    "Read %d bytes from local path: %s",
                    len(content), attachment.local_path,
                )
            else:
                logger.warning(
                    "local_path '%s' not found, falling back to "
                    "storage download",
                    attachment.local_path,
                )

        if content is None:
            if not attachment.storage_key:
                raise ValueError(
                    f"Attachment missing storage_key: {attachment.filename}"
                )
            logger.debug(
                "Downloading %s from storage key: %s",
                attachment.filename,
                attachment.storage_key,
            )
            content = storage.download(attachment.storage_key)
            logger.debug(
                "Downloaded %d bytes for %s",
                len(content), attachment.filename,
            )

        if attachment.mount_path:
            mount_path = attachment.mount_path.lstrip("/")
        else:
            mount_path = f".stigmer/inputs/{attachment.filename}"

        if attachment.extract:
            validated = _validate_zip_for_extraction(
                content, attachment.filename, logger,
            )
            mount_dir = mount_path.rstrip("/")

            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    rel_path = f"{mount_dir}/{info.filename}"
                    all_files.append((rel_path, zf.read(info)))

            for rel_path, file_size in validated:
                injected_files.append({
                    "filename": rel_path.rsplit("/", 1)[-1],
                    "path": f"{mount_dir}/{rel_path}",
                    "size": file_size,
                })
        else:
            all_files.append((mount_path, content))
            injected_files.append({
                "filename": attachment.filename,
                "path": mount_path,
                "size": len(content),
            })

    if all_files:
        backend.write_files(all_files)
        logger.info(
            "Wrote %d file(s) to workspace", len(all_files),
        )

    logger.info(
        "Attachment injection complete. Files available to agent:\n"
        + "\n".join(
            f"  - {f['path']} ({f['size']} bytes)"
            if f.get("size") is not None
            else f"  - {f['path']}"
            for f in injected_files
        ),
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
    file_modifying_tool_names = {"write", "write_file", "edit", "edit_file"}

    # Diagnostic: log every file-modifying tool call regardless of status.
    # This makes it easy to diagnose "where did my files go?" issues by
    # showing which writes were found and why they were included or skipped.
    file_modifying_tcs = [tc for tc in tool_calls if tc.name in file_modifying_tool_names]
    if file_modifying_tcs:
        for tc in file_modifying_tcs:
            status_name = ToolCallStatus.Name(tc.status)
            path = dict(tc.args).get("path", "<no path>") if tc.args else "<no args>"
            logger.info(
                f"[AUTO_PUBLISH] execution={execution_id} — "
                f"file-modifying tool_call: name={tc.name} "
                f"status={status_name} path={path} id={tc.id}"
            )
    else:
        logger.debug(
            f"[AUTO_PUBLISH] execution={execution_id} — "
            f"no file-modifying tool calls found at all"
        )

    # Collect paths from completed file-modifying tool calls.
    written_paths: list[str] = []
    for tc in tool_calls:
        if tc.name not in file_modifying_tool_names:
            continue
        if tc.status != ToolCallStatus.TOOL_CALL_COMPLETED:
            continue
        # tc.args is a google.protobuf.Struct; access fields as a dict.
        path = dict(tc.args).get("path", "")
        if path:
            written_paths.append(path)

    if not written_paths:
        logger.info(
            f"[AUTO_PUBLISH] execution={execution_id} — "
            f"no completed file-modifying tool calls found, skipping "
            f"(total file-modifying tool calls: {len(file_modifying_tcs)})"
        )
        return 0

    logger.info(
        f"[AUTO_PUBLISH] execution={execution_id} — "
        f"detected {len(written_paths)} modified file(s), "
        f"auto-publishing as artifacts: {written_paths}"
    )

    # Determine publish groups by finding common ancestor directories.
    #
    # Strategy:
    #   1. If ALL paths share a single common parent (e.g. "my-skill/SKILL.md",
    #      "my-skill/scripts/run.sh" → common parent "my-skill"), publish that
    #      directory as a single artifact.
    #   2. If paths span multiple unrelated trees (e.g. "agent-drafter/SKILL.md"
    #      + "outputs/SUMMARY.md"), group by top-level directory segment and
    #      publish each group as a separate directory artifact.  This preserves
    #      internal structure (e.g. references/ subdirectories) instead of
    #      flattening everything into individual files.
    #   3. Root-level files (no parent directory) are published individually.
    import posixpath
    from collections import defaultdict
    from pathlib import PurePosixPath

    # Normalise: strip leading slashes so paths are workspace-relative.
    normalised = [p.lstrip("/") for p in written_paths]

    # Single file — publish as an individual file artifact regardless of
    # depth.  Wrapping it in a directory artifact named after the parent
    # causes nested-directory collisions when --output already points at
    # that same parent (e.g. mcp-servers/mcp-servers/planton.yaml).
    if len(normalised) == 1:
        rel_path = normalised[0]
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
            logger.info(
                f"[AUTO_PUBLISH] execution={execution_id} — "
                f"published file '{rel_path}' as artifact '{file_name}'"
            )
            return 1
        except Exception as e:
            logger.warning(
                f"[AUTO_PUBLISH] execution={execution_id} — "
                f"failed to publish file '{rel_path}': {e}"
            )
            return 0

    # Compute common prefix directory across ALL paths.
    try:
        common = posixpath.commonpath(normalised)
    except ValueError:
        common = ""
    if common and common != ".":
        common_dir = common
    else:
        common_dir = None

    artifacts_published = 0

    if common_dir:
        # All paths share a common ancestor — publish as a single artifact.
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
        # No single common directory — group by top-level directory and
        # publish each group as a directory artifact.  This preserves
        # subdirectory structure within each group (e.g. references/).
        groups: dict[str, list[str]] = defaultdict(list)
        root_files: list[str] = []

        for p in normalised:
            parts = PurePosixPath(p).parts
            if len(parts) > 1:
                groups[parts[0]].append(p)
            else:
                root_files.append(p)

        # Publish each directory group.  Within each group, find the
        # deepest common path and publish that directory as one artifact.
        for _top_dir, paths in groups.items():
            if len(paths) == 1:
                group_common = str(PurePosixPath(paths[0]).parent)
            else:
                group_common = posixpath.commonpath(paths)

            artifact_name = PurePosixPath(group_common).name or group_common
            try:
                artifact = await publish_artifact(
                    sandbox=sandbox,
                    storage=storage,
                    execution_id=execution_id,
                    path=group_common,
                    name=artifact_name,
                    local_root=local_root,
                )
                status_builder.add_artifact(artifact)
                artifacts_published += 1
                logger.info(
                    f"[AUTO_PUBLISH] execution={execution_id} — "
                    f"published directory '{group_common}' "
                    f"as artifact '{artifact_name}' "
                    f"({len(paths)} file(s) in group)"
                )
            except Exception as e:
                logger.warning(
                    f"[AUTO_PUBLISH] execution={execution_id} — "
                    f"failed to publish directory '{group_common}': {e}"
                )

        # Publish root-level files individually (no directory to group).
        for rel_path in root_files:
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
                    f"published root file '{rel_path}' as artifact '{file_name}'"
                )
            except Exception as e:
                logger.warning(
                    f"[AUTO_PUBLISH] execution={execution_id} — "
                    f"failed to publish root file '{rel_path}': {e}"
                )

    logger.info(
        f"[AUTO_PUBLISH] execution={execution_id} — "
        f"auto-published {artifacts_published} artifact(s) from "
        f"{len(written_paths)} modified file(s)"
    )
    return artifacts_published


def build_workspace_prompt_section(
    provision_results: list[ProvisionResult] | None = None,
    container_root: str = "",
) -> str:
    """Build the ``## Workspace`` system prompt section.

    Returns the section string (with leading newlines for concatenation)
    when *provision_results* is non-empty, or an empty string otherwise.
    Callers can unconditionally append the result.

    For a single entry the output is identical to the legacy
    single-workspace format (no regression).  For multiple entries each
    gets a ``### {name}`` sub-heading with its description and file
    tree (heading level adjusted to ``####``).

    *container_root* is the backend's root directory — used only in the
    multi-entry path to tell the agent its current working directory.
    """
    if not provision_results:
        return ""

    if len(provision_results) == 1:
        return _build_single_workspace_section(provision_results[0])

    return _build_multi_workspace_section(provision_results, container_root)


def _git_writeback_guidance(
    meta: GitMetadata | None,
    *,
    heading_level: int = 3,
) -> str:
    """Return a prompt section telling the agent it can push changes.

    Returns an empty string when *meta* is ``None`` or credentials
    were not configured, so callers can unconditionally append the
    result.
    """
    if meta is None or not meta.git_credentials_configured:
        return ""

    heading = "#" * heading_level
    return (
        f"\n\n{heading} Git Write-Back\n\n"
        "Git credentials are configured — you can push changes to "
        "the remote repository.\n\n"
        "**Rules:**\n"
        "- Create a new branch for your changes (never push directly "
        "to the default branch).\n"
        "- Write clear, meaningful commit messages.\n"
        "- Push your branch and report the branch name when done.\n"
        "- After pushing, use `create_pull_request` to open a PR. "
        "It reads credentials and repo info automatically.\n"
        "- Do NOT read, echo, or reference credential files "
        "(e.g. `~/.git-credentials`)."
    )


def _build_single_workspace_section(result: ProvisionResult) -> str:
    """Format the workspace section for a single entry (legacy compat)."""
    if not result.workspace_description:
        return ""

    section = "\n\n## Workspace\n\n" + result.workspace_description

    if result.file_tree:
        section += "\n\n" + result.file_tree

    section += _git_writeback_guidance(result.git_metadata)

    return section


def _build_multi_workspace_section(
    results: list[ProvisionResult],
    container_root: str,
) -> str:
    """Format the workspace section for multiple entries.

    The tree heading level is controlled at provisioning time via
    ``tree_heading_level`` (set to 4 by ``provision_all`` for
    multi-entry sessions), so no post-hoc string replacement is needed.

    *container_root* is the backend's root directory — included in the
    prompt so the agent knows its CWD and how to form entry-relative
    paths.
    """
    first_label = results[0].entry_name or "entry-1"

    section = (
        f"\n\n## Workspace\n\n"
        f"This session has {len(results)} workspace entries.\n\n"
        f"**Current working directory**: `{container_root}`\n"
        f"**Path resolution**: All file tools (read, write, edit, ls, "
        f"glob, grep) resolve paths relative to the current working "
        f"directory. Use entry-relative paths "
        f"(e.g., `{first_label}/src/main.py`) or absolute paths.\n"
    )

    for idx, result in enumerate(results):
        label = result.entry_name or f"entry-{idx + 1}"
        section += f"\n### {label} (`{result.root_dir}`)\n\n"
        section += _format_entry_description(result)

        if result.file_tree:
            section += "\n\n" + result.file_tree

    return section


def _format_entry_description(result: ProvisionResult) -> str:
    """Generate a multi-workspace-appropriate description for one entry.

    Uses structured fields on *result* (``source_type``, ``entry_name``,
    ``git_metadata``) rather than the generic ``workspace_description``
    so the phrasing fits a multi-entry context ("Workspace entry **X**"
    instead of "Your workspace is ...").

    Falls back to ``workspace_description`` for unknown source types so
    that new sources work without changes here.
    """
    name = result.entry_name or "this entry"

    if result.source_type == SourceType.LOCAL_PATH:
        return (
            f"Workspace entry **{name}** is the user's project directory "
            f"at `{result.root_dir}`.\n"
            "You are operating directly on the user's files — changes are "
            "immediate and persistent. Use git to track and verify your "
            "changes."
        )

    if result.source_type == SourceType.GIT_REPO and result.git_metadata:
        meta = result.git_metadata
        short_sha = (
            meta.base_commit[:7]
            if len(meta.base_commit) >= 7
            else meta.base_commit
        )
        desc = (
            f"Workspace entry **{name}** was initialized from "
            f"{meta.repo_url} (branch: {meta.branch}, "
            f"commit: {short_sha}).\n"
            "Changes you make will be captured as artifacts when "
            "execution completes."
        )
        desc += _git_writeback_guidance(meta, heading_level=4)
        return desc

    if result.source_type == SourceType.EMPTY:
        return (
            f"Workspace entry **{name}** is an empty workspace.\n"
            "Create files and directories as needed for your task."
        )

    return result.workspace_description


def build_referenced_files_prompt_section(
    workspace_file_refs: list[str],
    workspace_root: str,
) -> str:
    """Build the ``## Referenced Files`` system prompt section.

    When the user attaches files that are inside the workspace, the CLI
    records them as workspace-relative paths instead of uploading them.
    This function builds a prompt section listing those paths with
    structural metadata so the agent can navigate them efficiently.

    For files the size is shown.  For directories the full tree (up to a
    depth and entry limit) is expanded inline so the agent has a complete
    map without needing to ``ls`` first.

    Args:
        workspace_file_refs: Workspace-relative paths (files or
            directories).
        workspace_root: Absolute path to the workspace root (used to
            stat entries for type and size info).

    Returns:
        The section string (with leading newlines) or empty string if
        no refs are provided.
    """
    if not workspace_file_refs:
        return ""

    section = (
        "\n\n## Referenced Files\n\n"
        "The user has highlighted the following workspace paths for your "
        "attention. Use `read` to access file contents.\n\n"
    )

    for ref_path in workspace_file_refs:
        full_path = os.path.join(workspace_root, ref_path)
        try:
            if os.path.isdir(full_path):
                tree_lines, total = _build_directory_tree(
                    full_path,
                    ref_path.rstrip("/") + "/",
                )
                label = "entry" if total == 1 else "entries"
                section += f"- `{ref_path}/` (directory, {total} {label})\n"
                for line in tree_lines:
                    section += line + "\n"
                if total > len(tree_lines):
                    section += (
                        f"    - ... and {total - len(tree_lines)} more "
                        f"(truncated at {_TREE_MAX_ENTRIES} entries)\n"
                    )
            else:
                size = os.path.getsize(full_path)
                section += f"- `{ref_path}` ({_human_size(size)})\n"
        except OSError:
            section += f"- `{ref_path}`\n"

    return section


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
            optional comment.  The activity correlates these with pending_approvals
            from the fetched execution to build the LangGraph Command(resume=...) dict.
        invoker_identity_account_id: Identity account ID of the user who triggered
            the execution. Used by the runner for on-behalf-of gRPC impersonation
            (x-on-behalf-of header). None for backward compatibility.
        
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
        approval_decisions = []
    
    # Top-level error handler for system errors (e.g., activity not registered, connection failures)
    # This catches errors that occur before the main try block or during initialization
    try:
        return await _execute_graphton_impl(
            execution_id, thread_id, approval_decisions, activity_logger,
            invoker_identity_account_id,
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
        
        # Return slim status to workflow (full status already persisted via gRPC above)
        return _slim_status_for_temporal(failed_status)


async def _execute_graphton_impl(
    execution_id: str,
    thread_id: str,
    approval_decisions: list[SubmitApprovalInput],
    activity_logger,
    invoker_identity_account_id: str | None = None,
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
    
    # Shared gRPC channels for all clients in this activity invocation.
    # Two channels are maintained:
    #   sys_ch  – machine-account only, for operator-level calls (updateStatus)
    #   obo_ch  – adds x-on-behalf-of header, for user-scoped reads and writes
    # When invoker_identity_account_id is absent (backward compat), both point
    # to the same system channel.
    grpc_provider = ChannelProvider(
        api_key,
        invoker_identity_account_id=invoker_identity_account_id,
    )
    sys_ch = grpc_provider.channel
    obo_ch = grpc_provider.obo_channel if invoker_identity_account_id else sys_ch

    session_client = SessionClient(api_key, channel=obo_ch)
    agent_instance_client = AgentInstanceClient(api_key, channel=obo_ch)
    agent_client = AgentClient(api_key, channel=obo_ch)
    execution_query_client = AgentExecutionClient(api_key, channel=obo_ch)
    execution_client = AgentExecutionClient(api_key, channel=sys_ch)
    
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
    execution = await execution_query_client.get(execution_id)
    
    agent_id = execution.spec.agent_id
    user_message = execution.spec.message
    
    activity_logger.info(
        f"Execution parameters: agent_id={agent_id}, "
        f"session_id='{execution.spec.session_id}' (empty={not execution.spec.session_id})"
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

    # Workspace backend is initialized inside the try block but referenced
    # in the finally block for cleanup (close() deletes the Daytona process
    # session used for sandbox command execution).
    workspace_backend = None
    
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
        heartbeat_during_setup("chain_resolution:session", {
            "session_id": session_id,
        })
        
        # 1b. Get agent instance from session
        agent_instance = await agent_instance_client.get(session.spec.agent_instance_id)
        activity_logger.info(
            f"AgentInstance {session.spec.agent_instance_id}: agent_id={agent_instance.spec.agent_id}"
        )
        heartbeat_during_setup("chain_resolution:agent_instance", {
            "session_id": session_id,
            "agent_instance_id": session.spec.agent_instance_id,
        })
        
        # 1c. Get agent template
        agent = await agent_client.get(agent_instance.spec.agent_id)
        activity_logger.info(
            f"Agent {agent_instance.spec.agent_id}: name={agent.metadata.name}"
        )
        
        # Extract agent instructions
        instructions = agent.spec.instructions if agent.spec.instructions else "You are a helpful AI assistant."
        
        heartbeat_during_setup("chain_resolution:agent", {
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
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Compute recursion_limit from ExecutionConfig.max_tool_rounds (if set).
        #
        # max_tool_rounds is the user-facing unit (model→tools cycles).
        # LangGraph's recursion_limit counts super-steps (~6 per round due to
        # middleware graph nodes: before_model, model, 3× after_model, tools).
        # 0 = use platform default (None = unlimited; loop detection is safety).
        # Non-zero values are clamped to 10–1000 rounds (60–6000 super-steps).
        # ─────────────────────────────────────────────────────────────────────────────
        min_tool_rounds = 10
        max_tool_rounds = 1000
        recursion_limit = None  # None = unlimited (loop detection is primary safety)
        if (execution.spec.HasField("execution_config")
                and execution.spec.execution_config.max_tool_rounds > 0):
            requested_rounds = execution.spec.execution_config.max_tool_rounds
            clamped_rounds = max(min_tool_rounds, min(max_tool_rounds, requested_rounds))
            if clamped_rounds != requested_rounds:
                activity_logger.warning(
                    "max_tool_rounds=%d clamped to %d (valid range: %d-%d)",
                    requested_rounds, clamped_rounds,
                    min_tool_rounds, max_tool_rounds,
                )
            recursion_limit = clamped_rounds * 6
            activity_logger.info(
                "Recursion limit from execution config: max_tool_rounds=%d "
                "-> recursion_limit=%d",
                clamped_rounds, recursion_limit,
            )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Extract Phase 3B config: tool truncation + cost cap (from ExecutionConfig).
        #
        # max_tool_result_chars: 0 = platform default (30K). Always active.
        # max_cost_usd: 0.0 = no cap.  When > 0, requires pricing from ModelRegistry.
        # ─────────────────────────────────────────────────────────────────────────────
        max_tool_result_chars = 0
        max_cost_usd = 0.0
        if execution.spec.HasField("execution_config"):
            max_tool_result_chars = execution.spec.execution_config.max_tool_result_chars
            max_cost_usd = execution.spec.execution_config.max_cost_usd

        if max_tool_result_chars > 0:
            activity_logger.info(
                "Tool result truncation from execution config: max_chars=%d",
                max_tool_result_chars,
            )
        if max_cost_usd > 0.0:
            activity_logger.info(
                "Cost cap from execution config: max_cost_usd=$%.2f",
                max_cost_usd,
            )

        # Get sandbox configuration from worker config
        setup_timer.start("sandbox")
        sandbox_config = worker_config.get_sandbox_config(session_id=session_id)
        
        activity_logger.info(
            f"Sandbox mode: {worker_config.mode} - using {sandbox_config.get('type')} backend"
        )
        
        # Initialize sandbox manager (cloud mode only).
        sandbox_manager = None
        if worker_config.mode != "local":
            daytona_api_key = os.environ.get("DAYTONA_API_KEY")
            if not daytona_api_key:
                raise ValueError("DAYTONA_API_KEY environment variable required for cloud mode")
            sandbox_manager = SandboxManager(
                daytona_api_key=daytona_api_key,
            )
            if snapshot_id := sandbox_config.get("snapshot_id"):
                activity_logger.info(f"Using Daytona snapshot: {snapshot_id}")

        resolved_session_id: str | None = execution.spec.session_id if execution.spec.session_id else None

        heartbeat_during_setup("sandbox_init", {
            "mode": worker_config.mode,
            "sandbox_type": sandbox_config.get("type"),
        })

        # Create the workspace backend — single point where local-vs-cloud
        # decision is made.  All subsequent code uses workspace_backend for
        # file operations and never branches on deployment mode.
        workspace_init = await initialize_workspace(
            worker_config=worker_config,
            sandbox_config=sandbox_config,
            sandbox_manager=sandbox_manager,
            session_id=resolved_session_id,
            session_client=session_client,
            activity_logger=activity_logger,
            heartbeat_fn=lambda phase: heartbeat_during_setup(phase),
        )
        workspace_backend = workspace_init.backend
        sandbox = workspace_init.sandbox
        is_new_sandbox = workspace_init.is_new_sandbox

        heartbeat_during_setup("workspace_ready", {
            "is_new_sandbox": is_new_sandbox,
            "sandbox_id": sandbox.id if sandbox else None,
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 2.8: Merge environment variables (moved up from Step 4)
        #
        # Environment merge now happens before workspace provisioning because
        # the provisioner needs credentials from the merged env (e.g.
        # GITHUB_TOKEN for git clone).  Nothing between the old Step 4
        # location and here depends on merged_env_vars, so the reorder is safe.
        # ─────────────────────────────────────────────────────────────────────────────
        setup_timer.start("environment")
        merged_env_vars: dict[str, str] = {}
        secret_keys: set[str] = set()
        use_legacy_env_merge = True
        
        try:
            execution_context_client = ExecutionContextClient(api_key, channel=obo_ch)
            exec_ctx = await execution_context_client.try_get_by_execution_id(execution_id)
            
            if exec_ctx and exec_ctx.spec.data:
                activity_logger.info(
                    f"Using merged environment from ExecutionContext: "
                    f"context_id={exec_ctx.metadata.id}, env_count={len(exec_ctx.spec.data)}"
                )
                for key, exec_value in exec_ctx.spec.data.items():
                    merged_env_vars[key] = exec_value.value
                    if exec_value.is_secret:
                        secret_keys.add(key)
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
        
        if use_legacy_env_merge:
            # Layer 1: agent env_spec defaults (always applied)
            if agent.spec.env_spec and agent.spec.env_spec.data:
                for key, env_value in agent.spec.env_spec.data.items():
                    merged_env_vars[key] = env_value.value
                    if env_value.is_secret:
                        secret_keys.add(key)
                activity_logger.info(f"[Legacy] Base env vars from agent: {len(agent.spec.env_spec.data)}")
            
            # Layer 2: environment_refs (only when present)
            environment_refs = agent_instance.spec.environment_refs
            if environment_refs:
                activity_logger.info(
                    f"[Legacy] Merging {len(environment_refs)} environments: "
                    f"{[ref.slug for ref in environment_refs]}"
                )
                try:
                    environment_client = EnvironmentClient(api_key, channel=obo_ch)
                    environments = await environment_client.list_by_refs(list(environment_refs))
                    
                    for idx, env in enumerate(environments):
                        if env.spec.data:
                            for key, env_value in env.spec.data.items():
                                merged_env_vars[key] = env_value.value
                                if env_value.is_secret:
                                    secret_keys.add(key)
                            activity_logger.info(
                                f"[Legacy] Merged env {idx+1}/{len(environments)} ({env.metadata.name}): "
                                f"{len(env.spec.data)} vars"
                            )
                except Exception as e:
                    activity_logger.error(f"[Legacy] Failed to merge environment_refs: {e}")
            
            # Layer 3: runtime_env CLI overrides (always applied, highest priority)
            if execution.spec.runtime_env:
                for key, value in execution.spec.runtime_env.items():
                    merged_env_vars[key] = value.value
                    if value.is_secret:
                        secret_keys.add(key)
                activity_logger.info(f"[Legacy] Applied runtime env overrides: {len(execution.spec.runtime_env)} vars")
            
            activity_logger.info(f"[Legacy] Final merged environment: {len(merged_env_vars)} total vars")
        
        heartbeat_during_setup("environment_merged", {
            "env_var_count": len(merged_env_vars),
            "used_legacy_merge": use_legacy_env_merge,
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 2.9: Workspace provisioning
        #
        # When the session has workspace_entries, the provisioner iterates
        # each entry and provisions it (git clone, local-path validation,
        # or empty).  The provisioner is idempotent: previously provisioned
        # workspaces are detected and reused without re-cloning.
        #
        # Credential stripping (AD-05): keys consumed by provisioning
        # (e.g. GITHUB_TOKEN) are removed from merged_env_vars so they
        # do not leak into MCP config placeholders or status reporting.
        #
        # Provisioning runs in a background thread via
        # _run_sync_with_heartbeat so that Temporal heartbeats continue
        # flowing while long-running synchronous operations (git clone
        # through the Daytona HTTP API) block.  Without this, a clone
        # exceeding the 2-minute heartbeat timeout would cause Temporal
        # to kill the activity even though the clone is still in progress.
        # ─────────────────────────────────────────────────────────────────────────────
        provision_results: list[ProvisionResult] = []
        
        if session.spec.workspace_entries:
            setup_timer.start("workspace_provisioning")
            try:
                provisioner = WorkspaceProvisioner(log=activity_logger)
                # Always use local-mode git provisioning: the workspace
                # lives on the sandbox's local overlay filesystem (even in
                # cloud mode), so --separate-git-dir and FUSE compat hacks
                # are unnecessary.
                provision_results = await _run_sync_with_heartbeat(
                    provisioner.provision_all,
                    entries=session.spec.workspace_entries,
                    backend=workspace_backend,
                    merged_env=merged_env_vars,
                    is_local_mode=True,
                    phase_name="workspace_provisioning",
                    log=activity_logger,
                )
                
                if provision_results:
                    primary = provision_results[0]
                    if (
                        len(provision_results) == 1
                        and primary.root_dir != workspace_backend.root_dir
                    ):
                        # Single entry: replace backend so the agent's
                        # CWD is the provisioned root (backward compat).
                        activity_logger.info(
                            "Workspace root changed by provisioning: %s -> %s",
                            workspace_backend.root_dir,
                            primary.root_dir,
                        )
                        workspace_backend = LocalWorkspaceBackend(
                            root_dir=primary.root_dir,
                            platform_dir=workspace_init.platform_dir,
                        )
                    elif len(provision_results) > 1:
                        # Multi-entry: keep backend at workspace root so
                        # all entry subdirectories remain reachable.  The
                        # system prompt tells the agent which entry is
                        # primary and how to navigate between them.
                        activity_logger.info(
                            "Multi-entry workspace: keeping backend at "
                            "root %s (%d entries)",
                            workspace_backend.root_dir,
                            len(provision_results),
                        )
                
                    all_consumed: set[str] = set()
                    for pr in provision_results:
                        all_consumed.update(pr.consumed_keys)
                    if all_consumed:
                        stripped = [
                            k for k in all_consumed
                            if merged_env_vars.pop(k, None) is not None
                        ]
                        if stripped:
                            activity_logger.info(
                                "Stripped %d provisioning key(s) from agent environment: %s",
                                len(stripped),
                                ", ".join(sorted(stripped)),
                            )
                
            except WorkspaceProvisionError as prov_err:
                activity_logger.error(
                    "Workspace provisioning failed: %s", prov_err,
                )
                raise ValueError(
                    f"Workspace provisioning failed: {prov_err}"
                ) from prov_err
            
            heartbeat_during_setup("workspace_provisioned", {
                "entry_count": len(provision_results),
                "source_types": [pr.source_type.value for pr in provision_results],
                "primary_root_dir": provision_results[0].root_dir if provision_results else None,
            })
        
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
        # - Skills are written to .stigmer/skills/{name}/ in the sandbox
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
        skill_refs = merge_skill_refs(agent.spec.skill_refs, session.spec.skill_refs)
        
        # Create skill client (needed for both parent skills and subagent skills)
        skill_client = SkillClient(api_key, channel=obo_ch)
        
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
                    workspace_files_intact = workspace_backend.file_exists(sentinel)
                    if not workspace_files_intact:
                        activity_logger.warning(
                            "[workspace-check] Sentinel file missing: %s",
                            sentinel,
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
                    
                    activity_logger.info(
                        "Writing %d skills to workspace at %s/.stigmer/skills/",
                        len(skills),
                        workspace_backend.root_dir,
                    )
                    skill_writer = SkillWriter(backend=workspace_backend)
                    skill_paths = skill_writer.write_skills(skills, artifacts=artifacts)
                    
                    # Generate prompt section with full SKILL.md content and LOCATION headers
                    skills_prompt_section = SkillWriter.generate_prompt_section(skills, skill_paths)
                    
                    activity_logger.info(
                        f"Successfully wrote {len(skills)} skills: {[s.metadata.name for s in skills]}"
                    )
                    
                    # ─── Diagnostic: verify skill files are accessible ───────────
                    if sandbox is not None:
                        activity_logger.info(
                            "[skill-diag] workspace_root = %r",
                            workspace_backend.root_dir,
                        )
                        for _sid, spath in skill_paths.items():
                            diag_result = workspace_backend.execute(
                                f"ls -la {spath}/ 2>&1 | head -20",
                                timeout=5,
                            )
                            activity_logger.info(
                                "[skill-diag] ls %s/  exit=%d  output=%s",
                                spath,
                                diag_result.exit_code,
                                diag_result.stdout[:300],
                            )

                    # ─── Post-write verification ─────────────────────────────
                    # Create the same backend the agent will use and verify
                    # every skill's SKILL.md is readable.  This catches path
                    # mismatches at setup time rather than at agent runtime.
                    if skill_paths:
                        for _vid, vpath in skill_paths.items():
                            skill_md_path = f"{vpath}/SKILL.md"
                            try:
                                if not workspace_backend.file_exists(skill_md_path):
                                    raise FileNotFoundError(
                                        f"SKILL.md not found at {skill_md_path}"
                                    )
                                content = workspace_backend.read_file(skill_md_path)
                                activity_logger.info(
                                    "Skill post-write verification passed: %s (%d bytes)",
                                    skill_md_path,
                                    len(content),
                                )
                            except Exception as verify_exc:
                                activity_logger.error(
                                    "CRITICAL: Skill at %s not readable through "
                                    "workspace backend: %s",
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
                    mount_path = att.mount_path if att.mount_path else f".stigmer/inputs/{att.filename}"
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
                        backend=workspace_backend,
                        attachments=attachments,
                        storage=artifact_storage,
                        logger=activity_logger,
                        allow_local_path=worker_config.is_local_mode(),
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
        
        # Step 5: Fetch and transform MCP servers (agent + session usages merged)
        # MCP servers provide external tools via Model Context Protocol
        setup_timer.start("mcp_servers")
        mcp_servers_config = {}
        mcp_tools_config = {}
        mcp_servers = []  # Initialize to empty list (populated if usages exist and fetch succeeds)
        mcp_server_usages = merge_mcp_server_usages(
            agent.spec.mcp_server_usages, session.spec.mcp_server_usages
        )
        
        if mcp_server_usages:
            activity_logger.info(
                f"Fetching {len(mcp_server_usages)} MCP servers: "
                f"{[usage.mcp_server_ref.slug for usage in mcp_server_usages]}"
            )
            
            try:
                # Create MCP server client
                mcp_server_client = McpServerClient(api_key, channel=obo_ch)
                
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
        status_builder.set_display_env_vars(merged_env_vars, secret_keys)
        
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
        
        # ── Skill relevance filtering ─────────────────────────────────────
        # When the agent has many skills, low-relevance skills are excluded
        # from the system prompt to improve signal quality.  Excluded skills
        # remain on disk and a brief "also available" note is appended so
        # the agent can still activate them if needed.
        from worker.activities.graphton.skill_relevance import filter_skills

        all_skill_names = [s.metadata.name for s in skills] if skills else []
        excluded_skill_names: list[str] = []

        if skills and len(skills) >= 8:
            filter_result = filter_skills(
                user_message=user_message,
                skill_names=[s.metadata.name for s in skills],
                skill_descriptions=[s.spec.description or "" for s in skills],
            )
            if filter_result.excluded_names:
                included_skills = [skills[i] for i in filter_result.included_indices]
                excluded_skill_names = filter_result.excluded_names
                activity_logger.info(
                    "Skill relevance filter: %d included, %d excluded %s",
                    len(included_skills),
                    len(excluded_skill_names),
                    excluded_skill_names,
                )
                # Rebuild the prompt section with only included skills.
                # Skill paths are already computed for ALL skills (included
                # and excluded) so the agent can still read excluded skills.
                skills_prompt_section = SkillWriter.generate_prompt_section(
                    included_skills, skill_paths,
                )
                skills_prompt_section += SkillWriter.generate_also_available_section(
                    excluded_skill_names,
                )
                # Update the name list to reflect what is in the prompt.
                all_skill_names = [s.metadata.name for s in included_skills]

        # Set resolved context on status builder
        status_builder.set_resolved_context(
            environment_keys=list(merged_env_vars.keys()),
            mcp_servers=mcp_server_status,
            skill_names=all_skill_names,
            excluded_skill_names=excluded_skill_names,
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
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.9: Build cost pricing for cost cap middleware (Phase 3B)
        #
        # Extract pricing rates from ModelRegistry for the primary model.
        # The cost cap middleware uses these for rough cost estimation.
        # Only built when max_cost_usd > 0 (otherwise no cap middleware).
        # ─────────────────────────────────────────────────────────────────────────────
        cost_pricing: dict[str, float] | None = None
        if max_cost_usd > 0.0:
            cost_pricing = {
                "input_price_per_million": model_metadata.input_price_per_million or 0.0,
                "output_price_per_million": model_metadata.output_price_per_million or 0.0,
                "cache_read_price_per_million": model_metadata.cache_read_price_per_million or 0.0,
            }
            activity_logger.info(
                "Cost pricing for cap middleware: input=$%.2f/MTok, "
                "output=$%.2f/MTok, cache_read=$%.2f/MTok",
                cost_pricing["input_price_per_million"],
                cost_pricing["output_price_per_million"],
                cost_pricing["cache_read_price_per_million"],
            )

        # Build truncation callback to wire middleware → UsageTracker (Phase 3B).
        # The callback is invoked each time the tool truncation middleware
        # truncates a tool result, forwarding the character count to the
        # usage tracker for accumulation in UsageMetrics.tool_result_chars_truncated.
        from worker.activities.graphton.usage_tracker import MAIN_SCOPE

        def _on_tool_truncation(tool_name: str, chars_truncated: int) -> None:
            status_builder.usage_tracker.record_tool_truncation(
                chars_truncated, MAIN_SCOPE,
            )

        # Step 6: Create Graphton agent at runtime with EXISTING sandbox
        # Note: MCP servers are passed if configured, providing external tool access
        setup_timer.start("agent_creation")
        activity_logger.info(f"Creating Graphton agent for execution {execution_id}")
        
        # Enhance system prompt with workspace context, skills, input files
        enhanced_system_prompt = instructions

        workspace_section = build_workspace_prompt_section(
            provision_results,
            container_root=workspace_backend.root_dir,
        )
        if workspace_section:
            enhanced_system_prompt += workspace_section
            activity_logger.info("Enhanced system prompt with workspace context")

        workspace_roots = [
            WorkspaceRoot(name=pr.entry_name, root_dir=pr.root_dir)
            for pr in provision_results
        ]
        relevance_section = build_relevance_prompt_section(
            user_message, workspace_roots,
        )
        if relevance_section:
            enhanced_system_prompt += relevance_section
            activity_logger.info("Enhanced system prompt with relevance signals")

        if skills_prompt_section:
            enhanced_system_prompt += skills_prompt_section
            activity_logger.info("Enhanced system prompt with skills metadata")

        workspace_file_refs = list(
            execution.spec.workspace_file_refs
        ) if execution.spec.workspace_file_refs else []
        if workspace_file_refs:
            ref_section = build_referenced_files_prompt_section(
                workspace_file_refs, workspace_backend.root_dir,
            )
            if ref_section:
                enhanced_system_prompt += ref_section
                activity_logger.info(
                    "Enhanced system prompt with %d workspace file ref(s)",
                    len(workspace_file_refs),
                )

        if injected_files:
            input_files_section = "\n\n## Input Files\n\n"
            input_files_section += (
                "The following files have been provided as read-only reference "
                "material for your task. They live under `.stigmer/inputs/` and "
                "are NOT part of the project source tree.\n\n"
                "Read them using the `read` tool when you need their contents. "
                "Do NOT echo, reprint, or summarize file contents in your response "
                "-- they are reference material, not output. "
                "Do NOT modify or delete these files.\n\n"
            )
            for f in injected_files:
                size_info = f" ({f['size']} bytes)" if f.get('size') is not None else ""
                input_files_section += f"- `{f['path']}`{size_info}\n"
            enhanced_system_prompt += input_files_section
            activity_logger.info(
                f"Enhanced system prompt with {len(injected_files)} input files"
            )
        
        enhanced_system_prompt += (
            "\n\n## Response rules\n\n"
            "- After using the read tool, NEVER reprint, echo, list, or summarize "
            "file contents in your response. Tool results are already in your "
            "context. Proceed directly to analysis or the task.\n"
            "- Do not begin responses with phrases like "
            '"Below is the complete content", '
            '"Here are the contents of the files", or similar. '
            "The user did not ask you to display file contents.\n"
        )

        enhanced_system_prompt += (
            "\n\n## Sub-agent delegation rules\n\n"
            "- **Read files directly.** When you need the contents of a file, "
            "use the `read` tool yourself. Do not delegate file reading to "
            "sub-agents via the `task` tool. You need raw file contents in "
            "your own context to reason about them accurately.\n"
            "- Sub-agents are for **multi-step, independent tasks** that "
            "produce a deliverable (analysis, synthesis, generated content). "
            "They are not for fetching data that you will process yourself.\n"
            "- When delegating to a sub-agent, specify the analysis or "
            "deliverable you need — not \"read these files and give me the "
            "contents.\"\n"
        )

        # Configure sandbox for Graphton agent.
        # Derive the config from workspace_backend + sandbox rather than
        # branching on mode.
        if sandbox is not None:
            sandbox_config_for_agent: dict[str, Any] = {
                "type": "daytona",
                "sandbox_id": sandbox.id,
                "workspace_root": workspace_backend.root_dir,
            }
            activity_logger.info(
                "Configuring agent to use existing sandbox %s "
                "(workspace_root=%s)",
                sandbox.id,
                workspace_backend.root_dir,
            )
        else:
            sandbox_config_for_agent = sandbox_config.copy()
            sandbox_config_for_agent["root_dir"] = workspace_backend.root_dir
            if workspace_init.platform_dir:
                sandbox_config_for_agent["platform_dir"] = workspace_init.platform_dir
            activity_logger.info(
                "Configuring agent for local mode (root=%s, platform_dir=%s)",
                workspace_backend.root_dir,
                workspace_init.platform_dir,
            )
        
        if merged_env_vars:
            sandbox_config_for_agent["env_vars"] = dict(merged_env_vars)
            activity_logger.info(
                "Injecting %d env var(s) into sandbox config for shell execution",
                len(merged_env_vars),
            )

        # Multi-local-path: collect host paths so the FilesystemBackend
        # can accept resolved symlink targets in its containment check
        # and rewrite absolute host paths to entry-relative form.
        if len(provision_results) > 1 and sandbox is None:
            local_roots: dict[str, str] = {
                pr.entry_name: pr.root_dir
                for pr in provision_results
                if pr.source_type == SourceType.LOCAL_PATH and pr.entry_name
            }
            if local_roots:
                sandbox_config_for_agent["allowed_roots"] = local_roots
                activity_logger.info(
                    "Configured %d allowed root(s) for multi-local-path: %s",
                    len(local_roots),
                    ", ".join(f"{n}={p}" for n, p in local_roots.items()),
                )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Resolve model name for logging/diagnostics only.
        #
        # The actual model creation and configuration (ANTHROPIC_DEFAULTS, thinking,
        # etc.) happens inside create_deep_agent() → parse_model_string().  This
        # early resolve is kept only so we can log the resolved API model ID and
        # include it in heartbeats.
        # ─────────────────────────────────────────────────────────────────────────────
        api_model_id, _ = ModelRegistry.resolve_or_passthrough(
            model_name,
            provider=worker_config.llm.provider,
        )
        
        if api_model_id != model_name:
            activity_logger.info(
                f"Resolved model '{model_name}' to API model ID '{api_model_id}'"
            )
        
        # Build provider-specific kwargs for model creation.
        # The model name is passed as a string to create_deep_agent(), which
        # routes it through parse_model_string() to apply ANTHROPIC_DEFAULTS,
        # thinking configuration, and all model-registry metadata.
        llm_kwargs: dict[str, Any] = {}
        if worker_config.llm.provider == "ollama":
            llm_kwargs["base_url"] = worker_config.llm.base_url
        elif worker_config.llm.provider == "anthropic":
            llm_kwargs["api_key"] = worker_config.llm.api_key
        elif worker_config.llm.provider == "openai":
            llm_kwargs["api_key"] = worker_config.llm.api_key
        
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
        # - Platform tools (read, write, ls, glob, grep, execute) from the sandbox
        # - Filtered MCP access based on McpAccess grants (subset of parent's tools)
        # - Resolved skills injected into system_prompt
        #
        # Permission model:
        # - Every subagent receives the full platform tool set from the sandbox
        # - SubAgent can only access MCP servers explicitly listed in mcp_access
        # - SubAgent MCP tools = intersection of parent's enabled tools and subagent's request
        # - SubAgent skills are independent (can reference any Skill resource)
        # ─────────────────────────────────────────────────────────────────────────────
        
        transformed_subagents = None
        
        if agent.spec.sub_agents:
            activity_logger.info(
                f"Transforming {len(agent.spec.sub_agents)} sub-agent(s): "
                f"{[sa.name for sa in agent.spec.sub_agents]}"
            )
            
            try:
                transformed_subagents = await transform_sub_agents(
                    sub_agents=list(agent.spec.sub_agents),
                    parent_mcp_servers=mcp_servers_config or {},
                    parent_mcp_tools=mcp_tools_config or {},
                    parent_mcp_usages=list(mcp_server_usages) if mcp_server_usages else [],
                    skill_client=skill_client,
                    skill_writer_class=SkillWriter,
                    skill_writer_kwargs={"backend": workspace_backend},
                    sandbox_config=sandbox_config_for_agent,
                    approval_checker=approval_checker,
                    activity_logger=activity_logger,
                )
                
                if transformed_subagents:
                    activity_logger.info(
                        f"Successfully transformed {len(transformed_subagents)} sub-agent(s) "
                        f"with platform tools, MCP tools, and skills"
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
        # Recursion limit: graphton's default (1000) applies via with_config()
        # at graph compilation time unless overridden by the user via
        # ExecutionConfig.max_tool_rounds.  The default gives the main agent
        # ~166 model+tool rounds (~4 min).  Loop detection middleware is the
        # primary behavioral safety; the recursion limit is the cost ceiling.
        # Sub-agent graphs use deepagents' DEFAULT_RECURSION_LIMIT (10,000),
        # giving them generous room independently.
        #
        # Graphton's ExecutionBudgetMiddleware injects a wrap-up SystemMessage
        # at ~80 % of the budget, and LoopDetectionMiddleware provides
        # pattern-based intervention.  The hard stop at 100 % is LangGraph's
        # GraphRecursionError, handled below.
        #
        # Sandbox tools: graphton creates platform tool wrappers (read, write,
        # edit, execute, ls, glob, grep) backed by the sandbox. deepagents also
        # creates in-memory filesystem tools (read_file, write_file, edit_file)
        # via its FilesystemMiddleware. Both sets coexist in the tool registry.
        agent_kwargs: dict[str, Any] = dict(
            model=model_name,
            system_prompt=enhanced_system_prompt,
            mcp_servers=mcp_servers_config if mcp_servers_config else None,
            mcp_tools=mcp_tools_config if mcp_tools_config else None,
            tools=None,
            subagents=transformed_subagents,
            sandbox_config=sandbox_config_for_agent,
            checkpointer=checkpointer,
            approval_checker=approval_checker,
            summarization_config=summarization_config,
            summarization_callback=status_builder,
            max_tool_result_chars=max_tool_result_chars,
            tool_truncation_callback=_on_tool_truncation,
            max_cost_usd=max_cost_usd,
            cost_pricing=cost_pricing,
            **llm_kwargs,
        )
        if recursion_limit is not None:
            agent_kwargs["recursion_limit"] = recursion_limit
        agent_graph = create_deep_agent(**agent_kwargs)
        
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
        # recursion_limit is set HERE in the invoke config — this is the
        # authoritative override.  The invoke config is the LAST config
        # processed by LangGraph's merge_configs chain, so it takes priority
        # over any .with_config() bindings (including deepagents' internal
        # recursion_limit=1000).
        #
        # Additionally, LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000 is set in
        # the agent-runner environment (daemon_process.go) as a framework-wide
        # default that also covers subagent graphs.
        unlimited_recursion = 10_000_000
        effective_recursion_limit = (
            recursion_limit if recursion_limit is not None else unlimited_recursion
        )
        config = {
            "configurable": {
                "thread_id": thread_id,
                "org": execution.metadata.org,
            },
            "recursion_limit": effective_recursion_limit,
        }
        
        activity_logger.info(
            "Using thread_id=%s for Graphton execution %s "
            "(recursion_limit=%d%s)",
            thread_id, execution_id,
            effective_recursion_limit,
            " [unlimited]" if recursion_limit is None else "",
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
            needs_interrupt_discovery: list[tuple[PendingApproval, dict[str, str]]] = []
            loop_aborted = False
            
            for pa in pending_approvals:
                decision = decisions_by_tool_call.get(pa.tool_call_id)
                if not decision:
                    activity_logger.warning(
                        f"⚠️ pending_approvals entry tool_call_id={pa.tool_call_id} "
                        f"has no matching approval_decision. Skipping batch resume."
                    )
                    loop_aborted = True
                    break
                
                action_str = _action_map.get(decision.action, "unknown")
                decision_value: dict[str, str] = {"action": action_str}
                if decision.comment:
                    decision_value["comment"] = decision.comment
                
                if pa.interrupt_id:
                    resume_dict[pa.interrupt_id] = decision_value
                else:
                    needs_interrupt_discovery.append((pa, decision_value))
            
            if loop_aborted:
                resume_dict = {}
            
            # Defense-in-depth: when Phase 2 enrichment failed to populate
            # interrupt_id (e.g., legacy from_sub_agent mismatch), query the
            # graph checkpoint to discover the actual interrupt IDs.
            if not loop_aborted and needs_interrupt_discovery:
                activity_logger.info(
                    f"[DIAG] Resume path: {len(needs_interrupt_discovery)} "
                    f"pending approval(s) need interrupt discovery: "
                    + ", ".join(
                        f"tool={pa.tool_name} tc_id={pa.tool_call_id}"
                        for pa, _ in needs_interrupt_discovery
                    )
                )
                try:
                    graph_state = await agent_graph.aget_state(
                        cast(RunnableConfig, config)
                    )
                    if graph_state and graph_state.interrupts:
                        activity_logger.info(
                            f"[DIAG] Resume path: {len(graph_state.interrupts)} "
                            f"interrupt(s) in graph state: "
                            + ", ".join(
                                f"id={i.id} tool={i.value.get('tool_name', '') if isinstance(i.value, dict) else ''}"
                                for i in graph_state.interrupts
                            )
                        )
                        consumed_ids = set(resume_dict.keys())
                        available_interrupts = [
                            i for i in graph_state.interrupts
                            if i.id not in consumed_ids
                        ]
                        for pa, dv in needs_interrupt_discovery:
                            matched_intr = None
                            for intr in available_interrupts:
                                intr_value = intr.value if hasattr(intr, "value") else {}
                                intr_tool = (
                                    intr_value.get("tool_name", "")
                                    if isinstance(intr_value, dict) else ""
                                )
                                if intr_tool == pa.tool_name:
                                    matched_intr = intr
                                    break
                            if not matched_intr and len(available_interrupts) == 1 and len(needs_interrupt_discovery) == 1:
                                matched_intr = available_interrupts[0]
                            if matched_intr:
                                resume_dict[matched_intr.id] = dv
                                available_interrupts.remove(matched_intr)
                                activity_logger.info(
                                    f"[RESUME_FALLBACK] Discovered interrupt_id="
                                    f"{matched_intr.id} for tool={pa.tool_name} "
                                    f"tc_id={pa.tool_call_id} via graph checkpoint"
                                )
                            else:
                                activity_logger.warning(
                                    f"⚠️ [RESUME_PARTIAL] Cannot discover interrupt_id "
                                    f"for tool={pa.tool_name} tc_id={pa.tool_call_id}. "
                                    f"Skipping — partial resume will proceed with "
                                    f"{len(resume_dict)} resolved interrupt(s)."
                                )
                    else:
                        activity_logger.warning(
                            "[RESUME_FALLBACK] No interrupts in graph checkpoint. "
                            "Proceeding with %d already-resolved interrupt(s).",
                            len(resume_dict),
                        )
                except Exception as e:
                    activity_logger.warning(
                        f"[RESUME_FALLBACK] Failed to query graph state for "
                        f"interrupt discovery: {e}. Proceeding with "
                        f"{len(resume_dict)} already-resolved interrupt(s)."
                    )
            
            # ── Defense-in-depth: checkpoint-based interrupt discovery ──────
            #
            # When approval_decisions is non-empty but pending_approvals was
            # completely empty (e.g., cleared by the Go/Java handler before
            # this activity was re-invoked), discover interrupt IDs directly
            # from the LangGraph checkpoint -- the source of truth for
            # in-flight interrupts.
            if not resume_dict and not loop_aborted:
                activity_logger.warning(
                    "[RESUME_CHECKPOINT_FALLBACK] pending_approvals empty but "
                    "%d approval_decision(s) present. Attempting interrupt "
                    "discovery from LangGraph checkpoint.",
                    len(approval_decisions),
                )
                try:
                    graph_state = await agent_graph.aget_state(
                        cast(RunnableConfig, config)
                    )
                    if graph_state and graph_state.interrupts:
                        activity_logger.info(
                            "[RESUME_CHECKPOINT_FALLBACK] Found %d interrupt(s) "
                            "in checkpoint: %s",
                            len(graph_state.interrupts),
                            ", ".join(
                                f"id={i.id} tool={i.value.get('tool_name', '') if isinstance(i.value, dict) else ''}"
                                for i in graph_state.interrupts
                            ),
                        )
                        remaining_decisions = dict(decisions_by_tool_call)
                        for intr in graph_state.interrupts:
                            if not remaining_decisions:
                                break
                            intr_value = (
                                intr.value if isinstance(intr.value, dict) else {}
                            )
                            intr_tool = intr_value.get("tool_name", "")
                            # Match by tool_name against remaining decisions
                            matched_tc_id = None
                            for tc_id, dec in remaining_decisions.items():
                                if intr_tool and intr_tool == (
                                    next(
                                        (
                                            pa.tool_name
                                            for pa in execution.status.pending_approvals
                                            if pa.tool_call_id == tc_id
                                        ),
                                        "",
                                    )
                                ):
                                    matched_tc_id = tc_id
                                    break
                            # If tool_name matching failed but counts align 1:1
                            if (
                                matched_tc_id is None
                                and len(graph_state.interrupts) == 1
                                and len(remaining_decisions) == 1
                            ):
                                matched_tc_id = next(iter(remaining_decisions))
                            if matched_tc_id is not None:
                                dec = remaining_decisions.pop(matched_tc_id)
                                action_str = _action_map.get(
                                    dec.action, "unknown"
                                )
                                dv: dict[str, str] = {"action": action_str}
                                if dec.comment:
                                    dv["comment"] = dec.comment
                                resume_dict[intr.id] = dv
                                activity_logger.info(
                                    "[RESUME_CHECKPOINT_FALLBACK] Matched "
                                    "interrupt_id=%s to tool_call_id=%s "
                                    "(tool=%s) via checkpoint",
                                    intr.id,
                                    matched_tc_id,
                                    intr_tool,
                                )
                    else:
                        activity_logger.warning(
                            "[RESUME_CHECKPOINT_FALLBACK] No interrupts in "
                            "checkpoint. LangGraph may have already processed "
                            "the resume. Proceeding with fresh execution."
                        )
                except Exception as e:
                    activity_logger.warning(
                        "[RESUME_CHECKPOINT_FALLBACK] Checkpoint query failed: "
                        "%s. Proceeding with fresh execution.",
                        e,
                    )
            
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
                ApprovalAction.APPROVAL_ACTION_REJECT: ToolCallStatus.TOOL_CALL_SKIPPED,
            }
            
            # Index decisions by tool_call_id for O(1) lookup
            decisions_by_tc = {d.tool_call_id: d for d in approval_decisions}
            
            reconciled_count = 0
            
            def _reconcile_tool_call(tc: Any, context: str) -> bool:
                """Update a single tool call from WAITING_APPROVAL to its post-decision status.
                
                Returns True if the tool call was reconciled.
                """
                nonlocal reconciled_count
                if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                    return False
                decision = decisions_by_tc.get(tc.id)
                if decision is None:
                    return False
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
                    f"tool_call={tc.id} name={tc.name} context={context} "
                    f"WAITING_APPROVAL -> {ToolCallStatus.Name(new_status)}"
                )
                return True
            
            for tc in status_builder.current_status.tool_calls:
                _reconcile_tool_call(tc, context="top-level")
            
            for sa in status_builder.current_status.sub_agent_executions:
                for tc in sa.tool_calls:
                    _reconcile_tool_call(tc, context=f"sub-agent:{sa.name}")
            
            # Sync message-embedded tool call copies.
            # Protobuf repeated-field append creates independent copies,
            # so the ToolCall on the AI message and the one in the flat
            # tool_calls list are separate objects.  RESUME_RECONCILE must
            # update both to prevent stale WAITING_APPROVAL status from
            # persisting in the message-embedded copies (which are sent
            # to the DB via update_status and rendered by the UI).
            for tc_id, decision in decisions_by_tc.items():
                new_status = _approval_to_tool_status.get(
                    decision.action, ToolCallStatus.TOOL_CALL_RUNNING
                )
                status_builder._update_tool_call_on_ai_message(
                    tc_id,
                    status_builder.current_status.messages,
                    status=new_status,
                )
            for sa in status_builder.current_status.sub_agent_executions:
                for tc_id, decision in decisions_by_tc.items():
                    new_status = _approval_to_tool_status.get(
                        decision.action, ToolCallStatus.TOOL_CALL_RUNNING
                    )
                    status_builder._update_tool_call_on_ai_message(
                        tc_id,
                        sa.messages,
                        status=new_status,
                    )
            
            # Defensive: warn about any WAITING_APPROVAL tool calls that
            # were not reconciled.  This catches edge cases where the
            # decision's tool_call_id doesn't match due to encoding
            # differences, truncation, or other mismatches.
            for tc in status_builder.current_status.tool_calls:
                if tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                    activity_logger.warning(
                        f"[RESUME_RECONCILE] execution={execution_id} "
                        f"tool_call={tc.id} name={tc.name} still "
                        f"WAITING_APPROVAL after reconciliation — "
                        f"no matching decision found "
                        f"(decisions: {list(decisions_by_tc.keys())})"
                    )
            
            # Auto-skip remaining WAITING_APPROVAL tools when a REJECT was
            # in the batch.  The Go workflow short-circuits signal collection
            # on REJECT, so these tools never received a decision.  Mark them
            # as skipped so the agent gets a clear picture of what happened.
            has_reject = any(
                d.action == ApprovalAction.APPROVAL_ACTION_REJECT
                for d in approval_decisions
            )
            if has_reject:
                def _auto_skip_tool_call(tc: Any, context: str) -> None:
                    if tc.status != ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
                        return
                    tc.status = ToolCallStatus.TOOL_CALL_SKIPPED
                    tc.approval_action = ApprovalAction.APPROVAL_ACTION_SKIP
                    tc.approval_decided_at = _utc_timestamp()
                    tc.result = (
                        f"Tool '{tc.name}' was automatically skipped because "
                        "another tool in this batch was rejected by the user."
                    )
                    activity_logger.info(
                        f"[RESUME_RECONCILE] execution={execution_id} "
                        f"tool_call={tc.id} name={tc.name} context={context} "
                        f"WAITING_APPROVAL -> TOOL_CALL_SKIPPED (auto-skip after reject)"
                    )
                
                for tc in status_builder.current_status.tool_calls:
                    _auto_skip_tool_call(tc, context="top-level")
                for sa in status_builder.current_status.sub_agent_executions:
                    for tc in sa.tool_calls:
                        _auto_skip_tool_call(tc, context=f"sub-agent:{sa.name}")
                
                # Sync auto-skip to message-embedded copies
                for tc in status_builder.current_status.tool_calls:
                    if tc.status == ToolCallStatus.TOOL_CALL_SKIPPED:
                        status_builder._update_tool_call_on_ai_message(
                            tc.id,
                            status_builder.current_status.messages,
                            status=ToolCallStatus.TOOL_CALL_SKIPPED,
                        )
                for sa in status_builder.current_status.sub_agent_executions:
                    for tc in sa.tool_calls:
                        if tc.status == ToolCallStatus.TOOL_CALL_SKIPPED:
                            status_builder._update_tool_call_on_ai_message(
                                tc.id,
                                sa.messages,
                                status=ToolCallStatus.TOOL_CALL_SKIPPED,
                            )
            
            # Clear stale pending_approvals — they are no longer pending.
            del status_builder.current_status.pending_approvals[:]
            
            # Add clear-signal so the Go/Java UpdateStatus handler clears
            # pending_approvals from the DB.  Protobuf3 treats an empty repeated
            # field as absent, so the merge logic would otherwise preserve the
            # stale entries.  A single PendingApproval with empty tool_call_id
            # is the established sentinel that triggers the "clear" path in
            # BuildNewStateWithStatusStep.
            status_builder.current_status.pending_approvals.append(
                PendingApproval(tool_call_id="")
            )
            
            # Pre-populate fingerprints from existing tool calls to prevent
            # duplicates when LangGraph re-fires on_tool_start for resumed tools
            status_builder.populate_fingerprints_from_existing_tool_calls()
            
            activity_logger.info(
                f"[RESUME_RECONCILE] execution={execution_id} "
                f"reconciled {reconciled_count} tool call(s), "
                f"synced message-embedded copies, "
                f"queued pending_approvals clear-signal, "
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
        default_grpc_update_timeout = 10
        grpc_update_timeout_seconds = int(
            os.environ.get(
                "GRAPHTON_GRPC_UPDATE_TIMEOUT_SECONDS",
                default_grpc_update_timeout,
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
        # The update transitions the phase to IN_PROGRESS. The approval
        # outcome is already recorded on the ToolCall proto via
        # approval_action / approval_decided_at — the UI renders this
        # inline on the tool call item, so no system message is needed.
        # ─────────────────────────────────────────────────────────────────────────────
        if is_resume_from_approval:

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
        # output), no events are emitted — this gap can exceed the Temporal heartbeat
        # timeout, causing Temporal to kill the activity.
        #
        # This background task sends heartbeats at a fixed 10-second interval,
        # independent of event arrival. It runs concurrently with the event stream
        # and is cancelled when the stream completes (or errors).
        # ─────────────────────────────────────────────────────────────────────────────
        async def _background_heartbeat() -> None:
            """Send periodic heartbeats to Temporal, independent of event stream."""
            background_heartbeat_interval = 10.0  # seconds (well within 120s timeout)
            hb_count = 0
            while True:
                await asyncio.sleep(background_heartbeat_interval)
                hb_count += 1
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
                    activity_logger.info(
                        f"[HEARTBEAT] execution={execution_id} "
                        f"seq={hb_count} events={events_processed} "
                        f"source=background"
                    )
                except BaseException as hb_err:
                    activity_logger.info(
                        f"[HEARTBEAT] execution={execution_id} "
                        f"seq={hb_count} failed: {type(hb_err).__name__}: {hb_err}"
                    )
                    if isinstance(hb_err, (asyncio.CancelledError, KeyboardInterrupt)):
                        raise
        
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
        default_stall_timeout = 300
        stall_timeout_seconds = int(
            os.environ.get("GRAPHTON_STALL_TIMEOUT_SECONDS", default_stall_timeout)
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
                    #
                    # force_next_update: set by StatusBuilder when a new ToolCall
                    # is created (early tool call or thinking stream).  Bypasses
                    # the scheduler so the CLI sees the tool name immediately
                    # instead of waiting up to 30s for the next event-driven check.
                    force_update = status_builder.force_next_update
                    if force_update:
                        status_builder.force_next_update = False
                    if force_update or update_scheduler.should_send_update(events_processed):
                        reason = "force_tool_update" if force_update else update_scheduler.get_update_reason_str()
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
                            
                        except TimeoutError:
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


            
            pause_msg = AgentMessage(
                type=MessageType.MESSAGE_SYSTEM,
                content="⏸️ Execution paused by user. Use resume to continue from this checkpoint.",
                timestamp=_utc_timestamp(),
            )
            status_builder.current_status.messages.append(pause_msg)
            
            # Stamp completed_at and finalize usage so partial cost data is persisted
            if not status_builder.current_status.completed_at:
                status_builder.current_status.completed_at = _utc_timestamp()
            status_builder.finalize_usage()
            
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
            
            # Return slim status to workflow (full status already persisted via gRPC above)
            return _slim_status_for_temporal(status_builder.current_status)
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

            status_builder.finalize_active_sub_agents(
                SubAgentStatus.SUB_AGENT_CANCELLED,
                "Parent execution stalled — no events received",
            )

            # Finalize any accumulated data before reporting termination
            status_builder.finalize_context_info()
            

            
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
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_TERMINATED
            status_builder.current_status.error = stall_msg
            
            # Stamp completed_at and finalize usage so partial cost data is persisted
            if not status_builder.current_status.completed_at:
                status_builder.current_status.completed_at = _utc_timestamp()
            status_builder.finalize_usage()
            
            # Best-effort status persistence
            try:
                activity_logger.info("📤 [STALL] Sending TERMINATED status update")
                await execution_client.update_status(
                    execution_id=execution_id,
                    status=status_builder.current_status,
                )
            except Exception as update_err:
                activity_logger.warning(f"[STALL] Failed to send status update: {update_err}")
            
            return _slim_status_for_temporal(status_builder.current_status)
        except Exception as stream_err:
            # ─────────────────────────────────────────────────────────────────────────────
            # Tool-Call Limit: LangGraph's recursion_limit reached.
            #
            # The agent exhausted its super-step budget.  By default the limit
            # is effectively unlimited (10M); this fires only when
            # max_tool_rounds is explicitly set in ExecutionConfig.
            # ExecutionBudgetMiddleware injected a wrap-up SystemMessage at
            # ~80% of the budget; this handler fires at 100%.
            #
            # We catch this via type-name check rather than importing at module
            # level, consistent with the lazy-import pattern used throughout
            # this file.  GraphRecursionError is a subclass of Exception.
            # ─────────────────────────────────────────────────────────────────────────────
            if type(stream_err).__name__ == "GraphRecursionError":
                limit_msg = (
                    f"Agent reached the tool-call limit after processing "
                    f"{events_processed} events. "
                    f"Send another message to continue."
                )
                activity_logger.warning(
                    "[RECURSION_LIMIT] execution=%s events=%d "
                    "invoke_config_limit=%d original_error=%s",
                    execution_id, events_processed,
                    effective_recursion_limit, stream_err,
                )

                status_builder.finalize_active_sub_agents(
                    SubAgentStatus.SUB_AGENT_CANCELLED,
                    "Parent execution reached tool-call limit",
                )

                status_builder.finalize_context_info()



                limit_error_msg = AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content=(
                        "🔄 The agent reached the tool-call limit for this message. "
                        "Work completed so far has been saved. "
                        "Send another message to continue where the agent left off."
                    ),
                    timestamp=_utc_timestamp(),
                )
                status_builder.current_status.messages.append(limit_error_msg)
                status_builder.current_status.phase = ExecutionPhase.EXECUTION_TERMINATED
                status_builder.current_status.error = limit_msg

                # Stamp completed_at and finalize usage so partial cost data is persisted
                if not status_builder.current_status.completed_at:
                    status_builder.current_status.completed_at = _utc_timestamp()
                status_builder.finalize_usage()

                try:
                    activity_logger.info("📤 [RECURSION_LIMIT] Sending TERMINATED status update")
                    await execution_client.update_status(
                        execution_id=execution_id,
                        status=status_builder.current_status,
                    )
                except Exception as update_err:
                    activity_logger.warning(
                        f"[RECURSION_LIMIT] Failed to send status update: {update_err}"
                    )

                return _slim_status_for_temporal(status_builder.current_status)

            # Not a GraphRecursionError — re-raise for the outer handler.
            raise
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
                            workspace_backend.root_dir
                            if sandbox is None
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
        # Post-Stream Checkpoint Query
        #
        # Query the LangGraph checkpoint unconditionally.  The checkpoint is the
        # authoritative record of what actually happened during execution —
        # StatusBuilder's view is derived from stream events and can diverge.
        #
        # The graph_state is used for:
        #   1. Checkpoint validation — cross-references stream-derived state
        #      against the checkpoint's ground truth (messages, tool completion,
        #      graph termination status).
        #   2. Interrupt capture — discovers pending interrupts when the phase
        #      is WAITING_FOR_APPROVAL (batch approval support).
        #
        # Cost: single MongoDB/SQLite document lookup by thread_id (<10ms).
        # ─────────────────────────────────────────────────────────────────────────────
        graph_state = None  # type: ignore[assignment]
        try:
            graph_state = await agent_graph.aget_state(
                cast(RunnableConfig, config)
            )
        except Exception as state_err:
            activity_logger.warning(
                f"[CHECKPOINT_QUERY] execution={execution_id} — "
                f"aget_state() failed (non-fatal, validation skipped): "
                f"{state_err}"
            )

        # ─────────────────────────────────────────────────────────────────────────────
        # Post-Stream Checkpoint Validation
        #
        # Validates StatusBuilder's stream-derived state against the checkpoint's
        # ground truth.  Detects:
        #   V1: Graph has pending nodes but stream ended (abnormal termination)
        #   V2: Tool calls requested by the model that never completed
        #   V3: Sub-agent completion mismatch between checkpoint and StatusBuilder
        #   V4: AI message count divergence (canary for systematic event loss)
        #
        # The validation result drives the phase decision below, replacing the
        # stream-only has_orphaned_sub_agents check with checkpoint-verified logic.
        # ─────────────────────────────────────────────────────────────────────────────
        from worker.activities.graphton.checkpoint_validator import (
            build_error_from_validation,
            validate_against_checkpoint,
        )

        status_ai_message_count = sum(
            1
            for m in status_builder.current_status.messages
            if m.type == MessageType.MESSAGE_AI
        )

        validation = validate_against_checkpoint(
            graph_state=graph_state,
            active_sub_agent_count=len(status_builder._active_sub_agents),
            status_ai_message_count=status_ai_message_count,
            execution_phase=status_builder.current_status.phase,
            waiting_for_approval_phase=ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
            paused_phase=ExecutionPhase.EXECUTION_PAUSED,
        )

        for d in validation.discrepancies:
            log_fn = (
                activity_logger.error
                if d.severity == "error"
                else activity_logger.warning
            )
            log_fn(
                f"[CHECKPOINT_VALIDATION] execution={execution_id} "
                f"{d.category}: {d.description}"
            )

        if not validation.discrepancies:
            activity_logger.info(
                f"[CHECKPOINT_VALIDATION] execution={execution_id} — "
                f"all checks passed"
            )

        # ─────────────────────────────────────────────────────────────────────────────
        # Post-Stream Interrupt Capture (Batch Approval — Multiple Interrupts)
        #
        # When the event stream ends because of interrupt() calls, LangGraph has
        # already checkpointed the graph state with pending interrupts.  We use
        # the graph_state already fetched above to discover ALL pending interrupts
        # (there may be more than one when the LLM issued multiple tool calls
        # that each require approval).
        #
        # For every interrupt we build a PendingApproval proto with the
        # LangGraph-assigned interrupt_id.  This enables the resume logic to
        # construct Command(resume={id_A: decision_A, ...}) which LangGraph
        # requires when multiple interrupts coexist.
        # ─────────────────────────────────────────────────────────────────────────────
        if status_builder.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
            try:
                if graph_state and graph_state.interrupts:
                    # ── Diagnostic: log every raw interrupt before matching ──
                    for _diag_idx, _diag_intr in enumerate(graph_state.interrupts):
                        _diag_val = _diag_intr.value if hasattr(_diag_intr, "value") else {}
                        activity_logger.info(
                            f"[DIAG] Raw interrupt [{_diag_idx}]: "
                            f"id={_diag_intr.id} "
                            f"tool_name={_diag_val.get('tool_name', '') if isinstance(_diag_val, dict) else ''} "
                            f"from_sub_agent={_diag_val.get('from_sub_agent', False) if isinstance(_diag_val, dict) else False} "
                            f"sub_agent_name={_diag_val.get('sub_agent_name', '') if isinstance(_diag_val, dict) else ''} "
                            f"run_id={_diag_val.get('run_id', '') if isinstance(_diag_val, dict) else ''} "
                            f"value_type={type(_diag_val).__name__}"
                        )

                    phase1_count = len(status_builder.current_status.pending_approvals)
                    enriched_count = 0
                    added_count = 0
                    skipped_count = 0

                    # Index Phase 1 entries by tool_call_id for O(1) lookup
                    phase1_by_tc_id: dict[str, PendingApproval] = {
                        pa.tool_call_id: pa
                        for pa in status_builder.current_status.pending_approvals
                        if pa.tool_call_id
                    }

                    matched_tc_ids: set[str] = set()

                    for intr in graph_state.interrupts:
                        intr_value = intr.value if hasattr(intr, "value") else {}
                        tool_name = intr_value.get("tool_name", "") if isinstance(intr_value, dict) else ""
                        tool_args = intr_value.get("tool_args", {}) if isinstance(intr_value, dict) else {}
                        message = intr_value.get("message", "") if isinstance(intr_value, dict) else ""
                        from_sub_agent = intr_value.get("from_sub_agent", False) if isinstance(intr_value, dict) else False
                        sub_agent_name = intr_value.get("sub_agent_name", "") if isinstance(intr_value, dict) else ""
                        intr_run_id = intr_value.get("run_id", "") if isinstance(intr_value, dict) else ""

                        matched_tool_call_id = ""

                        # ── Priority 1: run_id-based matching ──
                        # The interrupt payload carries the LangGraph run_id
                        # which maps to the early-toolu_... tool_call_id via
                        # _run_id_aliases.
                        if intr_run_id:
                            resolved = status_builder._run_id_aliases.get(intr_run_id, intr_run_id)
                            if resolved not in matched_tc_ids:
                                matched_tool_call_id = resolved
                                matched_tc_ids.add(resolved)
                            else:
                                activity_logger.info(
                                    f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                    f"run_id={intr_run_id} resolved={resolved} "
                                    f"already in matched_tc_ids — falling through"
                                )
                        elif tool_name:
                            activity_logger.info(
                                f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                f"interrupt {intr.id} tool={tool_name} has empty "
                                f"run_id — falling through to fingerprint/name matching"
                            )

                        # ── Priority 2: fingerprint-based matching ──
                        # Compute a fingerprint from the interrupt's tool_args
                        # and look up _fingerprint_to_tool_call_id.  This handles
                        # the resume-after-approval case where run_id matching
                        # fails but the tool's args uniquely identify the correct
                        # tool call (different content = different fingerprint).
                        if not matched_tool_call_id and tool_args:
                            intr_fp = status_builder._get_tool_fingerprint(
                                tool_name, tool_args,
                            )
                            fp_tc_id = status_builder._fingerprint_to_tool_call_id.get(
                                intr_fp, "",
                            )
                            if fp_tc_id and fp_tc_id not in matched_tc_ids:
                                # Verify the tool call exists and is WAITING_APPROVAL
                                _fp_verified = False
                                for tc in status_builder.current_status.tool_calls:
                                    if (
                                        tc.id == fp_tc_id
                                        and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                                    ):
                                        _fp_verified = True
                                        break
                                if not _fp_verified:
                                    for sa in status_builder.current_status.sub_agent_executions:
                                        for tc in sa.tool_calls:
                                            if (
                                                tc.id == fp_tc_id
                                                and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                                            ):
                                                _fp_verified = True
                                                break
                                        if _fp_verified:
                                            break
                                if _fp_verified:
                                    matched_tool_call_id = fp_tc_id
                                    matched_tc_ids.add(fp_tc_id)
                                    activity_logger.info(
                                        f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                        f"interrupt {intr.id} matched via fingerprint: "
                                        f"tool={tool_name} tc_id={fp_tc_id}"
                                    )

                        # ── Priority 3: name-based matching ──
                        # Scoped by from_sub_agent to prevent cross-level
                        # mismatches.  When from_sub_agent is True, search
                        # sub-agent tool calls first; when False, search only
                        # top-level tool calls.
                        if not matched_tool_call_id:
                            if tool_name:
                                _candidates = [
                                    tc.id
                                    for tc in status_builder.current_status.tool_calls
                                    if (tc.name == tool_name
                                        or resolve_platform_tool_name(tc.name) == tool_name)
                                    and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                                    and tc.id not in matched_tc_ids
                                ]
                                activity_logger.info(
                                    f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                    f"interrupt {intr.id} falling back to name matching: "
                                    f"tool={tool_name} from_sub_agent={from_sub_agent} "
                                    f"candidates={_candidates}"
                                )
                            if from_sub_agent:
                                for sa in status_builder.current_status.sub_agent_executions:
                                    for tc in sa.tool_calls:
                                        tc_canonical = resolve_platform_tool_name(tc.name)
                                        if (
                                            (tc.name == tool_name or tc_canonical == tool_name)
                                            and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                                            and tc.id not in matched_tc_ids
                                        ):
                                            matched_tool_call_id = tc.id
                                            matched_tc_ids.add(tc.id)
                                            break
                                    if matched_tool_call_id:
                                        break
                                if not matched_tool_call_id:
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
                            else:
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
                                # Defense-in-depth: the interrupt payload may
                                # say from_sub_agent=False even though the tool
                                # actually belongs to a sub-agent (legacy
                                # wrappers).  Search sub-agent tool calls too.
                                if not matched_tool_call_id:
                                    for sa in status_builder.current_status.sub_agent_executions:
                                        for tc in sa.tool_calls:
                                            tc_canonical = resolve_platform_tool_name(tc.name)
                                            if (
                                                (tc.name == tool_name or tc_canonical == tool_name)
                                                and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
                                                and tc.id not in matched_tc_ids
                                            ):
                                                matched_tool_call_id = tc.id
                                                matched_tc_ids.add(tc.id)
                                                break
                                        if matched_tool_call_id:
                                            break  # type: ignore[unreachable]

                        # ── Merge strategy: enrich Phase 1 entries, never degrade ──
                        #
                        # Phase 1 (_populate_pending_approval) already created
                        # entries with valid tool_call_id during streaming.  This
                        # capture only adds the interrupt_id that LangGraph
                        # assigned after the stream ended.
                        #
                        # If matching failed (empty tool_call_id), fall back to
                        # enriching a Phase 1 entry by tool_name + from_sub_agent.
                        # Never create a PendingApproval with empty tool_call_id —
                        # that would trigger the "clear" sentinel in the
                        # controller/Temporal merge logic and wipe the DB.

                        if not matched_tool_call_id:
                            fallback_enriched = _try_enrich_phase1_entry(
                                status_builder, tool_name, from_sub_agent, intr.id,
                            )
                            if fallback_enriched:
                                enriched_count += 1
                                activity_logger.info(
                                    f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                    f"interrupt {intr.id} tool={tool_name} "
                                    f"from_sub_agent={from_sub_agent} — "
                                    f"enriched Phase 1 entry via tool_name fallback"
                                )
                            else:
                                skipped_count += 1
                                activity_logger.warning(
                                    f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                    f"cannot match interrupt {intr.id} tool={tool_name} "
                                    f"from_sub_agent={from_sub_agent} to any tool call — "
                                    f"Phase 1 entries preserved"
                                )
                            continue

                        # Create args preview via StatusBuilder's sanitiser
                        args_preview = status_builder._create_args_preview(tool_args)

                        display_message = humanize_platform_refs(message)
                        display_message = resolve_display_env_vars(
                            display_message, merged_env_vars, secret_keys,
                        )

                        if matched_tool_call_id in phase1_by_tc_id:
                            # Enrich the existing Phase 1 entry with interrupt_id
                            existing_pa = phase1_by_tc_id[matched_tool_call_id]
                            existing_pa.interrupt_id = intr.id
                            enriched_count += 1
                        else:
                            # Phase 2 matched a tool_call_id that Phase 1 didn't
                            # create an entry for.  Before appending, check if
                            # Phase 1 has a DIFFERENT tool_call_id for the same
                            # tool_name — that stale entry must be removed to
                            # prevent dual pending approvals that confuse the
                            # Temporal workflow's signal validation.
                            stale_phase1 = [
                                pa for pa in phase1_by_tc_id.values()
                                if pa.tool_name == tool_name
                                and pa.tool_call_id != matched_tool_call_id
                            ]
                            if stale_phase1:
                                for stale_pa in stale_phase1:
                                    activity_logger.warning(
                                        f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                        f"Phase 1 has tc_id={stale_pa.tool_call_id} "
                                        f"but interrupt matched tc_id={matched_tool_call_id} "
                                        f"for tool={tool_name} — removing stale Phase 1 entry"
                                    )
                                    try:
                                        status_builder.current_status.pending_approvals.remove(
                                            stale_pa,
                                        )
                                    except ValueError:
                                        pass
                            pa = PendingApproval(
                                tool_call_id=matched_tool_call_id,
                                tool_name=tool_name,
                                message=display_message,
                                args_preview=args_preview,
                                requested_at=_utc_timestamp(),
                                from_sub_agent=from_sub_agent,
                                sub_agent_name=sub_agent_name,
                                interrupt_id=intr.id,
                            )
                            status_builder.current_status.pending_approvals.append(pa)
                            added_count += 1

                    status_builder.sync_sub_agent_pending_approvals()

                    final_count = len(status_builder.current_status.pending_approvals)
                    activity_logger.info(
                        f"[INTERRUPT_CAPTURE] execution={execution_id} "
                        f"phase1={phase1_count} enriched={enriched_count} "
                        f"added={added_count} skipped={skipped_count} "
                        f"final={final_count}: "
                        + ", ".join(
                            f"tool={pa.tool_name} tc_id={pa.tool_call_id} "
                            f"interrupt_id={pa.interrupt_id}"
                            for pa in status_builder.current_status.pending_approvals
                        )
                    )

                    # Reset stale approval_action on ToolCalls whose tc_id
                    # reappears in the new pending_approvals. This prevents
                    # the Java SubmitApprovalHandler from treating a fresh
                    # approval in a new HITL cycle as idempotent due to a
                    # stale approval_action from a previous cycle.
                    pending_tc_ids = {
                        pa.tool_call_id
                        for pa in status_builder.current_status.pending_approvals
                        if pa.tool_call_id
                    }
                    if pending_tc_ids:
                        stale_reset_count = 0
                        for tc in status_builder.current_status.tool_calls:
                            if (tc.id in pending_tc_ids
                                    and tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED):
                                activity_logger.info(
                                    f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                    f"resetting stale approval_action={ApprovalAction.Name(tc.approval_action)} "
                                    f"on tool_call={tc.id} (now pending again in new cycle)"
                                )
                                tc.approval_action = ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
                                tc.approval_decided_at = ""
                                stale_reset_count += 1
                        for sa in status_builder.current_status.sub_agent_executions:
                            for tc in sa.tool_calls:
                                if (tc.id in pending_tc_ids
                                        and tc.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED):
                                    activity_logger.info(
                                        f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                        f"resetting stale approval_action={ApprovalAction.Name(tc.approval_action)} "
                                        f"on sub-agent tool_call={tc.id} (now pending again in new cycle)"
                                    )
                                    tc.approval_action = ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
                                    tc.approval_decided_at = ""
                                    stale_reset_count += 1
                        if stale_reset_count > 0:
                            activity_logger.info(
                                f"[INTERRUPT_CAPTURE] execution={execution_id} "
                                f"reset {stale_reset_count} stale approval_action(s) "
                                f"on ToolCalls that are pending again in a new cycle"
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
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Post-Stream Phase Decision: Checkpoint-Validated
        #
        # The event stream can end for several reasons:
        #   1. Normal completion — LLM produced a final response, no more work.
        #   2. HITL interrupt — graph paused at checkpoint for approval.
        #   3. Graceful pause — user requested pause, handled above.
        #   4. Abnormal termination — graph crashed internally and the stream
        #      ended without raising an exception.
        #   5. Missed events — sub-agents completed in the graph but
        #      StatusBuilder missed the on_tool_end events.
        #
        # Cases 2 and 3 are handled by phase checks (set during processing).
        # Cases 4 and 5 are distinguished by checkpoint validation:
        #   - validation.has_errors → case 4 (confirmed abnormal termination)
        #   - validation.missed_event_count > 0 without errors → case 5
        #     (execution completed normally, StatusBuilder just missed events)
        #
        # Defense-in-depth: if aget_state() failed (graph_state=None),
        # validation produces a warning (no errors).  The fallback
        # has_orphaned_sub_agents check catches any remaining discrepancies.
        # ─────────────────────────────────────────────────────────────────────────────
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
        elif validation.has_errors:
            activity_logger.error(
                f"[CHECKPOINT_VALIDATION] execution={execution_id} — "
                f"Checkpoint confirms abnormal termination. "
                f"Errors: {[d.description for d in validation.discrepancies if d.severity == 'error']}"
            )
            finalized_count = (
                status_builder.finalize_sub_agents_from_checkpoint_validation(
                    missed_event_count=validation.missed_event_count,
                    confirmed_orphan_count=validation.confirmed_orphan_count,
                    error_context=(
                        "Checkpoint validation: execution terminated abnormally"
                    ),
                )
            )
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
            status_builder.current_status.error = build_error_from_validation(
                validation
            )
            activity_logger.info(
                f"[CHECKPOINT_VALIDATION] execution={execution_id} — "
                f"Finalized {finalized_count} sub-agent(s), "
                f"phase set to EXECUTION_FAILED."
            )
        elif validation.missed_event_count > 0:
            activity_logger.info(
                f"[CHECKPOINT_VALIDATION] execution={execution_id} — "
                f"Checkpoint confirms {validation.missed_event_count} "
                f"sub-agent(s) completed (StatusBuilder missed events). "
                f"Execution completed normally."
            )
            status_builder.finalize_sub_agents_from_checkpoint_validation(
                missed_event_count=validation.missed_event_count,
                confirmed_orphan_count=0,
                error_context="",
            )
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED
        elif status_builder.has_orphaned_sub_agents:
            diag = status_builder.get_orphaned_sub_agents_diagnostic()
            activity_logger.error(
                f"[RECONCILIATION] execution={execution_id} — "
                f"Checkpoint validation found no errors but StatusBuilder "
                f"still tracks {diag['total']} active sub-agent(s) "
                f"(checkpoint query may have failed). "
                f"Falling back to stream-derived reconciliation. "
                f"Details: {diag}"
            )
            finalized_count = (
                status_builder.finalize_active_sub_agents_differentiated(
                    error_context="Parent execution terminated abnormally"
                )
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
        
        final_phase_name = ExecutionPhase.Name(status_builder.current_status.phase)
        
        # Stamp completed_at and compute final usage metrics (duration, cost)
        if not status_builder.current_status.completed_at:
            status_builder.current_status.completed_at = _utc_timestamp()
        status_builder.finalize_usage()
        
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
            "✅ ExecuteGraphton completed - returning slim status to workflow"
        )
        
        # Return slim status to workflow (full status already persisted via gRPC above)
        return _slim_status_for_temporal(status_builder.current_status)
    
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


        
        error_msg = AgentMessage(
            type=MessageType.MESSAGE_SYSTEM,
            content=f"❌ Error: {error_message}",
            timestamp=_utc_timestamp(),
        )
        
        # Check if status_builder was initialized before the error occurred
        # If not, create a minimal failed status (handles early failures like attachment injection)
        if status_builder is not None:
            status_builder.finalize_active_sub_agents(
                SubAgentStatus.SUB_AGENT_FAILED,
                f"Parent execution failed: {error_message}",
            )

            # Use status_builder for rich error reporting
            status_builder.current_status.messages.append(error_msg)

            # Finalize context info before returning (Phase 3)
            # Even on failure, we want to capture any context tracking data
            status_builder.finalize_context_info()
            
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
            status_builder.current_status.error = error_message
            
            # Stamp completed_at and finalize usage so partial cost data is persisted
            if not status_builder.current_status.completed_at:
                status_builder.current_status.completed_at = _utc_timestamp()
            status_builder.finalize_usage()
            
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
        
        # Return slim status to workflow (full status already persisted via gRPC above)
        return _slim_status_for_temporal(failed_status)
    
    finally:
        # Clean up workspace backend (deletes the Daytona process session used
        # for sandbox command execution, if one was created).
        if workspace_backend is not None:
            workspace_backend.close()

        # Clean up checkpointer resources (SQLite connection, MongoDB client, etc.)
        # This runs regardless of success or failure, ensuring no resource leaks.
        await exit_stack.aclose()
        await grpc_provider.close()
