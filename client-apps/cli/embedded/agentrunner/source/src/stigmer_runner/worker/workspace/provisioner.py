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

import dataclasses
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from graphton.core.backends.gitignore_filter import GitIgnoreFilter

    from stigmer_runner.worker.workspace.backend import WorkspaceBackend

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
        git_credentials_configured:
                     Whether a git credential store was configured in
                     the sandbox for push/fetch access.  Only ``True``
                     in cloud mode when a ``GITHUB_TOKEN`` was available
                     and the credential helper was successfully set up.
    """

    repo_url: str
    branch: str
    base_commit: str
    git_credentials_configured: bool = False


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
        file_tree:             Formatted ``### Project Structure`` section
                               for the system prompt, or ``None`` when tree
                               generation was skipped or the workspace is
                               empty.
        git_metadata:          Present only for ``GIT_REPO`` sources.
        entry_name:            Identity label from ``WorkspaceEntry.name``.
                               Empty string for unnamed / single-source
                               workspaces.  Stamped by ``provision_all()``.
    """

    root_dir: str
    source_type: SourceType
    consumed_keys: tuple[str, ...]
    workspace_description: str
    file_tree: str | None = None
    git_metadata: GitMetadata | None = None
    entry_name: str = ""


class WorkspaceProvisionError(Exception):
    """Raised when workspace provisioning fails.

    Carries structured context so callers can react programmatically
    (e.g. log source_type, inspect cause chain) while still providing
    a human-readable message.

    Attributes:
        source_type: The source variant that failed.
        cause:       The underlying exception, if any.
        transient:   When ``True``, the error is likely recoverable on
                     retry (e.g. a network timeout to the sandbox proxy).
                     Callers may use this flag to decide whether to retry.
    """

    def __init__(
        self,
        source_type: SourceType,
        message: str,
        *,
        cause: Exception | None = None,
        transient: bool = False,
    ) -> None:
        self.source_type = source_type
        self.cause = cause
        self.transient = transient
        super().__init__(f"[{source_type.value}] {message}")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class WorkspaceProvisioner:
    """Provisions workspace content based on ``WorkspaceSource`` protos.

    Two entry-points:

    ``provision``
        Provisions a single ``WorkspaceSource`` — the per-source method.
    ``provision_all``
        Provisions a sequence of ``WorkspaceEntry`` protos — the
        multi-entry orchestrator.  Delegates to ``provision`` per entry
        and stamps ``entry_name`` on each result.
    """

    def __init__(self, *, log: logging.Logger | None = None) -> None:
        self._log = log or logger

    def provision(
        self,
        workspace_source: object | None,
        backend: WorkspaceBackend,
        merged_env: dict[str, str],
        is_local_mode: bool,
        *,
        target_subdir: str | None = None,
        tree_heading_level: int = 3,
        configure_credentials: bool = False,
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
            target_subdir: When set, git sources clone into this
                subdirectory of ``backend.root_dir``, and local-path
                sources create a symlink with this name pointing to the
                validated path.  Ignored by empty sources.
            tree_heading_level: Markdown heading depth for the file-tree
                section (default 3 → ``###``).  Multi-entry callers
                pass 4 so the tree nests under per-entry ``###``
                headings.
            configure_credentials: When ``True``, configure a git
                credential store for push/fetch access in the sandbox.
                Decoupled from ``is_local_mode`` because sandboxes on
                local overlay filesystems use ``is_local_mode=True`` but
                still need credentials for git write-back.

        Returns:
            A ``ProvisionResult`` describing what was provisioned.

        Raises:
            WorkspaceProvisionError: If provisioning fails for any reason
                (auth, network, invalid path, deployment constraint, …).
        """
        result = self._dispatch(
            workspace_source, backend, merged_env, is_local_mode,
            target_subdir=target_subdir,
            configure_credentials=configure_credentials,
        )

        result = self._enrich_with_file_tree(
            result, backend, is_local_mode,
            heading_level=tree_heading_level,
        )

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
            result = dataclasses.replace(result, consumed_keys=all_consumed)

        self._log.info(
            "Provisioned workspace: source=%s root=%s consumed_keys=%s",
            result.source_type.value,
            result.root_dir,
            result.consumed_keys,
        )
        return result

    def provision_all(
        self,
        entries: Sequence[object],
        backend: WorkspaceBackend,
        merged_env: dict[str, str],
        is_local_mode: bool,
        configure_credentials: bool = False,
    ) -> list[ProvisionResult]:
        """Provision multiple workspace entries.

        Iterates *entries* (``WorkspaceEntry`` protos, duck-typed) and
        delegates each to :meth:`provision`.  The ``entry_name`` from
        the proto is stamped onto each result.

        When there are multiple entries, git sources receive the entry
        name as ``target_subdir`` so each repo is cloned into its own
        subdirectory of the workspace root.  Single-entry sessions
        preserve backward-compatible behavior (clone into root).

        Fail-fast: if any entry raises ``WorkspaceProvisionError`` the
        exception propagates immediately — no partial provisioning.

        Args:
            entries: Sequence of ``WorkspaceEntry`` proto messages.
                Each must expose ``.name`` (str) and ``.source``
                (``WorkspaceSource``).
            backend: The ``WorkspaceBackend`` for command execution.
            merged_env: Fully-merged environment (``dict[str, str]``).
            is_local_mode: Whether the runner is in local mode.
            configure_credentials: When ``True``, configure git
                credential stores for push/fetch access in the sandbox.

        Returns:
            One ``ProvisionResult`` per entry, in the same order.
            Empty list when *entries* is empty.

        Raises:
            WorkspaceProvisionError: If any entry fails to provision.
        """
        if not entries:
            return []

        use_subdirs = len(entries) > 1
        heading_level = 4 if use_subdirs else 3

        results: list[ProvisionResult] = []
        for entry in entries:
            name: str = entry.name  # type: ignore[attr-defined]
            source: object = entry.source  # type: ignore[attr-defined]

            self._log.info(
                "Provisioning workspace entry %d/%d: name=%r",
                len(results) + 1,
                len(entries),
                name,
            )

            target_subdir = name if use_subdirs else None
            result = self.provision(
                source, backend, merged_env, is_local_mode,
                target_subdir=target_subdir,
                tree_heading_level=heading_level,
                configure_credentials=configure_credentials,
            )
            result = dataclasses.replace(result, entry_name=name)
            results.append(result)

        self._log.info(
            "Provisioned %d workspace entr%s: %s",
            len(results),
            "y" if len(results) == 1 else "ies",
            ", ".join(r.entry_name or "(unnamed)" for r in results),
        )
        return results

    # ------------------------------------------------------------------
    # Internal dispatch
    # ------------------------------------------------------------------

    def _dispatch(
        self,
        workspace_source: object | None,
        backend: WorkspaceBackend,
        merged_env: dict[str, str],
        is_local_mode: bool,
        *,
        target_subdir: str | None = None,
        configure_credentials: bool = False,
    ) -> ProvisionResult:
        # Deferred imports to break the provisioner ↔ sources cycle.
        from stigmer_runner.worker.workspace.sources import empty as empty_source
        from stigmer_runner.worker.workspace.sources import git as git_source
        from stigmer_runner.worker.workspace.sources import local_path as local_path_source

        if workspace_source is None or not _has_source(workspace_source):
            self._log.info("No workspace source configured — using empty workspace")
            return empty_source.provision(backend)

        if workspace_source.HasField("git_repo"):  # type: ignore[attr-defined]
            self._log.info(
                "Provisioning git workspace: url=%s",
                workspace_source.git_repo.url,  # type: ignore[attr-defined]
            )
            return git_source.provision(
                workspace_source.git_repo,  # type: ignore[attr-defined]
                backend,
                merged_env,
                target_subdir=target_subdir,
                is_local_mode=is_local_mode,
                configure_credentials=configure_credentials,
            )

        if workspace_source.HasField("local_path"):  # type: ignore[attr-defined]
            self._log.info(
                "Provisioning local-path workspace: path=%s",
                workspace_source.local_path.path,  # type: ignore[attr-defined]
            )
            return local_path_source.provision(
                workspace_source.local_path,  # type: ignore[attr-defined]
                is_local_mode=is_local_mode,
                target_subdir=target_subdir,
                backend_root_dir=backend.root_dir if target_subdir else None,
            )

        raise WorkspaceProvisionError(
            SourceType.EMPTY,
            "WorkspaceSource has no recognised source variant set",
        )

    # ------------------------------------------------------------------
    # Tree enrichment
    # ------------------------------------------------------------------

    def _enrich_with_file_tree(
        self,
        result: ProvisionResult,
        backend: WorkspaceBackend,
        is_local_mode: bool,
        *,
        heading_level: int = 3,
    ) -> ProvisionResult:
        """Append a file-tree manifest to the provisioning result.

        Empty workspaces are skipped (no useful tree to show).  Failures
        are logged but never block provisioning — the tree is best-effort.

        A ``.gitignore`` filter is created when the workspace has a
        root-level ``.gitignore`` file, keeping the system-prompt tree
        consistent with what the agent tools can see at runtime.

        When ``result.root_dir`` is a subdirectory of
        ``backend.root_dir`` (multi-entry cloud mode), the remote tree
        builder and gitignore loader are scoped to that subdirectory
        via the ``cwd`` parameter so they only see the entry's files.

        Args:
            heading_level: Markdown heading depth for the tree heading.
        """
        if result.source_type == SourceType.EMPTY:
            return result

        from stigmer_runner.worker.workspace.tree import build_workspace_file_tree

        rel_subdir = _relative_subdir(result.root_dir, backend.root_dir)

        gitignore = self._load_gitignore_filter(
            result, backend, is_local_mode, rel_subdir=rel_subdir,
        )

        try:
            file_tree = build_workspace_file_tree(
                result.root_dir,
                backend,
                is_local_mode=is_local_mode,
                gitignore_filter=gitignore,
                cwd=rel_subdir,
                heading_level=heading_level,
            )
        except Exception:
            self._log.warning(
                "File-tree generation failed; continuing without tree",
                exc_info=True,
            )
            return result

        if file_tree is None:
            return result

        self._log.info(
            "Generated workspace file tree for %s (%s)",
            result.root_dir,
            result.source_type.value,
        )
        return dataclasses.replace(result, file_tree=file_tree)

    @staticmethod
    def _load_gitignore_filter(
        result: ProvisionResult,
        backend: WorkspaceBackend,
        is_local_mode: bool,
        *,
        rel_subdir: str | None = None,
    ) -> GitIgnoreFilter | None:
        """Best-effort loading of the workspace's root ``.gitignore``.

        When *rel_subdir* is set (multi-entry cloud mode), the
        ``.gitignore`` is read from inside the subdirectory instead of
        the backend root.
        """
        from pathlib import Path

        from graphton.core.backends.gitignore_filter import (
            GitIgnoreFilter as _GitIgnoreFilter,
        )

        if is_local_mode:
            return _GitIgnoreFilter.from_file(Path(result.root_dir) / ".gitignore")

        gitignore_path = (
            os.path.join(rel_subdir, ".gitignore") if rel_subdir else ".gitignore"
        )
        try:
            raw = backend.read_file(gitignore_path)
            content = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            return _GitIgnoreFilter.from_content(content)
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _relative_subdir(root_dir: str, backend_root: str) -> str | None:
    """Compute the relative subdirectory of *root_dir* within *backend_root*.

    Returns ``None`` when they refer to the same directory (the common
    single-entry case).  Used to scope remote file operations and tree
    generation to an entry's subdirectory in multi-entry cloud mode.
    """
    rel = os.path.relpath(root_dir, backend_root)
    if rel == ".":
        return None
    return rel


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
