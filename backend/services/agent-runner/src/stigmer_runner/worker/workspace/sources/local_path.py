"""Local-path workspace source — uses an existing host directory as-is.

The user's project directory becomes the workspace root directly.  No
copy or clone is made; the agent operates on the original files.

Multi-entry mode:
    When ``target_subdir`` and ``backend_root_dir`` are provided (i.e.
    the session has multiple workspace entries), a symlink is created
    at ``{backend_root_dir}/{target_subdir} -> path`` so that the
    ``FilesystemBackend`` can reach the directory via entry-relative
    paths.  This mirrors how git sources clone into subdirectories of
    the session root.

Deployment constraint (AD-09 v3):
    ``LocalPathSource`` is only valid in local mode.  Cloud runners
    reject it at provisioning time with a clear error message, the
    same way ``GitRepoSource`` rejects SSH URLs at validation time.
"""

from __future__ import annotations

import logging
import os

from stigmer_runner.worker.workspace.provisioner import (
    ProvisionResult,
    SourceType,
    WorkspaceProvisionError,
)

logger = logging.getLogger(__name__)

_SOURCE = SourceType.LOCAL_PATH


def provision(
    source: object,
    *,
    is_local_mode: bool,
    target_subdir: str | None = None,
    backend_root_dir: str | None = None,
) -> ProvisionResult:
    """Validate *source.path* and return it as the workspace root.

    Args:
        source: ``LocalPathSource`` proto message (accessed via duck
            typing so the module has no hard proto dependency).
        is_local_mode: Whether the runner is in local mode.
        target_subdir: When set (multi-entry mode), a symlink named
            *target_subdir* is created inside *backend_root_dir*
            pointing to the validated path.
        backend_root_dir: The session directory where symlinks are
            created.  Required when *target_subdir* is set.

    Raises:
        WorkspaceProvisionError: If the runner is not in local mode,
            the path is relative, does not exist, or is not a directory.
    """
    path: str = source.path  # type: ignore[attr-defined]

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

    if target_subdir and backend_root_dir:
        _create_entry_symlink(backend_root_dir, target_subdir, path)

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


def _create_entry_symlink(
    backend_root_dir: str,
    target_subdir: str,
    path: str,
) -> None:
    """Create a symlink ``{backend_root_dir}/{target_subdir} -> path``.

    Idempotent: if a symlink already exists pointing to the same target
    it is left untouched.  If it points elsewhere it is replaced.
    """
    link_path = os.path.join(backend_root_dir, target_subdir)

    if os.path.islink(link_path):
        existing_target = os.readlink(link_path)
        if os.path.realpath(existing_target) == os.path.realpath(path):
            logger.debug(
                "Symlink already exists: %s -> %s", link_path, path,
            )
            return
        os.unlink(link_path)
        logger.info(
            "Replaced stale symlink: %s (was %s, now %s)",
            link_path, existing_target, path,
        )

    os.makedirs(backend_root_dir, exist_ok=True)
    os.symlink(path, link_path)
    logger.info("Created workspace symlink: %s -> %s", link_path, path)
