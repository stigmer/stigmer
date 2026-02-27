"""Local-path workspace source — uses an existing host directory as-is.

The user's project directory becomes the workspace root directly.  No
copy or clone is made; the agent operates on the original files.

Deployment constraint (AD-09 v3):
    ``LocalPathSource`` is only valid in local mode.  Cloud runners
    reject it at provisioning time with a clear error message, the
    same way ``GitRepoSource`` rejects SSH URLs at validation time.
"""

from __future__ import annotations

import os

from worker.workspace.provisioner import (
    ProvisionResult,
    SourceType,
    WorkspaceProvisionError,
)

_SOURCE = SourceType.LOCAL_PATH


def provision(
    source: object,
    *,
    is_local_mode: bool,
) -> ProvisionResult:
    """Validate *source.path* and return it as the workspace root.

    Args:
        source: ``LocalPathSource`` proto message (accessed via duck
            typing so the module has no hard proto dependency).
        is_local_mode: Whether the runner is in local mode.

    Raises:
        WorkspaceProvisionError: If the runner is not in local mode,
            the path is relative, does not exist, or is not a directory.
    """
    path: str = source.path  # type: ignore[union-attr]

    if not is_local_mode:
        raise WorkspaceProvisionError(
            _SOURCE,
            "LocalPathSource is only supported in local mode. "
            "Use git_repo for cloud deployments.",
        )

    if not os.path.isabs(path):
        raise WorkspaceProvisionError(
            _SOURCE,
            f"Path must be absolute, got relative path: '{path}'",
        )

    if not os.path.exists(path):
        raise WorkspaceProvisionError(
            _SOURCE,
            f"Path does not exist: '{path}'",
        )

    if not os.path.isdir(path):
        raise WorkspaceProvisionError(
            _SOURCE,
            f"Path is not a directory: '{path}'",
        )

    return ProvisionResult(
        root_dir=path,
        source_type=_SOURCE,
        consumed_keys=(),
        workspace_description=(
            f"Your workspace is the user's project directory: {path}\n"
            "IMPORTANT: You are operating directly on the user's files. "
            "Changes are immediate and persistent.\n"
            "Use git to track and verify your changes before finalizing."
        ),
    )
