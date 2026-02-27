"""Workspace provisioner — dispatches on ``WorkspaceSource`` to populate a workspace.

This module contains:

    Domain types
        SourceType              Enum of workspace source variants.
        GitMetadata             Immutable metadata from a git clone.
        ProvisionResult         Immutable result of provisioning.
        WorkspaceProvisionError Domain exception for provisioning failures.

    Orchestrator
        WorkspaceProvisioner    Reads ``WorkspaceSource`` from the session
                                proto and delegates to the appropriate source
                                handler (git, local_path, or empty).

The provisioner sits *on top of* ``WorkspaceBackend``.  It uses the backend
to execute commands (e.g. ``git clone``) inside the workspace, but it does
not own the backend lifecycle.  The caller creates the backend via
``initialize_workspace`` and passes it in.

Credential scoping (AD-05):
    Source handlers return the environment keys they consumed (e.g.
    ``GITHUB_TOKEN`` for git clone).  The provisioner adds any keys
    with the ``WORKSPACE_PROVISION_`` reserved prefix.  The caller is
    responsible for stripping consumed keys from the agent's runtime
    environment.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from worker.workspace.backend import WorkspaceBackend

logger = logging.getLogger(__name__)

_PROVISION_KEY_PREFIX = "WORKSPACE_PROVISION_"


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


class SourceType(Enum):
    """Discriminator for the workspace source that was provisioned."""

    GIT_REPO = "git_repo"
    LOCAL_PATH = "local_path"
    EMPTY = "empty"


@dataclass(frozen=True)
class GitMetadata:
    """Read-only metadata captured after a successful git clone.

    Deliberately excludes the authentication token.  Only carries
    information needed for system prompts (Phase 4) and output delivery
    (AD-10 patch artifact).

    Attributes:
        repo_url:    HTTPS clone URL **without** the token.
        branch:      Branch that was checked out (resolved from the
                     remote default when not explicitly requested).
        base_commit: Full SHA of HEAD at clone time.
    """

    repo_url: str
    branch: str
    base_commit: str


@dataclass(frozen=True)
class ProvisionResult:
    """Immutable outcome of workspace provisioning.

    ``root_dir`` is the **authoritative** workspace root for all
    subsequent operations.  For ``local_path`` sources this may differ
    from ``backend.root_dir``; the caller must respect the value
    returned here (Phase 3 re-creates the backend when they diverge).

    Attributes:
        root_dir:              Absolute path to the workspace root.
        source_type:           Which source variant was provisioned.
        consumed_keys:         Environment keys consumed by provisioning
                               (must be stripped before forwarding to the
                               agent).  Includes source-specific keys
                               *and* any ``WORKSPACE_PROVISION_``-prefixed
                               keys.
        workspace_description: Human-readable summary for the system
                               prompt ``## Workspace`` section.
        git_metadata:          Present only for ``GIT_REPO`` sources.
    """

    root_dir: str
    source_type: SourceType
    consumed_keys: tuple[str, ...]
    workspace_description: str
    git_metadata: GitMetadata | None = None


class WorkspaceProvisionError(Exception):
    """Raised when workspace provisioning fails.

    Carries structured context so callers can react programmatically
    (e.g. log source_type, inspect cause chain) while still providing
    a human-readable message.

    Attributes:
        source_type: The source variant that failed.
        cause:       The underlying exception, if any.
    """

    def __init__(
        self,
        source_type: SourceType,
        message: str,
        *,
        cause: Exception | None = None,
    ) -> None:
        self.source_type = source_type
        self.cause = cause
        super().__init__(f"[{source_type.value}] {message}")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class WorkspaceProvisioner:
    """Provisions workspace content based on a ``WorkspaceSource`` proto.

    This is the single entry-point for workspace provisioning.  It
    inspects the ``oneof source`` field and delegates to the matching
    handler in ``worker.workspace.sources``.
    """

    def __init__(self, *, log: logging.Logger | None = None) -> None:
        self._log = log or logger

    def provision(
        self,
        workspace_source: object | None,
        backend: WorkspaceBackend,
        merged_env: dict[str, str],
        is_local_mode: bool,
    ) -> ProvisionResult:
        """Provision workspace content.

        All underlying operations (``backend.execute()``, path checks)
        are synchronous, so this method is deliberately **not** async.

        Args:
            workspace_source: ``WorkspaceSource`` proto message from the
                session spec, or ``None`` for an empty workspace.
            backend: The ``WorkspaceBackend`` to execute commands against.
            merged_env: Fully-merged environment (``dict[str, str]``).
            is_local_mode: Whether the runner is in local mode.

        Returns:
            A ``ProvisionResult`` describing what was provisioned.

        Raises:
            WorkspaceProvisionError: If provisioning fails for any reason
                (auth, network, invalid path, deployment constraint, …).
        """
        result = self._dispatch(workspace_source, backend, merged_env, is_local_mode)

        # AD-05: strip WORKSPACE_PROVISION_-prefixed keys unconditionally.
        prefix_keys = tuple(
            k for k in merged_env if k.startswith(_PROVISION_KEY_PREFIX)
        )
        if prefix_keys:
            self._log.info(
                "Stripping reserved provisioning keys: %s",
                ", ".join(sorted(prefix_keys)),
            )

        all_consumed = _merge_consumed_keys(result.consumed_keys, prefix_keys)

        if all_consumed != result.consumed_keys:
            # Rebuild with the expanded consumed_keys.
            result = ProvisionResult(
                root_dir=result.root_dir,
                source_type=result.source_type,
                consumed_keys=all_consumed,
                workspace_description=result.workspace_description,
                git_metadata=result.git_metadata,
            )

        self._log.info(
            "Provisioned workspace: source=%s root=%s consumed_keys=%s",
            result.source_type.value,
            result.root_dir,
            result.consumed_keys,
        )
        return result

    # ------------------------------------------------------------------
    # Internal dispatch
    # ------------------------------------------------------------------

    def _dispatch(
        self,
        workspace_source: object | None,
        backend: WorkspaceBackend,
        merged_env: dict[str, str],
        is_local_mode: bool,
    ) -> ProvisionResult:
        # Deferred imports to break the provisioner ↔ sources cycle.
        from worker.workspace.sources import empty as empty_source
        from worker.workspace.sources import git as git_source
        from worker.workspace.sources import local_path as local_path_source

        if workspace_source is None or not _has_source(workspace_source):
            self._log.info("No workspace source configured — using empty workspace")
            return empty_source.provision(backend)

        if workspace_source.HasField("git_repo"):  # type: ignore[union-attr]
            self._log.info(
                "Provisioning git workspace: url=%s",
                workspace_source.git_repo.url,  # type: ignore[union-attr]
            )
            return git_source.provision(
                workspace_source.git_repo,  # type: ignore[union-attr]
                backend,
                merged_env,
            )

        if workspace_source.HasField("local_path"):  # type: ignore[union-attr]
            self._log.info(
                "Provisioning local-path workspace: path=%s",
                workspace_source.local_path.path,  # type: ignore[union-attr]
            )
            return local_path_source.provision(
                workspace_source.local_path,  # type: ignore[union-attr]
                is_local_mode=is_local_mode,
            )

        raise WorkspaceProvisionError(
            SourceType.EMPTY,
            "WorkspaceSource has no recognised source variant set",
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _has_source(workspace_source: object) -> bool:
    """Return ``True`` if at least one ``oneof`` variant is set."""
    has = getattr(workspace_source, "HasField", None)
    if has is None:
        return False
    return has("git_repo") or has("local_path")


def _merge_consumed_keys(
    source_keys: tuple[str, ...],
    prefix_keys: tuple[str, ...],
) -> tuple[str, ...]:
    """Combine source-reported keys with reserved-prefix keys, deduplicated."""
    if not prefix_keys:
        return source_keys
    merged = dict.fromkeys(source_keys)
    merged.update(dict.fromkeys(prefix_keys))
    return tuple(merged)
