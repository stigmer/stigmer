"""Workspace backend abstraction for agent-runner.

Public API:
    WorkspaceBackend    -- Protocol for workspace file + process operations.
    ExecuteResult       -- Return type for ``WorkspaceBackend.execute()``.
    LocalWorkspaceBackend  -- Adapter backed by the local filesystem.
    DaytonaWorkspaceBackend -- Adapter backed by a Daytona sandbox.
    initialize_workspace   -- Factory that creates the right backend.
"""

from __future__ import annotations

import logging
from typing import Any

from worker.workspace.backend import ExecuteResult, WorkspaceBackend
from worker.workspace.daytona import DaytonaWorkspaceBackend
from worker.workspace.local import LocalWorkspaceBackend

logger = logging.getLogger(__name__)

__all__ = [
    "DaytonaWorkspaceBackend",
    "ExecuteResult",
    "LocalWorkspaceBackend",
    "WorkspaceBackend",
    "initialize_workspace",
]


async def initialize_workspace(
    *,
    worker_config: Any,
    sandbox_config: dict[str, Any],
    sandbox_manager: Any | None,
    session_id: str | None,
    session_client: Any,
    activity_logger: logging.Logger | None = None,
) -> tuple[WorkspaceBackend, Any | None, bool]:
    """Create the appropriate ``WorkspaceBackend`` for the current mode.

    This is the **single point** where the local-vs-cloud decision is
    made.  All downstream code receives a ``WorkspaceBackend`` and never
    branches on deployment mode.

    Returns:
        A three-tuple of ``(backend, sandbox_or_none, is_new_sandbox)``.

        *sandbox_or_none* is the raw Daytona ``Sandbox`` object in cloud
        mode (needed for agent configuration via ``sandbox.id``,
        auto-publish, and lifecycle cleanup) or ``None`` in local mode.
    """
    from worker.sandbox_manager import (
        DAYTONA_WORKSPACE_MOUNT_PATH,
        get_daytona_volume_id,
    )

    log = activity_logger or logger

    if worker_config.is_local_mode():
        root_dir = sandbox_config.get("root_dir")
        if not root_dir:
            raise ValueError(
                "sandbox_config['root_dir'] is required in local mode"
            )
        log.info("Local mode — workspace root: %s", root_dir)
        backend = LocalWorkspaceBackend(root_dir=root_dir)
        return backend, None, False

    # -- Cloud mode -----------------------------------------------------------

    if sandbox_manager is None:
        raise RuntimeError("Sandbox manager not initialized for cloud mode")

    log.info(
        "%s",
        (
            "Checking for existing sandbox in session"
            if session_id
            else "Creating ephemeral sandbox"
        ),
    )

    sandbox, is_new_sandbox = await sandbox_manager.get_or_create_daytona_sandbox(
        sandbox_config=sandbox_config,
        session_id=session_id,
        session_client=session_client,
    )

    log.info(
        "Sandbox %s: %s",
        "created" if is_new_sandbox else "reused",
        sandbox.id,
    )

    # Compute the authoritative workspace root.  When a persistent
    # volume is mounted (volume_id + session_id), the root is the
    # volume mount path.  Otherwise fall back to the SDK's discovery.
    volume_id = get_daytona_volume_id()
    if volume_id and session_id:
        workspace_root = DAYTONA_WORKSPACE_MOUNT_PATH
        log.info(
            "Volume-backed workspace: workspace_root=%s "
            "(volume_id=%s, session_id=%s)",
            workspace_root,
            volume_id,
            session_id,
        )
    else:
        try:
            workspace_root = sandbox.get_work_dir().rstrip("/")
            log.info("Sandbox workspace root (get_work_dir): %s", workspace_root)
        except Exception as exc:
            workspace_root = "/home/daytona"
            log.warning(
                "sandbox.get_work_dir() failed (%s); "
                "falling back to %s",
                exc,
                workspace_root,
            )

    backend = DaytonaWorkspaceBackend(
        sandbox=sandbox, workspace_root=workspace_root,
    )
    return backend, sandbox, is_new_sandbox
