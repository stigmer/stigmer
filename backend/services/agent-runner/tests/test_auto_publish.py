"""Unit tests for the _auto_publish_written_files safety net.

Tests cover:
- No-op when no file-modifying tool calls exist
- No-op when file-modifying tool calls are not COMPLETED
- Single file auto-publish (root-level file)
- Single file auto-publish (file inside a subdirectory -> publishes as file)
- Multiple files in the same directory -> publishes the common parent directory
- Multiple files in different directories -> publishes each file individually
- Graceful handling of publish_artifact failures (logs warning, doesn't crash)
- Paths with leading slashes are normalised
- edit / edit_file tool calls trigger auto-publish (same as write)
- Mixed write + edit tool calls combine paths correctly
- execute tool calls do NOT trigger auto-publish (intentional exclusion)
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ToolCallStatus
from google.protobuf.struct_pb2 import Struct

from stigmer_runner.worker.activities.execute_graphton import _auto_publish_written_files

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
            "worker.activities.graphton.attachments.publish_artifact",
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
    async def test_single_file_in_subdir_publishes_as_file(self):
        """A single file inside a subdirectory is published as a file artifact."""
        tool_calls = [
            _make_tool_call("write", path="my-skill/SKILL.md"),
        ]
        mock_artifact = _make_artifact("SKILL.md")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
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
        assert call_kwargs.kwargs["path"] == "my-skill/SKILL.md"
        assert call_kwargs.kwargs["name"] == "SKILL.md"
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
            "worker.activities.graphton.attachments.publish_artifact",
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
            "worker.activities.graphton.attachments.publish_artifact",
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
        mock_artifact = _make_artifact("SKILL.md")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
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
        assert call_kwargs.kwargs["path"] == "my-skill/SKILL.md"

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
            "worker.activities.graphton.attachments.publish_artifact",
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
        mock_artifact = _make_artifact("SKILL.md")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
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
        assert call_kwargs.kwargs["path"] == "skill/SKILL.md"

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
            "worker.activities.graphton.attachments.publish_artifact",
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

    # =========================================================================
    # edit / edit_file detection
    # =========================================================================

    @pytest.mark.asyncio
    async def test_edit_tool_triggers_auto_publish(self):
        """The edit tool triggers auto-publish for the edited file's path."""
        tool_calls = [
            _make_tool_call("edit", path="my-skill/SKILL.md"),
        ]
        mock_artifact = _make_artifact("SKILL.md")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-13",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "my-skill/SKILL.md"
        assert call_kwargs.kwargs["name"] == "SKILL.md"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_edit_file_alias_triggers_auto_publish(self):
        """The edit_file alias is treated identically to edit."""
        tool_calls = [
            _make_tool_call("edit_file", path="config/settings.yaml"),
        ]
        mock_artifact = _make_artifact("settings.yaml")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-14",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "config/settings.yaml"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_mixed_write_and_edit_combines_paths(self):
        """Write and edit tool calls are combined into a single publish group."""
        tool_calls = [
            _make_tool_call("write", path="project/SKILL.md"),
            _make_tool_call("edit", path="project/scripts/run.sh"),
            _make_tool_call("write_file", path="project/README.md"),
            _make_tool_call("edit_file", path="project/config.yaml"),
        ]
        mock_artifact = _make_artifact("project")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-15",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "project"
        assert call_kwargs.kwargs["name"] == "project"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    # =========================================================================
    # execute tool — intentional exclusion
    # =========================================================================

    @pytest.mark.asyncio
    async def test_execute_tool_does_not_trigger_auto_publish(self):
        """The execute tool is intentionally excluded from auto-publish.

        Shell commands can create/modify files, but the execute tool exposes
        only a ``command`` string — no ``path`` parameter.  Reliably extracting
        file paths from arbitrary shell commands is not tractable, so execute
        is excluded by design.
        """
        tool_calls = [
            _make_tool_call("execute", path=""),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        count = await _auto_publish_written_files(
            tool_calls=tool_calls,
            sandbox=None,
            storage=MagicMock(),
            execution_id="exec-16",
            status_builder=status_builder,
            local_root="/workspace",
            logger=logger,
        )
        assert count == 0
        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_execute_among_writes_is_ignored(self):
        """Execute calls mixed with write calls do not affect the result."""
        tool_calls = [
            _make_tool_call("write", path="output/result.txt"),
            _make_tool_call("execute", path=""),
            _make_tool_call("edit", path="output/notes.md"),
        ]
        mock_artifact = _make_artifact("output")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-17",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "output"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    # =========================================================================
    # path_normalizer — Daytona workspace-prefix rebasing
    # =========================================================================

    @pytest.mark.asyncio
    async def test_path_normalizer_applied_to_single_file(self):
        """When path_normalizer is provided, it transforms the path before publish.

        Simulates the Daytona rebase scenario where the write tool stores
        agent-space path "/mahatma_gandhi.txt" but the sandbox file lives
        at "workspace/mahatma_gandhi.txt".
        """
        tool_calls = [
            _make_tool_call("write", path="/mahatma_gandhi.txt"),
        ]
        mock_artifact = _make_artifact("mahatma_gandhi.txt")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        def fake_normalize(p: str) -> str:
            return f"workspace/{p.lstrip('/')}"

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=MagicMock(),
                storage=MagicMock(),
                execution_id="exec-norm-1",
                status_builder=status_builder,
                local_root=None,
                logger=logger,
                path_normalizer=fake_normalize,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "workspace/mahatma_gandhi.txt"
        assert call_kwargs.kwargs["name"] == "mahatma_gandhi.txt"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_path_normalizer_applied_to_multiple_files(self):
        """path_normalizer is applied to all paths before grouping/publish."""
        tool_calls = [
            _make_tool_call("write", path="/project/SKILL.md"),
            _make_tool_call("write", path="/project/scripts/run.sh"),
        ]
        mock_artifact = _make_artifact("workspace/project")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        def fake_normalize(p: str) -> str:
            return f"workspace/{p.lstrip('/')}"

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=MagicMock(),
                storage=MagicMock(),
                execution_id="exec-norm-2",
                status_builder=status_builder,
                local_root=None,
                logger=logger,
                path_normalizer=fake_normalize,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "workspace/project"
        assert call_kwargs.kwargs["name"] == "project"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_no_path_normalizer_strips_slashes_only(self):
        """Without path_normalizer, paths are only stripped of leading slashes.

        This is the local-mode fallback and the pre-fix behaviour.
        """
        tool_calls = [
            _make_tool_call("write", path="/output.txt"),
        ]
        mock_artifact = _make_artifact("output.txt")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-norm-3",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
                path_normalizer=None,
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "output.txt"

    # =========================================================================
    # already_published_paths — inline-publish dedup
    # =========================================================================

    @pytest.mark.asyncio
    async def test_already_published_single_file_skipped(self):
        """A file already published inline is skipped entirely."""
        tool_calls = [
            _make_tool_call("write", path="output.txt"),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-dedup-1",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
                already_published_paths={"output.txt"},
            )

        assert count == 0
        mock_publish.assert_not_called()
        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_already_published_partial_dedup(self):
        """Only un-published files are uploaded when some are already inline."""
        tool_calls = [
            _make_tool_call("write", path="a/file1.txt"),
            _make_tool_call("write", path="b/file2.txt"),
        ]
        mock_artifact = _make_artifact("file2.txt")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-dedup-2",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
                already_published_paths={"a/file1.txt"},
            )

        assert count == 1
        mock_publish.assert_called_once()
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "b/file2.txt"
        status_builder.add_artifact.assert_called_once_with(mock_artifact)

    @pytest.mark.asyncio
    async def test_already_published_all_skipped_returns_zero(self):
        """When all paths are already published, returns 0 immediately."""
        tool_calls = [
            _make_tool_call("write", path="project/a.txt"),
            _make_tool_call("edit", path="project/b.txt"),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-dedup-3",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
                already_published_paths={"project/a.txt", "project/b.txt"},
            )

        assert count == 0
        mock_publish.assert_not_called()

    @pytest.mark.asyncio
    async def test_already_published_with_normalizer(self):
        """Dedup works correctly with a path normalizer."""
        tool_calls = [
            _make_tool_call("write", path="/file.txt"),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        def fake_normalize(p: str) -> str:
            return f"workspace/{p.lstrip('/')}"

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=MagicMock(),
                storage=MagicMock(),
                execution_id="exec-dedup-4",
                status_builder=status_builder,
                local_root=None,
                logger=logger,
                path_normalizer=fake_normalize,
                already_published_paths={"workspace/file.txt"},
            )

        assert count == 0
        mock_publish.assert_not_called()

    # =========================================================================
    # Directory-level dedup (skill directory published inline)
    # =========================================================================

    @pytest.mark.asyncio
    async def test_files_under_published_directory_are_skipped(self):
        """When a directory artifact was published inline (e.g. a skill
        package), individual files under it are skipped by auto_publish."""
        tool_calls = [
            _make_tool_call("write", path="my-skill/SKILL.md"),
            _make_tool_call("write", path="my-skill/references/guide.md"),
            _make_tool_call("write", path="my-skill/scripts/run.sh"),
        ]
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-dir-dedup-1",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
                already_published_paths={"my-skill"},
            )

        assert count == 0
        mock_publish.assert_not_called()
        status_builder.add_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_mixed_skill_and_non_skill_files(self):
        """Files inside a published skill directory are skipped but
        files outside it are still published."""
        tool_calls = [
            _make_tool_call("write", path="my-skill/SKILL.md"),
            _make_tool_call("write", path="standalone.yaml"),
        ]
        mock_artifact = _make_artifact("standalone.yaml")
        status_builder = MagicMock()
        logger = logging.getLogger("test")

        with patch(
            "worker.activities.graphton.attachments.publish_artifact",
            new_callable=AsyncMock,
            return_value=mock_artifact,
        ) as mock_publish:
            count = await _auto_publish_written_files(
                tool_calls=tool_calls,
                sandbox=None,
                storage=MagicMock(),
                execution_id="exec-dir-dedup-2",
                status_builder=status_builder,
                local_root="/workspace",
                logger=logger,
                already_published_paths={"my-skill"},
            )

        assert count == 1
        call_kwargs = mock_publish.call_args
        assert call_kwargs.kwargs["path"] == "standalone.yaml"
