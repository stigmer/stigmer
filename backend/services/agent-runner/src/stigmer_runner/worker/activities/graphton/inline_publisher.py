"""Inline artifact publisher for streaming execution.

Publishes artifacts as they are written during the LangGraph event stream,
so the UI can display them in real time without waiting for the post-stream
safety net.

**Skill-aware directory publishing**: When a file write lands inside a
directory that contains ``SKILL.md``, the publisher packages the entire
skill root directory as a single ``DIRECTORY`` artifact (ZIP) instead of
publishing the individual file.  This enables the frontend's skill
package detection (``useDetectSkillPackage``) to fire immediately during
streaming — not only after post-stream ``auto_publish_written_files``.

Designed as a fire-and-forget callback: exceptions are logged and
swallowed so the streaming loop is never interrupted.
"""

from __future__ import annotations

import logging
import posixpath
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

from stigmer_runner.worker.tools import publish_artifact

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder
    from stigmer_runner.worker.storage.base import ArtifactStorage
    from stigmer_runner.worker.workspace import WorkspaceBackend

_SKILL_MARKER = "SKILL.md"


class InlinePublisher:
    """Publishes workspace files to artifact storage on each write/edit
    tool completion.

    For files inside a skill directory (one containing ``SKILL.md``),
    the entire directory is published as a ``DIRECTORY`` artifact so
    the frontend can detect the skill package in real time.  For all
    other files the individual file is published as a ``FILE`` artifact
    (original behaviour).

    Designed as a fire-and-forget callback: exceptions are logged and
    swallowed so the streaming loop is never interrupted.
    """

    def __init__(
        self,
        *,
        workspace_backend: WorkspaceBackend,
        sandbox: Any | None,
        artifact_storage: ArtifactStorage,
        status_builder: StatusBuilder,
        execution_id: str,
        logger: logging.Logger,
    ) -> None:
        self._workspace_backend = workspace_backend
        self._sandbox = sandbox
        self._artifact_storage = artifact_storage
        self._status_builder = status_builder
        self._execution_id = execution_id
        self._log = logger

        self._skill_roots: set[str] = set()

    @property
    def published_skill_roots(self) -> frozenset[str]:
        """Normalised paths of skill root directories published so far.

        Exposed for the post-stream safety net so it can include these
        in ``already_published_paths`` and avoid redundant re-uploads.
        """
        return frozenset(self._skill_roots)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def publish(self, path: str) -> None:
        """Upload *path* from the sandbox to artifact storage and register
        it on the status builder so the next progressive gRPC update
        carries it to the UI.

        If *path* is inside a skill directory (a directory that contains
        ``SKILL.md``), the entire skill root directory is published as a
        ``DIRECTORY`` artifact instead of the individual file.

        Internally two path coordinate systems are used:

        - **workspace-relative** (``ws_path``) — for ``file_exists``
          calls and the ``_skill_roots`` cache, since the workspace
          backend's ``file_exists`` resolves paths relative to
          ``workspace_root``.
        - **sandbox-relative** (``sandbox_path``) — for
          ``publish_artifact`` / ``sandbox.fs.get_file_info``, which
          resolve paths relative to the sandbox root and may need a
          rebase prefix (e.g. ``workspace/``).
        """
        try:
            ws_path = self._to_workspace_relative(path)
            sandbox_path = self._to_sandbox_path(path)

            self._log.info(
                "[INLINE_PUBLISH] execution=%s — path resolution: "
                "tool_path=%r -> ws_path=%r, sandbox_path=%r ("
                "sandbox=%s, has_normalizer=%s)",
                self._execution_id, path, ws_path, sandbox_path,
                "cloud" if self._sandbox is not None else "local",
                hasattr(self._workspace_backend, "_normalize"),
            )

            if PurePosixPath(ws_path).name == _SKILL_MARKER:
                parent = str(PurePosixPath(ws_path).parent)
                if parent != ".":
                    self._skill_roots.add(parent)
                    self._log.info(
                        "[INLINE_PUBLISH] execution=%s — "
                        "registered skill root: %r (via SKILL.md write)",
                        self._execution_id, parent,
                    )

            skill_root = self._find_skill_root(ws_path)

            if skill_root is not None:
                self._log.info(
                    "[INLINE_PUBLISH] execution=%s — "
                    "skill root found: %r -> publishing directory "
                    "(sandbox_path=%r)",
                    self._execution_id, skill_root,
                    self._to_sandbox_path(skill_root),
                )
                await self._publish_skill_directory(
                    self._to_sandbox_path(skill_root),
                )
            else:
                self._log.info(
                    "[INLINE_PUBLISH] execution=%s — "
                    "no skill root for %r -> publishing single file "
                    "(sandbox_path=%r)",
                    self._execution_id, ws_path, sandbox_path,
                )
                await self._publish_single_file(sandbox_path)

        except Exception:
            self._log.warning(
                "[INLINE_PUBLISH] execution=%s — "
                "failed to publish '%s' (non-fatal, post-stream "
                "safety net will attempt)",
                self._execution_id, path,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # Skill root detection
    # ------------------------------------------------------------------

    def _find_skill_root(self, rel_path: str) -> str | None:
        """Return the skill root directory for *rel_path*, or ``None``.

        A skill root is a directory that contains ``SKILL.md``.  The
        search walks from the immediate parent of *rel_path* up toward
        the workspace root, checking the in-memory cache first and
        falling back to ``workspace_backend.file_exists``.
        """
        parts = PurePosixPath(rel_path).parts
        if len(parts) < 2:
            return None

        for depth in range(len(parts) - 1, 0, -1):
            candidate = posixpath.join(*parts[:depth])
            if candidate in self._skill_roots:
                return candidate
            marker = posixpath.join(candidate, _SKILL_MARKER)
            try:
                if self._workspace_backend.file_exists(marker):
                    self._skill_roots.add(candidate)
                    self._log.info(
                        "[INLINE_PUBLISH] execution=%s — "
                        "discovered skill root: %r (via file_exists)",
                        self._execution_id, candidate,
                    )
                    return candidate
            except Exception:
                self._log.debug(
                    "[INLINE_PUBLISH] execution=%s — "
                    "file_exists(%r) failed, skipping candidate %r",
                    self._execution_id, marker, candidate,
                    exc_info=True,
                )

        return None

    # ------------------------------------------------------------------
    # Publishing strategies
    # ------------------------------------------------------------------

    async def _publish_skill_directory(self, skill_root: str) -> None:
        """Publish an entire skill directory as a ``DIRECTORY`` artifact."""
        dir_name = PurePosixPath(skill_root).name or skill_root

        artifact = await publish_artifact(
            sandbox=self._sandbox,
            storage=self._artifact_storage,
            execution_id=self._execution_id,
            path=skill_root,
            name=dir_name,
            local_root=(
                self._workspace_backend.root_dir
                if self._sandbox is None else None
            ),
        )

        self._status_builder.add_artifact(artifact)
        self._log.info(
            "[INLINE_PUBLISH] execution=%s — "
            "published skill directory '%s' as artifact '%s' "
            "(size=%d, hash=%s, entries=%d)",
            self._execution_id, skill_root, dir_name,
            artifact.size_bytes, artifact.content_hash,
            len(artifact.entries),
        )

    async def _publish_single_file(self, rel_path: str) -> None:
        """Publish a single file as a ``FILE`` artifact (original behaviour)."""
        file_name = PurePosixPath(rel_path).name

        artifact = await publish_artifact(
            sandbox=self._sandbox,
            storage=self._artifact_storage,
            execution_id=self._execution_id,
            path=rel_path,
            name=file_name,
            local_root=(
                self._workspace_backend.root_dir
                if self._sandbox is None else None
            ),
        )

        self._status_builder.add_artifact(artifact)
        self._log.info(
            "[INLINE_PUBLISH] execution=%s — "
            "published '%s' as artifact '%s' "
            "(size=%d, hash=%s)",
            self._execution_id, rel_path, file_name,
            artifact.size_bytes, artifact.content_hash,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _to_workspace_relative(path: str) -> str:
        """Convert a tool-reported path to workspace-relative form.

        ``file_exists`` and the skill-root cache operate in
        workspace-relative coordinates (the workspace backend's ``_abs``
        prepends the workspace root).  Tool paths are already
        workspace-relative — only a leading ``/`` needs stripping.
        """
        return path.lstrip("/")

    def _to_sandbox_path(self, path: str) -> str:
        """Convert a tool-reported (or workspace-relative) path to
        sandbox-relative form.

        ``publish_artifact`` and ``sandbox.fs.get_file_info`` resolve
        relative to the **sandbox root**, which may differ from the
        workspace root (e.g. volume-mount scenario).  When the workspace
        backend exposes ``_normalize`` it applies the necessary rebase
        prefix; otherwise a plain ``lstrip("/")`` is sufficient (local
        mode, or no rebase).
        """
        normalizer = (
            self._workspace_backend._normalize
            if hasattr(self._workspace_backend, "_normalize")
            else None
        )
        return normalizer(path) if normalizer else path.lstrip("/")
