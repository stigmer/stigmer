"""Workspace backend abstraction and provisioning for agent-runner.

Public API — backend layer:
    WorkspaceBackend        Protocol for workspace file + process operations.
    ExecuteResult           Return type for ``WorkspaceBackend.execute()``.
    LocalWorkspaceBackend   Adapter backed by the local filesystem.
    DaytonaWorkspaceBackend Adapter backed by a Daytona sandbox.
    initialize_workspace    Factory that creates the right backend.
    WorkspaceInitResult     Structured result from ``initialize_workspace()``.

Public API — provisioning layer (Phase 2):
    WorkspaceProvisioner    Dispatches on ``WorkspaceSource`` to populate a
                            workspace (git clone, local path, or empty).
    ProvisionResult         Immutable result of provisioning.
    GitMetadata             Metadata captured after a git clone.
    SourceType              Enum of workspace source variants.
    WorkspaceProvisionError Domain exception for provisioning failures.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from worker.workspace.backend import ExecuteResult, WorkspaceBackend
from worker.workspace.daytona import DaytonaWorkspaceBackend
from worker.workspace.local import LocalWorkspaceBackend
from worker.workspace.provisioner import (
    GitMetadata,
    ProvisionResult,
    SourceType,
    WorkspaceProvisionError,
    WorkspaceProvisioner,
)

logger = logging.getLogger(__name__)

_STIGMER_LOCAL_STATE_DIR = ".stigmer"
_SESSIONS_SUBDIR = "sessions"
_PLATFORM_SUBDIR = "platform"

__all__ = [
    "DaytonaWorkspaceBackend",
    "ExecuteResult",
    "GitMetadata",
    "LocalWorkspaceBackend",
    "ProvisionResult",
    "SourceType",
    "WorkspaceBackend",
    "WorkspaceInitResult",
    "WorkspaceProvisionError",
    "WorkspaceProvisioner",
    "initialize_workspace",
]


@dataclass(frozen=True)
class WorkspaceInitResult:
    """Structured result from :func:`initialize_workspace`.

    Replaces the previous positional tuple return to provide named,
    self-documenting fields that are safe to extend in future phases.

    Attributes:
        backend:        The constructed ``WorkspaceBackend``.
        sandbox:        Raw Daytona ``Sandbox`` object in cloud mode,
                        ``None`` in local mode.
        is_new_sandbox: Whether the sandbox was freshly created.
        platform_dir:   Absolute path to the platform directory where
                        ``.stigmer/`` files physically live, or ``None``
                        when the virtual mount is not active.
    """

    backend: WorkspaceBackend
    sandbox: Any | None
    is_new_sandbox: bool
    platform_dir: str | None = None


def _compute_local_platform_dir(session_id: str | None) -> Path | None:
    """Compute the local platform directory for a session.

    Returns ``None`` when there is no session_id (backward compat with
    ephemeral usage), otherwise ``~/.stigmer/sessions/{session_id}/platform/``.
    """
    if not session_id:
        return None
    home = Path.home()
    return home / _STIGMER_LOCAL_STATE_DIR / _SESSIONS_SUBDIR / session_id / _PLATFORM_SUBDIR


async def initialize_workspace(
    *,
    worker_config: Any,
    sandbox_config: dict[str, Any],
    sandbox_manager: Any | None,
    session_id: str | None,
    session_client: Any,
    activity_logger: logging.Logger | None = None,
) -> WorkspaceInitResult:
    """Create the appropriate ``WorkspaceBackend`` for the current mode.

    This is the **single point** where the local-vs-cloud decision is
    made.  All downstream code receives a ``WorkspaceBackend`` and never
    branches on deployment mode.

    Returns:
        A :class:`WorkspaceInitResult` with the backend, optional sandbox,
        and the platform directory path (when the virtual mount is active).
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

        platform_dir = _compute_local_platform_dir(session_id)
        if platform_dir is not None:
            log.info(
                "Local mode — workspace root: %s, platform_dir: %s",
                root_dir, platform_dir,
            )
        else:
            log.info("Local mode — workspace root: %s", root_dir)

        backend = LocalWorkspaceBackend(
            root_dir=root_dir,
            platform_dir=platform_dir,
        )
        return WorkspaceInitResult(
            backend=backend,
            sandbox=None,
            is_new_sandbox=False,
            platform_dir=str(platform_dir) if platform_dir else None,
        )

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
    # Cloud-mode platform_dir deferred to Phase B.
    return WorkspaceInitResult(
        backend=backend,
        sandbox=sandbox,
        is_new_sandbox=is_new_sandbox,
        platform_dir=None,
    )
