"""Unit tests for InlinePublisher class.

Tests cover:
- Path normalization with workspace backend _normalize method
- Path normalization fallback (lstrip) when _normalize is absent
- Artifact registration on status_builder.add_artifact
- Exception swallowing (publish errors are logged, never raised)
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from ai.stigmer.agentic.agentexecution.v1.artifact_pb2 import ExecutionArtifact

from worker.activities.graphton.inline_publisher import InlinePublisher


def _make_publisher(
    *,
    has_normalizer: bool = True,
    sandbox: MagicMock | None = MagicMock(),
) -> tuple[InlinePublisher, MagicMock, MagicMock]:
    """Create an InlinePublisher with mock collaborators.

    Returns (publisher, workspace_backend_mock, status_builder_mock).
    """
    workspace_backend = MagicMock()
    if has_normalizer:
        workspace_backend._normalize = MagicMock(
            side_effect=lambda p: p.lstrip("/"),
        )
    else:
        del workspace_backend._normalize

    workspace_backend.root_dir = "/workspace"

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
            "worker.activities.graphton.inline_publisher.publish_artifact",
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
            "worker.activities.graphton.inline_publisher.publish_artifact",
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
            "worker.activities.graphton.inline_publisher.publish_artifact",
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
            "worker.activities.graphton.inline_publisher.publish_artifact",
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
            "worker.activities.graphton.inline_publisher.publish_artifact",
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
            "worker.activities.graphton.inline_publisher.publish_artifact",
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
            "worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            side_effect=IOError("upload failed"),
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
            "worker.activities.graphton.inline_publisher.publish_artifact",
            new_callable=AsyncMock,
            return_value=artifact,
        ):
            await publisher.publish("/file.txt")
