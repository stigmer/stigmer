"""Attachment handling and artifact auto-publish for Graphton execution.

Covers:
  - Zip validation (safety checks before extraction)
  - Attachment injection into the workspace
  - Post-stream auto-publish safety net (catches files not published
    inline during streaming)

All functions have explicit dependencies (no globals). I/O is performed
through the injected ``WorkspaceBackend`` / ``ArtifactStorage`` / sandbox
interfaces.

Extracted from ``execute_graphton.py``.
"""

from __future__ import annotations

import io
import logging
import os
import posixpath
import zipfile
from collections import defaultdict
from collections.abc import Callable
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus

from stigmer_runner.worker.storage import ArtifactStorage
from stigmer_runner.worker.tools import publish_artifact
from stigmer_runner.worker.workspace import WorkspaceBackend

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder


_MAX_ZIP_FILES = 1000
_MAX_ZIP_EXTRACTED_SIZE = 100 * 1024 * 1024  # 100 MB


def _is_already_published(path: str, published: set[str]) -> bool:
    """Check if *path* (or any ancestor directory) is in *published*.

    Handles both exact matches (individual file published inline) and
    ancestor matches (file belongs to a directory artifact published
    inline, e.g. a skill package).
    """
    if path in published:
        return True
    for pub in published:
        if path.startswith(pub + "/"):
            return True
    return False


def _validate_zip_for_extraction(
    zip_data: bytes,
    attachment_filename: str,
    logger: logging.Logger,
) -> list[tuple[str, int]]:
    """Validate a zip archive before extraction and return its file manifest.

    Enforces strict safety checks on user-supplied attachments:
      1. Valid zip format
      2. Path traversal rejection (absolute or ``..`` components)
      3. Zip bomb limits (file count / total uncompressed size)

    Returns:
        Sorted list of ``(relative_path, uncompressed_size)`` tuples
        (directory entries excluded).

    Raises:
        ValueError: If the archive is invalid or fails safety checks.
    """
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

        if name.startswith("/") or name.startswith("\\"):
            zf.close()
            raise ValueError(
                f"Attachment '{attachment_filename}' contains an absolute "
                f"path entry and cannot be safely extracted: {name}",
            )

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
    attachments: list[Any],
    storage: ArtifactStorage,
    logger: logging.Logger,
    allow_local_path: bool = False,
) -> list[dict[str, Any]]:
    """Inject attachments into the workspace via ``WorkspaceBackend``.

    All file operations go through the backend -- no branching on
    deployment mode.

    Returns:
        List of dicts: ``[{"filename": str, "path": str, "size": int}]``.
    """
    from pathlib import Path

    if not attachments:
        return []

    logger.info("Injecting %d attachments into workspace", len(attachments))

    all_files: list[tuple[str, bytes]] = []
    injected_files: list[dict[str, Any]] = []

    for attachment in attachments:
        content: bytes | None = None

        if allow_local_path and getattr(attachment, "local_path", None):
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


async def auto_publish_written_files(
    tool_calls: Any,
    sandbox: Any,
    storage: ArtifactStorage,
    execution_id: str,
    status_builder: StatusBuilder,
    local_root: str | None,
    logger: logging.Logger,
    path_normalizer: Callable[[str], str] | None = None,
    already_published_paths: set[str] | None = None,
) -> int:
    """Publish workspace files as artifacts based on completed file-modifying tool calls.

    Post-stream safety net: publishes any file-modifying tool-call outputs
    that were not already published inline during streaming.

    Args:
        already_published_paths: Normalised ``sandbox_path`` values that
            were already published by inline streaming publish.  These
            paths are skipped to avoid redundant uploads.
    """
    file_modifying_tool_names = {"write", "write_file", "edit", "edit_file"}
    _already_published = already_published_paths or set()

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

    written_paths: list[str] = []
    for tc in tool_calls:
        if tc.name not in file_modifying_tool_names:
            continue
        if tc.status != ToolCallStatus.TOOL_CALL_COMPLETED:
            continue
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

    if path_normalizer is not None:
        normalised = [path_normalizer(p) for p in written_paths]
        logger.info(
            f"[AUTO_PUBLISH] execution={execution_id} — "
            f"normalized {len(written_paths)} path(s) via workspace backend: "
            f"{list(zip(written_paths, normalised))}"
        )
    else:
        normalised = [p.lstrip("/") for p in written_paths]

    if _already_published:
        before = len(normalised)
        normalised = [
            p for p in normalised
            if not _is_already_published(p, _already_published)
        ]
        skipped = before - len(normalised)
        if skipped:
            logger.info(
                f"[AUTO_PUBLISH] execution={execution_id} — "
                f"skipped {skipped} path(s) already published inline"
            )
        if not normalised:
            logger.info(
                f"[AUTO_PUBLISH] execution={execution_id} — "
                f"all {before} path(s) already published inline, nothing to do"
            )
            return 0

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
                f"failed to publish file: sandbox_path='{rel_path}' "
                f"agent_path='{written_paths[0]}' "
                f"normalizer={'yes' if path_normalizer else 'no'}: {e}"
            )
            return 0

    try:
        common = posixpath.commonpath(normalised)
    except ValueError:
        common = ""
    common_dir = common if common and common != "." else None

    artifacts_published = 0

    if common_dir:
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
                f"failed to publish directory: sandbox_path='{common_dir}' "
                f"normalizer={'yes' if path_normalizer else 'no'}: {e}"
            )
    else:
        groups: dict[str, list[str]] = defaultdict(list)
        root_files: list[str] = []

        for p in normalised:
            parts = PurePosixPath(p).parts
            if len(parts) > 1:
                groups[parts[0]].append(p)
            else:
                root_files.append(p)

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
                    f"failed to publish directory: sandbox_path='{group_common}' "
                    f"normalizer={'yes' if path_normalizer else 'no'}: {e}"
                )

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
                    f"failed to publish root file: sandbox_path='{rel_path}' "
                    f"normalizer={'yes' if path_normalizer else 'no'}: {e}"
                )

    logger.info(
        f"[AUTO_PUBLISH] execution={execution_id} — "
        f"auto-published {artifacts_published} artifact(s) from "
        f"{len(written_paths)} modified file(s)"
    )
    return artifacts_published
