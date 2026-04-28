"""Workspace backend abstraction and provisioning for agent-runner.

Public API — backend layer:
    WorkspaceBackend        Protocol for workspace file + process operations.
    ExecuteResult           Return type for ``WorkspaceBackend.execute()``.
    LocalWorkspaceBackend   Adapter backed by the local filesystem.
    initialize_workspace    Factory that creates the backend.
    WorkspaceInitResult     Structured result from ``initialize_workspace()``.

Public API — provisioning layer:
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

from stigmer_runner.worker.workspace.backend import ExecuteResult, WorkspaceBackend
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend
from stigmer_runner.worker.workspace.provisioner import (
    GitMetadata,
    ProvisionResult,
    SourceType,
    WorkspaceProvisioner,
    WorkspaceProvisionError,
)

logger = logging.getLogger(__name__)

_STIGMER_LOCAL_STATE_DIR = ".stigmer"
_SESSIONS_SUBDIR = "sessions"
_PLATFORM_SUBDIR = "platform"

__all__ = [
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

    Attributes:
        backend:        The constructed ``WorkspaceBackend``.
        platform_dir:   Absolute path to the platform directory where
                        ``.stigmer/`` files physically live, or ``None``
                        when the virtual mount is not active.
    """

    backend: WorkspaceBackend
    platform_dir: str | None = None


def _compute_platform_dir(session_id: str | None) -> Path | None:
    """Compute the platform directory for a session.

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
    workspace_config: dict[str, Any],
    session_id: str | None,
    activity_logger: logging.Logger | None = None,
) -> WorkspaceInitResult:
    """Create a ``LocalWorkspaceBackend`` for the current workspace config.

    The runner always uses a local filesystem backend — whether it is
    running on a developer laptop or inside a Daytona sandbox provisioned
    by stigmer-service, the workspace is a local directory.

    Returns:
        A :class:`WorkspaceInitResult` with the backend and optional
        platform directory path.
    """
    log = activity_logger or logger

    root_dir = workspace_config.get("root_dir")
    if not root_dir:
        raise ValueError("workspace_config['root_dir'] is required")

    platform_dir = _compute_platform_dir(session_id)
    if platform_dir is not None:
        log.info(
            "Workspace root: %s, platform_dir: %s",
            root_dir, platform_dir,
        )
    else:
        log.info("Workspace root: %s", root_dir)

    backend: WorkspaceBackend = LocalWorkspaceBackend(
        root_dir=root_dir,
        platform_dir=platform_dir,
    )
    return WorkspaceInitResult(
        backend=backend,
        platform_dir=str(platform_dir) if platform_dir else None,
    )
