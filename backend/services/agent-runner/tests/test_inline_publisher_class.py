"""Unit tests for InlinePublisher class.

Tests cover:
- Path normalization with workspace backend _normalize method
- Path normalization fallback (lstrip) when _normalize is absent
- Artifact registration on status_builder.add_artifact
- Exception swallowing (publish errors are logged, never raised)
- Skill directory detection and directory publishing
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact

from stigmer_runner.worker.activities.graphton.inline_publisher import InlinePublisher


def _make_publisher(
    *,
    has_normalizer: bool = True,
    sandbox: MagicMock | None = MagicMock(),
) -> tuple[InlinePublisher, MagicMock, MagicMock]:
    """Create an InlinePublisher with mock collaborators.

    Returns (publisher, workspace_backend_mock, status_builder_mock).

    ``file_exists`` defaults to ``False`` so skill directory detection
    does not trigger unless the test explicitly configures it.
    """
    workspace_backend = MagicMock()
    if has_normalizer:
        workspace_backend._normalize = MagicMock(
            side_effect=lambda p: p.lstrip("/"),
        )
    else:
        del workspace_backend._normalize

    workspace_backend.root_dir = "/workspace"
    workspace_backend.file_exists = MagicMock(return_value=False)

    status_builder = MagicMock()

    publisher = InlinePublisher(
        workspace_backend=workspace_backend,
        sandbox=sandbox,
        artifact_storage=MagicMock(),
        status_builder=status_builder,
        execution_id="exec-123",
        logger=logging.getLogger("test"),
    )
    return publisher, workspace_backend, status_builder


def _fake_artifact(name: str = "result.txt") -> ExecutionArtifact:
    return ExecutionArtifact(
        name=name,
        sandbox_path=f"project/{name}",
        size_bytes=42,
        content_hash="abc123",
        storage_key=f"artifacts/exec-123/{name}",
        download_url=f"https://example.com/{name}",
    )


class TestInlinePublisherPathNormalization:
    """Path normalization via workspace backend."""

    @pytest.mark.asyncio
    async def test_uses_normalize_when_available(self):
        publisher, backend, _ = _make_publisher(has_normalizer=True)
        artifact = _fake_artifact()

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ):
            await publisher.publish("/some/absolute/path.txt")

        backend._normalize.assert_called_once_with("/some/absolute/path.txt")

    @pytest.mark.asyncio
    async def test_lstrip_fallback_when_no_normalizer(self):
        publisher, _, _ = _make_publisher(has_normalizer=False)
        artifact = _fake_artifact()

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ) as mock_publish:
            await publisher.publish("/leading/slash/file.py")

        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "leading/slash/file.py"

    @pytest.mark.asyncio
    async def test_file_name_extracted_from_path(self):
        publisher, _, _ = _make_publisher()
        artifact = _fake_artifact("deep.json")

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ) as mock_publish:
            await publisher.publish("/a/b/c/deep.json")

        assert mock_publish.call_args.kwargs["name"] == "deep.json"


class TestInlinePublisherArtifactRegistration:
    """Artifact registration on status_builder."""

    @pytest.mark.asyncio
    async def test_add_artifact_called_on_success(self):
        publisher, _, status_builder = _make_publisher()
        artifact = _fake_artifact()

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ):
            await publisher.publish("/file.txt")

        status_builder.add_artifact.assert_called_once()
        registered = status_builder.add_artifact.call_args[0][0]
        assert registered.name == "result.txt"

    @pytest.mark.asyncio
    async def test_local_root_passed_when_no_sandbox(self):
        publisher, _, _ = _make_publisher(sandbox=None)
        artifact = _fake_artifact()

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ) as mock_publish:
            await publisher.publish("/file.txt")

        assert mock_publish.call_args.kwargs["local_root"] == "/workspace"

    @pytest.mark.asyncio
    async def test_local_root_none_when_sandbox_present(self):
        publisher, _, _ = _make_publisher(sandbox=MagicMock())
        artifact = _fake_artifact()

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ) as mock_publish:
            await publisher.publish("/file.txt")

        assert mock_publish.call_args.kwargs["local_root"] is None


class TestInlinePublisherErrorSwallowing:
    """Errors must be logged and swallowed, never raised."""

    @pytest.mark.asyncio
    async def test_publish_artifact_error_is_swallowed(self):
        publisher, _, status_builder = _make_publisher()

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            side_effect=OSError("upload failed"),
        ):
            await publisher.publish("/bad-file.txt")

        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_normalizer_error_is_swallowed(self):
        publisher, backend, status_builder = _make_publisher(has_normalizer=True)
        backend._normalize.side_effect = ValueError("bad path")

        await publisher.publish("/bad/path")

        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_artifact_error_is_swallowed(self):
        publisher, _, status_builder = _make_publisher()
        artifact = _fake_artifact()
        status_builder.add_artifact.side_effect = RuntimeError("proto error")

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ):
            await publisher.publish("/file.txt")


# ---------------------------------------------------------------------------
# Skill directory detection and publishing
# ---------------------------------------------------------------------------


def _fake_dir_artifact(
    name: str = "my-skill",
    sandbox_path: str = "my-skill",
    entries: list[str] | None = None,
) -> ExecutionArtifact:
    """Create a DIRECTORY-type artifact for skill directory tests."""
    from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionArtifactKind

    artifact = ExecutionArtifact(
        name=name,
        sandbox_path=sandbox_path,
        kind=ExecutionArtifactKind.EXECUTION_ARTIFACT_KIND_DIRECTORY,
        size_bytes=1024,
        content_hash="dir-hash-123",
        storage_key=f"artifacts/exec-123/{name}.zip",
        download_url=f"https://example.com/{name}.zip",
    )
    if entries:
        artifact.entries.extend(entries)
    return artifact


class TestSkillDirectoryDetection:
    """Publishing SKILL.md triggers directory-level artifact publish."""

    @pytest.mark.asyncio
    async def test_skill_md_write_publishes_directory(self):
        """Writing SKILL.md should publish the parent directory, not
        the individual file."""
        publisher, _backend, status_builder = _make_publisher()

        dir_artifact = _fake_dir_artifact(entries=["SKILL.md"])

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ) as mock_publish:
            await publisher.publish("/my-skill/SKILL.md")

        assert mock_publish.call_args.kwargs["path"] == "my-skill"
        assert mock_publish.call_args.kwargs["name"] == "my-skill"
        status_builder.add_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_file_in_skill_dir_publishes_directory(self):
        """A file write inside a known skill root should publish the
        entire directory, not the individual file."""
        publisher, _backend, status_builder = _make_publisher()

        dir_artifact = _fake_dir_artifact(
            entries=["SKILL.md", "references/guide.md"],
        )

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ) as mock_publish:
            # First write SKILL.md to register the skill root
            await publisher.publish("/my-skill/SKILL.md")
            mock_publish.reset_mock()
            status_builder.reset_mock()

            # Now write a file inside the skill directory
            await publisher.publish("/my-skill/references/guide.md")

        assert mock_publish.call_args.kwargs["path"] == "my-skill"
        status_builder.add_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_non_skill_file_publishes_individually(self):
        """Files outside skill directories should publish as individual
        FILE artifacts (original behaviour)."""
        publisher, backend, _ = _make_publisher()
        backend.file_exists = MagicMock(return_value=False)

        artifact = _fake_artifact("output.yaml")

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ) as mock_publish:
            await publisher.publish("/output.yaml")

        assert mock_publish.call_args.kwargs["path"] == "output.yaml"
        assert mock_publish.call_args.kwargs["name"] == "output.yaml"

    @pytest.mark.asyncio
    async def test_skill_root_discovered_via_file_exists(self):
        """When SKILL.md has not been written yet but exists on disk,
        the publisher should discover the skill root via file_exists."""
        publisher, backend, status_builder = _make_publisher()

        def _file_exists(path: str) -> bool:
            return path == "existing-skill/SKILL.md"

        backend.file_exists = MagicMock(side_effect=_file_exists)

        dir_artifact = _fake_dir_artifact(
            name="existing-skill",
            sandbox_path="existing-skill",
            entries=["SKILL.md", "scripts/run.sh"],
        )

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ) as mock_publish:
            await publisher.publish("/existing-skill/scripts/run.sh")

        assert mock_publish.call_args.kwargs["path"] == "existing-skill"
        status_builder.add_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_multiple_skill_directories(self):
        """Files in different skill directories should each publish
        their own directory artifact."""
        publisher, backend, status_builder = _make_publisher()

        def _file_exists(path: str) -> bool:
            return path in {"skill-a/SKILL.md", "skill-b/SKILL.md"}

        backend.file_exists = MagicMock(side_effect=_file_exists)

        dir_a = _fake_dir_artifact(name="skill-a", sandbox_path="skill-a")
        dir_b = _fake_dir_artifact(name="skill-b", sandbox_path="skill-b")

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
        ) as mock_publish:
            mock_publish.return_value = dir_a
            await publisher.publish("/skill-a/SKILL.md")

            mock_publish.return_value = dir_b
            await publisher.publish("/skill-b/SKILL.md")

        paths_published = [
            call.kwargs["path"] for call in mock_publish.call_args_list
        ]
        assert "skill-a" in paths_published
        assert "skill-b" in paths_published
        assert status_builder.add_artifact.call_count == 2

    @pytest.mark.asyncio
    async def test_published_skill_roots_property(self):
        """The published_skill_roots property should expose tracked roots."""
        publisher, backend, _ = _make_publisher()
        backend.file_exists = MagicMock(return_value=True)

        dir_artifact = _fake_dir_artifact()

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ):
            assert len(publisher.published_skill_roots) == 0
            await publisher.publish("/my-skill/SKILL.md")
            assert "my-skill" in publisher.published_skill_roots

    @pytest.mark.asyncio
    async def test_root_level_file_not_treated_as_skill(self):
        """A file at the workspace root should not trigger skill
        directory detection (no parent directory to be a skill root)."""
        publisher, backend, _ = _make_publisher()
        backend.file_exists = MagicMock(return_value=False)

        artifact = _fake_artifact("standalone.txt")

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ) as mock_publish:
            await publisher.publish("/standalone.txt")

        assert mock_publish.call_args.kwargs["name"] == "standalone.txt"

    @pytest.mark.asyncio
    async def test_skill_directory_error_is_swallowed(self):
        """Errors during skill directory publish should be swallowed
        like any other inline publish error."""
        publisher, backend, status_builder = _make_publisher()
        backend.file_exists = MagicMock(return_value=True)

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            side_effect=OSError("zip failed"),
        ):
            await publisher.publish("/my-skill/SKILL.md")

        status_builder.add_artifact.assert_not_called()


# ---------------------------------------------------------------------------
# InlinePublisher with Daytona-style paths (rebase prefix)
# ---------------------------------------------------------------------------


def _make_daytona_publisher(
    *,
    rebase_prefix: str = "workspace",
) -> tuple[InlinePublisher, MagicMock, MagicMock]:
    """Create an InlinePublisher with a Daytona-style workspace backend
    that rebases paths (e.g. ``workspace/`` prefix).

    The ``_normalize`` mock applies the rebase prefix, simulating
    ``DaytonaWorkspaceBackend._normalize``.  Meanwhile ``file_exists``
    expects workspace-relative paths (no rebase prefix) since it
    internally calls ``_abs()`` which prepends the workspace root.
    """
    workspace_backend = MagicMock()

    def _normalize(path: str) -> str:
        clean = path.lstrip("/")
        return f"{rebase_prefix}/{clean}" if rebase_prefix else clean

    workspace_backend._normalize = MagicMock(side_effect=_normalize)
    workspace_backend.root_dir = "/home/daytona/workspace"
    workspace_backend.file_exists = MagicMock(return_value=False)

    status_builder = MagicMock()

    publisher = InlinePublisher(
        workspace_backend=workspace_backend,
        sandbox=MagicMock(),
        artifact_storage=MagicMock(),
        status_builder=status_builder,
        execution_id="exec-daytona-456",
        logger=logging.getLogger("test"),
    )
    return publisher, workspace_backend, status_builder


class TestDaytonaPathSeparation:
    """Verify that file_exists uses workspace-relative paths while
    publish_artifact uses sandbox-relative paths (with rebase prefix).

    This is the regression test for Bug 2: the double-prefix issue
    where file_exists received ``workspace/infra-chart-composer/SKILL.md``
    and _abs() produced ``/home/daytona/workspace/workspace/...``.
    """

    @pytest.mark.asyncio
    async def test_file_exists_gets_workspace_relative_path(self):
        """file_exists should receive paths WITHOUT the rebase prefix."""
        publisher, backend, _ = _make_daytona_publisher()

        dir_artifact = _fake_dir_artifact(
            name="my-skill",
            sandbox_path="workspace/my-skill",
        )

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ):
            await publisher.publish("my-skill/scripts/run.sh")

        for call in backend.file_exists.call_args_list:
            path_arg = call[0][0]
            assert not path_arg.startswith("workspace/"), (
                f"file_exists received sandbox-relative path: {path_arg!r} "
                f"(should be workspace-relative, no rebase prefix)"
            )

    @pytest.mark.asyncio
    async def test_publish_artifact_gets_sandbox_relative_path(self):
        """publish_artifact should receive paths WITH the rebase prefix."""
        publisher, backend, _ = _make_daytona_publisher()

        dir_artifact = _fake_dir_artifact(
            name="my-skill",
            sandbox_path="workspace/my-skill",
        )

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ) as mock_publish:
            await publisher.publish("my-skill/SKILL.md")

        publish_path = mock_publish.call_args.kwargs["path"]
        assert publish_path.startswith("workspace/"), (
            f"publish_artifact should receive sandbox-relative path "
            f"with rebase prefix, got: {publish_path!r}"
        )

    @pytest.mark.asyncio
    async def test_skill_root_via_file_exists_with_rebase(self):
        """Skill root should be discovered via file_exists with
        workspace-relative path, then published with sandbox-relative path."""
        publisher, backend, status_builder = _make_daytona_publisher()

        def _file_exists(path: str) -> bool:
            return path == "infra-chart-composer/SKILL.md"

        backend.file_exists = MagicMock(side_effect=_file_exists)

        dir_artifact = _fake_dir_artifact(
            name="infra-chart-composer",
            sandbox_path="workspace/infra-chart-composer",
            entries=["SKILL.md", "chart.yaml"],
        )

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ) as mock_publish:
            await publisher.publish("infra-chart-composer/chart.yaml")

        assert mock_publish.call_args.kwargs["path"] == "workspace/infra-chart-composer"
        status_builder.add_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_skill_md_write_with_rebase_publishes_correctly(self):
        """Writing SKILL.md with rebase normalizer should publish the
        directory with the sandbox-relative path."""
        publisher, _, status_builder = _make_daytona_publisher()

        dir_artifact = _fake_dir_artifact(
            name="infra-chart-composer",
            sandbox_path="workspace/infra-chart-composer",
        )

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=dir_artifact,
        ) as mock_publish:
            await publisher.publish("infra-chart-composer/SKILL.md")

        assert mock_publish.call_args.kwargs["path"] == "workspace/infra-chart-composer"
        assert mock_publish.call_args.kwargs["name"] == "infra-chart-composer"
        status_builder.add_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_double_prefix_regression(self):
        """Regression: file_exists must NOT receive
        ``workspace/workspace/...`` style paths."""
        publisher, backend, _ = _make_daytona_publisher()

        artifact = _fake_artifact("chart.yaml")

        with patch(
            "stigmer_runner.worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ):
            await publisher.publish("infra-chart-composer/chart.yaml")

        for call in backend.file_exists.call_args_list:
            path_arg = call[0][0]
            assert "workspace/workspace" not in path_arg, (
                f"Double-prefix detected in file_exists call: {path_arg!r}"
            )
