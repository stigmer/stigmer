"""Integration tests: InlinePublisher + publish_artifact against a real Daytona sandbox.

Creates a Daytona sandbox, seeds it with a skill directory structure, and
exercises the full artifact-publishing pipeline to verify that skill
directories are correctly published as ``DIRECTORY`` artifacts (not
individual ``FILE`` artifacts).

The sandbox is created once per module and deleted in teardown.

**Skipped** when ``DAYTONA_API_KEY`` is absent from the environment.

An optional full-pipeline test using real Cloudflare R2 storage is also
included; it is skipped when R2 credentials are absent.
"""

from __future__ import annotations

import io
import logging
import os
import time
import zipfile

import pytest
from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionArtifactKind

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Gate: skip entire module if DAYTONA_API_KEY is not set
# ---------------------------------------------------------------------------

_SKIP_DAYTONA = not os.environ.get("DAYTONA_API_KEY")


def _skip_reason() -> str:
    return "Requires DAYTONA_API_KEY env var"


try:
    from daytona import Daytona, DaytonaConfig
    from daytona.common.daytona import CreateSandboxFromSnapshotParams
except ImportError:
    _SKIP_DAYTONA = True

    def _skip_reason() -> str:  # type: ignore[misc]
        return "daytona SDK not installed"


_SNAPSHOT_ID = os.environ.get("DAYTONA_DEV_TOOLS_SNAPSHOT_ID", "daytona-small")

_R2_ENDPOINT = os.environ.get("AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT")
_R2_ACCESS_KEY = os.environ.get("AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID")
_R2_SECRET_KEY = os.environ.get("AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY")
_R2_BUCKET = os.environ.get("AGENT_EXECUTION_ARTIFACT_R2_BUCKET")

_SKIP_R2 = not all([_R2_ENDPOINT, _R2_ACCESS_KEY, _R2_SECRET_KEY, _R2_BUCKET])

_EXECUTION_ID = "integration-test-inline-publisher"

# Production constants (must match worker.sandbox_manager / worker.workspace)
_WORKSPACE_ROOT = "/home/daytona/workspace"


# ===========================================================================
# Test doubles
# ===========================================================================


class _CapturingStorage:
    """In-memory ``ArtifactStorage`` that captures uploads for assertions."""

    def __init__(self) -> None:
        self.uploads: dict[str, tuple[bytes, str | None]] = {}

    def upload(self, key: str, content: bytes, content_type: str | None = None) -> str:
        self.uploads[key] = (content, content_type)
        return key

    def download(self, key: str) -> bytes:
        if key not in self.uploads:
            raise FileNotFoundError(f"Key not found: {key}")
        return self.uploads[key][0]

    def get_download_url(self, key: str, expires_in: int = 604800) -> str:
        return f"https://fake-storage.test/{key}?expires={expires_in}"

    def delete(self, key: str) -> None:
        self.uploads.pop(key, None)

    def exists(self, key: str) -> bool:
        return key in self.uploads


class _CapturingStatusBuilder:
    """Minimal stand-in for ``StatusBuilder`` that records ``add_artifact`` calls."""

    def __init__(self) -> None:
        self.artifacts: list[ExecutionArtifact] = []

    def add_artifact(self, artifact: ExecutionArtifact) -> None:
        self.artifacts.append(artifact)


# ===========================================================================
# Module-scoped fixtures
# ===========================================================================


@pytest.fixture(scope="module")
def daytona_sandbox():
    """Create a live Daytona sandbox, yield it, then delete it."""
    if _SKIP_DAYTONA:
        pytest.skip(_skip_reason())

    api_key = os.environ["DAYTONA_API_KEY"]
    daytona = Daytona(DaytonaConfig(api_key=api_key))

    logger.info("Creating Daytona sandbox from snapshot %s …", _SNAPSHOT_ID)
    params = CreateSandboxFromSnapshotParams(
        snapshot=_SNAPSHOT_ID,
        auto_delete_interval=5,
    )
    sandbox = daytona.create(params=params)

    for attempt in range(90):
        try:
            result = sandbox.process.exec("echo ready", timeout=5)
            if result.exit_code == 0:
                logger.info(
                    "Sandbox %s ready after %d poll(s)", sandbox.id, attempt + 1,
                )
                break
        except Exception:
            pass
        time.sleep(2)
    else:
        sandbox.delete()
        pytest.fail(f"Sandbox {sandbox.id} did not become ready within 180s")

    yield sandbox

    logger.info("Deleting Daytona sandbox %s …", sandbox.id)
    try:
        sandbox.delete()
    except Exception:
        logger.warning("Failed to delete sandbox %s", sandbox.id, exc_info=True)


@pytest.fixture(scope="module")
def workspace_backend(daytona_sandbox):
    """Create a real ``DaytonaWorkspaceBackend`` matching production config."""
    from worker.workspace.daytona import DaytonaWorkspaceBackend

    try:
        sandbox_root = daytona_sandbox.get_work_dir().rstrip("/")
    except Exception:
        sandbox_root = "/home/daytona"

    logger.info(
        "Creating DaytonaWorkspaceBackend: workspace_root=%s, sandbox_root=%s",
        _WORKSPACE_ROOT,
        sandbox_root,
    )
    backend = DaytonaWorkspaceBackend(
        sandbox=daytona_sandbox,
        workspace_root=_WORKSPACE_ROOT,
        sandbox_root=sandbox_root,
    )

    yield backend

    backend.close()


@pytest.fixture(scope="module")
def skill_directory(daytona_sandbox, workspace_backend):
    """Seed the sandbox with a skill package and return the workspace-relative root."""
    skill_root = "my-test-skill"
    files = [
        (f"{skill_root}/SKILL.md", b"# My Test Skill\n\nA skill for integration testing.\n"),
        (f"{skill_root}/references/guide.md", b"# Guide\n\nReference material.\n"),
        (f"{skill_root}/scripts/run.sh", b"#!/bin/bash\necho 'hello'\n"),
    ]
    workspace_backend.write_files(files)

    verify = daytona_sandbox.process.exec(
        f"ls -la {_WORKSPACE_ROOT}/{skill_root}/", timeout=5,
    )
    logger.info("Skill directory listing:\n%s", verify.result or verify.stdout)

    return skill_root


@pytest.fixture(scope="module")
def standalone_file(workspace_backend):
    """Seed a standalone file outside any skill directory."""
    workspace_backend.write_file("standalone.txt", b"Just a plain file.\n")
    return "standalone.txt"


# ===========================================================================
# TestSandboxFileInfo — prove sandbox.fs.get_file_info correctness
# ===========================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestSandboxFileInfo:
    """Verify ``sandbox.fs.get_file_info`` returns correct ``is_dir`` for
    the path coordinate system that ``publish_artifact`` uses (sandbox-relative
    paths with the ``workspace/`` rebase prefix).
    """

    def test_get_file_info_directory_is_dir(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        sandbox_path = workspace_backend._normalize(skill_directory)
        logger.info(
            "get_file_info on directory: sandbox_path=%r (from ws_path=%r)",
            sandbox_path, skill_directory,
        )
        file_info = daytona_sandbox.fs.get_file_info(sandbox_path)
        assert file_info.is_dir is True, (
            f"Expected is_dir=True for directory path {sandbox_path!r}, "
            f"got is_dir={file_info.is_dir}"
        )

    def test_get_file_info_file_not_is_dir(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        file_ws_path = f"{skill_directory}/SKILL.md"
        sandbox_path = workspace_backend._normalize(file_ws_path)
        logger.info(
            "get_file_info on file: sandbox_path=%r (from ws_path=%r)",
            sandbox_path, file_ws_path,
        )
        file_info = daytona_sandbox.fs.get_file_info(sandbox_path)
        assert file_info.is_dir is False, (
            f"Expected is_dir=False for file path {sandbox_path!r}, "
            f"got is_dir={file_info.is_dir}"
        )


# ===========================================================================
# TestPublishArtifactDirect — prove publish_artifact produces DIRECTORY
# ===========================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestPublishArtifactDirect:
    """Exercise ``publish_artifact()`` directly with a real sandbox and
    ``_CapturingStorage`` to verify DIRECTORY artifact creation.
    """

    @pytest.mark.asyncio
    async def test_directory_produces_directory_artifact(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        from worker.tools.publish_artifact import publish_artifact

        storage = _CapturingStorage()
        sandbox_path = workspace_backend._normalize(skill_directory)

        artifact = await publish_artifact(
            sandbox=daytona_sandbox,
            storage=storage,
            execution_id=_EXECUTION_ID,
            path=sandbox_path,
            name=skill_directory,
        )

        assert artifact.kind == ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY, (
            f"Expected DIRECTORY artifact, got kind={artifact.kind} "
            f"({ExecutionArtifactKind.Name(artifact.kind)})"
        )

    @pytest.mark.asyncio
    async def test_directory_entries_contain_skill_md(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        from worker.tools.publish_artifact import publish_artifact

        storage = _CapturingStorage()
        sandbox_path = workspace_backend._normalize(skill_directory)

        artifact = await publish_artifact(
            sandbox=daytona_sandbox,
            storage=storage,
            execution_id=_EXECUTION_ID,
            path=sandbox_path,
            name=skill_directory,
        )

        assert "SKILL.md" in list(artifact.entries), (
            f"Expected 'SKILL.md' in artifact entries, got: {list(artifact.entries)}"
        )

    @pytest.mark.asyncio
    async def test_directory_content_is_valid_zip(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        from worker.tools.publish_artifact import publish_artifact

        storage = _CapturingStorage()
        sandbox_path = workspace_backend._normalize(skill_directory)

        await publish_artifact(
            sandbox=daytona_sandbox,
            storage=storage,
            execution_id=_EXECUTION_ID,
            path=sandbox_path,
            name=skill_directory,
        )

        assert len(storage.uploads) == 1, (
            f"Expected exactly 1 upload, got {len(storage.uploads)}"
        )
        storage_key = next(iter(storage.uploads))
        content, content_type = storage.uploads[storage_key]

        assert content_type == "application/zip"
        assert zipfile.is_zipfile(io.BytesIO(content)), (
            "Uploaded content is not a valid ZIP archive"
        )

        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = zf.namelist()
            logger.info("ZIP contents: %s", names)
            file_names = [n for n in names if not n.endswith("/")]
            assert any("SKILL.md" in n for n in file_names), (
                f"SKILL.md not found in ZIP archive entries: {file_names}"
            )


# ===========================================================================
# TestInlinePublisherEndToEnd — prove full publish() flow
# ===========================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
class TestInlinePublisherEndToEnd:
    """Exercise the full ``InlinePublisher.publish()`` flow with a real
    sandbox and ``DaytonaWorkspaceBackend``.
    """

    def _make_publisher(self, sandbox, backend):
        from worker.activities.graphton.inline_publisher import InlinePublisher

        storage = _CapturingStorage()
        status_builder = _CapturingStatusBuilder()

        publisher = InlinePublisher(
            workspace_backend=backend,
            sandbox=sandbox,
            artifact_storage=storage,
            status_builder=status_builder,
            execution_id=_EXECUTION_ID,
            logger=logging.getLogger("test.inline_publisher"),
        )
        return publisher, storage, status_builder

    @pytest.mark.asyncio
    async def test_skill_md_write_produces_directory_artifact(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        publisher, storage, sb = self._make_publisher(
            daytona_sandbox, workspace_backend,
        )

        await publisher.publish(f"{skill_directory}/SKILL.md")

        assert len(sb.artifacts) == 1, (
            f"Expected 1 artifact, got {len(sb.artifacts)}"
        )
        artifact = sb.artifacts[0]
        assert artifact.kind == ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY, (
            f"Expected DIRECTORY, got {ExecutionArtifactKind.Name(artifact.kind)}"
        )
        assert "SKILL.md" in list(artifact.entries), (
            f"Expected 'SKILL.md' in entries, got: {list(artifact.entries)}"
        )
        logger.info(
            "Artifact: name=%s, kind=%s, entries=%s, sandbox_path=%s",
            artifact.name,
            ExecutionArtifactKind.Name(artifact.kind),
            list(artifact.entries),
            artifact.sandbox_path,
        )

    @pytest.mark.asyncio
    async def test_subsequent_file_write_publishes_directory(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        publisher, storage, sb = self._make_publisher(
            daytona_sandbox, workspace_backend,
        )

        await publisher.publish(f"{skill_directory}/SKILL.md")
        sb.artifacts.clear()

        await publisher.publish(f"{skill_directory}/references/guide.md")

        assert len(sb.artifacts) == 1, (
            f"Expected 1 artifact for subsequent file write, got {len(sb.artifacts)}"
        )
        artifact = sb.artifacts[0]
        assert artifact.kind == ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY, (
            f"Subsequent file write should still produce DIRECTORY, "
            f"got {ExecutionArtifactKind.Name(artifact.kind)}"
        )

    @pytest.mark.asyncio
    async def test_non_skill_file_publishes_as_file(
        self, daytona_sandbox, workspace_backend, standalone_file,
    ) -> None:
        publisher, storage, sb = self._make_publisher(
            daytona_sandbox, workspace_backend,
        )

        await publisher.publish(standalone_file)

        assert len(sb.artifacts) == 1, (
            f"Expected 1 artifact, got {len(sb.artifacts)}"
        )
        artifact = sb.artifacts[0]
        assert artifact.kind == ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_FILE, (
            f"Expected FILE for standalone file, "
            f"got {ExecutionArtifactKind.Name(artifact.kind)}"
        )

    @pytest.mark.asyncio
    async def test_published_skill_roots_tracked(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        publisher, _, _ = self._make_publisher(
            daytona_sandbox, workspace_backend,
        )

        assert len(publisher.published_skill_roots) == 0

        await publisher.publish(f"{skill_directory}/SKILL.md")

        assert skill_directory in publisher.published_skill_roots, (
            f"Expected {skill_directory!r} in published_skill_roots, "
            f"got: {publisher.published_skill_roots}"
        )


# ===========================================================================
# TestFullPipelineR2 — optional full pipeline with real R2
# ===========================================================================


@pytest.mark.skipif(_SKIP_DAYTONA, reason=_skip_reason())
@pytest.mark.skipif(_SKIP_R2, reason="Requires R2 credentials env vars")
class TestFullPipelineR2:
    """Full end-to-end pipeline using real Cloudflare R2 storage."""

    @pytest.mark.asyncio
    async def test_publish_and_download_via_r2(
        self, daytona_sandbox, workspace_backend, skill_directory,
    ) -> None:
        from worker.storage.r2 import R2ArtifactStorage
        from worker.tools.publish_artifact import publish_artifact

        storage = R2ArtifactStorage(
            endpoint=_R2_ENDPOINT,
            access_key=_R2_ACCESS_KEY,
            secret_key=_R2_SECRET_KEY,
            bucket=_R2_BUCKET,
        )

        sandbox_path = workspace_backend._normalize(skill_directory)
        test_execution_id = f"integration-test-{int(time.time())}"

        try:
            artifact = await publish_artifact(
                sandbox=daytona_sandbox,
                storage=storage,
                execution_id=test_execution_id,
                path=sandbox_path,
                name=skill_directory,
            )

            assert artifact.kind == ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY
            assert "SKILL.md" in list(artifact.entries)
            assert artifact.download_url.startswith("https://")
            assert artifact.size_bytes > 0

            assert storage.exists(artifact.storage_key), (
                f"Artifact storage key {artifact.storage_key!r} not found in R2"
            )

            content = storage.download(artifact.storage_key)
            assert zipfile.is_zipfile(io.BytesIO(content))

            logger.info(
                "R2 full pipeline: name=%s, kind=%s, size=%d, "
                "entries=%s, storage_key=%s",
                artifact.name,
                ExecutionArtifactKind.Name(artifact.kind),
                artifact.size_bytes,
                list(artifact.entries),
                artifact.storage_key,
            )

        finally:
            storage_key = f"artifacts/{test_execution_id}/{skill_directory}.zip"
            try:
                storage.delete(storage_key)
                logger.info("Cleaned up R2 test key: %s", storage_key)
            except Exception:
                logger.warning(
                    "Failed to clean up R2 test key: %s", storage_key, exc_info=True,
                )
