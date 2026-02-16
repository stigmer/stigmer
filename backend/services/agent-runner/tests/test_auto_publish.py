"""Unit tests for the _auto_publish_written_files safety net.

Tests cover:
- No-op when no write tool calls exist
- No-op when write tool calls are not COMPLETED
- Single file auto-publish (root-level file)
- Single file auto-publish (file inside a subdirectory -> publishes parent dir)
- Multiple files in the same directory -> publishes the common parent directory
- Multiple files in different directories -> publishes each file individually
- Graceful handling of publish_artifact failures (logs warning, doesn't crash)
- Paths with leading slashes are normalised
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
from google.protobuf.struct_pb2 import Struct

from worker.activities.execute_graphton import _auto_publish_written_files


# =============================================================================
# Helpers
# =============================================================================


def _make_tool_call(
    name: str,
    status: int = ToolCallStatus.TOOL_CALL_COMPLETED,
    path: str = "",
) -> MagicMock:
    """Create a mock ToolCall proto with the given name, status, and path arg."""
    tc = MagicMock()
    tc.name = name
    tc.status = status

    args = Struct()
    if path:
        args.update({"path": path})
    tc.args = args
    return tc


def _make_artifact(name: str = "test-artifact") -> MagicMock:
    """Create a mock ExecutionArtifact."""
    artifact = MagicMock()
    artifact.name = name
    return artifact


# =============================================================================
# Tests
# =============================================================================


class TestAutoPublishWrittenFiles:
    """Tests for _auto_publish_written_files safety net."""

    @pytest.mark.asyncio
    async def test_noop_when_no_tool_calls(self):
        """Returns 0 when tool_calls list is empty."""
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        count = await _auto_publish_written_files(
            tool_calls=[],
            sandbox=None,
            storage=MagicMock(),
            execution_id="exec-1",
            status_builder=status_builder,
            local_root="/workspace",
            logger=logger,
        )
        assert count == 0
        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_only_read_calls(self):
        """Returns 0 when tool_calls contain only read operations."""
        tool_calls = [
            _make_tool_call("read", path="foo.txt"),
            _make_tool_call("ls", path="/"),
            _make_tool_call("grep", path="*.py"),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        count = await _auto_publish_written_files(
            tool_calls=tool_calls,
            sandbox=None,
            storage=MagicMock(),
            execution_id="exec-2",
            status_builder=status_builder,
            local_root="/workspace",
            logger=logger,
        )
        assert count == 0
        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_write_not_completed(self):
        """Returns 0 when write tool calls are not in COMPLETED status."""
        tool_calls = [
            _make_tool_call(
                "write",
                status=ToolCallStatus.TOOL_CALL_RUNNING,
                path="output.txt",
            ),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        count = await _auto_publish_written_files(
            tool_calls=tool_calls,
            sandbox=None,
            storage=MagicMock(),
            execution_id="exec-3",
            status_builder=status_builder,
            local_root="/workspace",
            logger=logger,
        )
        assert count == 0
        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_single_root_file_published_individually(self):
        """A single file at workspace root is published as an individual file."""
        tool_calls = [
            _make_tool_call("write", path="output.txt"),
        ]
        mock_artifact = _make_artifact("output.txt")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-4",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        mock_publish.assert_called_once()
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "output.txt"
        assert call_kwargs.kwargs["name"] == "output.txt"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_single_file_in_subdir_publishes_parent_dir(self):
        """A single file inside a subdirectory publishes the parent directory."""
        tool_calls = [
            _make_tool_call("write", path="my-skill/SKILL.md"),
        ]
        mock_artifact = _make_artifact("my-skill")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-5",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        mock_publish.assert_called_once()
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "my-skill"
        assert call_kwargs.kwargs["name"] == "my-skill"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_multiple_files_same_dir_publishes_common_parent(self):
        """Multiple files under the same directory publish the common parent."""
        tool_calls = [
            _make_tool_call("write", path="agent-drafter/SKILL.md"),
            _make_tool_call("write_file", path="agent-drafter/scripts/build.sh"),
            _make_tool_call("write", path="agent-drafter/references/guide.md"),
        ]
        mock_artifact = _make_artifact("agent-drafter")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-6",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        mock_publish.assert_called_once()
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "agent-drafter"
        assert call_kwargs.kwargs["name"] == "agent-drafter"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_multiple_files_different_dirs_published_individually(self):
        """Files in unrelated directories are published individually."""
        tool_calls = [
            _make_tool_call("write", path="foo.txt"),
            _make_tool_call("write", path="bar.txt"),
        ]
        mock_artifact_1 = _make_artifact("foo.txt")
        mock_artifact_2 = _make_artifact("bar.txt")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            side_effect=[mock_artifact_1, mock_artifact_2],
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-7",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 2
        assert mock_publish.call_count == 2
        assert status_builder.add_artifact.call_count == 2

    @pytest.mark.asyncio
    async def test_leading_slashes_normalised(self):
        """Paths with leading slashes are stripped before processing."""
        tool_calls = [
            _make_tool_call("write", path="/my-skill/SKILL.md"),
        ]
        mock_artifact = _make_artifact("my-skill")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-8",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "my-skill"

    @pytest.mark.asyncio
    async def test_publish_failure_is_non_fatal(self):
        """If publish_artifact raises, the function logs a warning and continues."""
        tool_calls = [
            _make_tool_call("write", path="a/file1.txt"),
            _make_tool_call("write", path="b/file2.txt"),
        ]
        mock_artifact = _make_artifact("file2.txt")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            side_effect=[FileNotFoundError("not found"), mock_artifact],
        ):
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-9",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        # First publish failed, second succeeded.
        assert count == 1
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_write_file_alias_detected(self):
        """The write_file alias is treated identically to write."""
        tool_calls = [
            _make_tool_call("write_file", path="skill/SKILL.md"),
        ]
        mock_artifact = _make_artifact("skill")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-10",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "skill"

    @pytest.mark.asyncio
    async def test_empty_path_in_args_is_skipped(self):
        """Write calls with empty path in args are silently skipped."""
        tool_calls = [
            _make_tool_call("write", path=""),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        count = await _auto_publish_written_files(
            tool_calls=tool_calls,
            sandbox=None,
            storage=MagicMock(),
            execution_id="exec-11",
            status_builder=status_builder,
            local_root="/workspace",
            logger=logger,
        )
        assert count == 0
        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_deeply_nested_files_common_parent(self):
        """Deeply nested files resolve to their topmost common directory."""
        tool_calls = [
            _make_tool_call("write", path="project/src/main.py"),
            _make_tool_call("write", path="project/tests/test_main.py"),
            _make_tool_call("write", path="project/README.md"),
        ]
        mock_artifact = _make_artifact("project")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.execute_graphton.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-12",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "project"
        assert call_kwargs.kwargs["name"] == "project"
