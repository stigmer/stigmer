"""Inline artifact publisher for streaming execution.

Extracts the fire-and-forget publish callback from execute_graphton so
that captured variables become explicit constructor parameters and the
logic is independently testable.
"""

from __future__ import annotations

import logging
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

from worker.tools import publish_artifact

if TYPE_CHECKING:
    from worker.activities.graphton.status_builder import StatusBuilder
    from worker.storage.base import ArtifactStorage
    from worker.workspace import WorkspaceBackend


class InlinePublisher:
    """Publishes a single sandbox file to artifact storage on each
    write/edit tool completion.

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

    async def publish(self, path: str) -> None:
        """Upload *path* from the sandbox to artifact storage and register
        it on the status builder so the next progressive gRPC update
        carries it to the UI.
        """
        try:
            normalizer = (
                self._workspace_backend._normalize
                if hasattr(self._workspace_backend, "_normalize")
                else None
            )
            rel_path = normalizer(path) if normalizer else path.lstrip("/")
            file_name = PurePosixPath(rel_path).name

            self._log.info(
                "[INLINE_PUBLISH] execution=%s — path resolution: "
                "tool_path=%r -> normalized=%r (file_name=%r, "
                "sandbox=%s, has_normalizer=%s)",
                self._execution_id, path, rel_path, file_name,
                "cloud" if self._sandbox is not None else "local",
                normalizer is not None,
            )

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

            self._log.info(
                "[INLINE_PUBLISH] execution=%s — content read from "
                "sandbox: path=%r, size=%d bytes, hash=%s, "
                "first_200=%r",
                self._execution_id, rel_path,
                artifact.size_bytes, artifact.content_hash,
                artifact.name,
            )

            self._status_builder.add_artifact(artifact)
            self._log.info(
                "[INLINE_PUBLISH] execution=%s — "
                "published '%s' as artifact '%s' "
                "(size=%d, hash=%s)",
                self._execution_id, rel_path, file_name,
                artifact.size_bytes, artifact.content_hash,
            )
        except Exception as exc:
            self._log.warning(
                "[INLINE_PUBLISH] execution=%s — "
                "failed to publish '%s' (non-fatal, post-stream "
                "safety net will attempt): %s",
                self._execution_id, path, exc,
            )
