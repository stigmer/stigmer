"""Unit tests for _check_workspace_file_exists() sentinel check.

Covers T05: resume fast-path workspace integrity verification.  Local-mode
tests use real filesystem (via ``tmp_path``); cloud-mode tests use mocked
sandbox.
"""

import logging

import pytest
from unittest.mock import MagicMock

from worker.activities.execute_graphton import _check_workspace_file_exists


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_logger() -> MagicMock:
    """Return a mock logger that records warnings."""
    return MagicMock(spec=logging.Logger)


def _make_sandbox_mock(*, exit_code: int = 0) -> MagicMock:
    """Build a mock Daytona sandbox for file-existence checks."""
    sandbox = MagicMock()
    result = MagicMock()
    result.exit_code = exit_code
    sandbox.process.exec.return_value = result
    return sandbox


# ===========================================================================
# Local mode — real filesystem via tmp_path
# ===========================================================================


class TestCheckWorkspaceFileExistsLocal:
    """_check_workspace_file_exists() in local mode (local_root set)."""

    def test_file_exists(self, tmp_path):
        """Returns True when the sentinel file exists on disk."""
        sentinel = tmp_path / "bin" / "skills" / "my-skill" / "SKILL.md"
        sentinel.parent.mkdir(parents=True)
        sentinel.write_text("# My Skill")

        result = _check_workspace_file_exists(
            sandbox=None,
            local_root=str(tmp_path),
            workspace_root=None,
            path="bin/skills/my-skill/SKILL.md",
            logger=_mock_logger(),
        )

        assert result is True

    def test_file_missing(self, tmp_path):
        """Returns False and logs warning when sentinel is absent."""
        logger = _mock_logger()

        result = _check_workspace_file_exists(
            sandbox=None,
            local_root=str(tmp_path),
            workspace_root=None,
            path="bin/skills/missing/SKILL.md",
            logger=logger,
        )

        assert result is False
        logger.warning.assert_called_once()
        assert "Sentinel file missing" in str(logger.warning.call_args)

    def test_nested_path_resolution(self, tmp_path):
        """Deeply nested paths are correctly joined with local_root."""
        deep = tmp_path / "a" / "b" / "c" / "d.txt"
        deep.parent.mkdir(parents=True)
        deep.write_text("deep")

        result = _check_workspace_file_exists(
            sandbox=None,
            local_root=str(tmp_path),
            workspace_root=None,
            path="a/b/c/d.txt",
            logger=_mock_logger(),
        )

        assert result is True

    def test_local_root_takes_priority_over_sandbox(self, tmp_path):
        """When local_root is set, sandbox is ignored entirely."""
        (tmp_path / "file.txt").write_text("exists")
        sandbox = _make_sandbox_mock(exit_code=1)  # Would fail if used

        result = _check_workspace_file_exists(
            sandbox=sandbox,
            local_root=str(tmp_path),
            workspace_root="/irrelevant",
            path="file.txt",
            logger=_mock_logger(),
        )

        assert result is True
        sandbox.process.exec.assert_not_called()


# ===========================================================================
# Cloud mode — mock sandbox
# ===========================================================================


class TestCheckWorkspaceFileExistsCloud:
    """_check_workspace_file_exists() in cloud mode (sandbox set)."""

    def test_file_exists_in_sandbox(self):
        """Returns True when test -f exits with 0."""
        sandbox = _make_sandbox_mock(exit_code=0)

        result = _check_workspace_file_exists(
            sandbox=sandbox,
            local_root=None,
            workspace_root="/home/daytona/workspace",
            path="bin/skills/my-skill/SKILL.md",
            logger=_mock_logger(),
        )

        assert result is True
        sandbox.process.exec.assert_called_once_with(
            "test -f /home/daytona/workspace/bin/skills/my-skill/SKILL.md",
            timeout=5,
        )

    def test_file_missing_in_sandbox(self):
        """Returns False and logs warning when test -f exits non-zero."""
        sandbox = _make_sandbox_mock(exit_code=1)
        logger = _mock_logger()

        result = _check_workspace_file_exists(
            sandbox=sandbox,
            local_root=None,
            workspace_root="/home/daytona/workspace",
            path="bin/skills/gone/SKILL.md",
            logger=logger,
        )

        assert result is False
        logger.warning.assert_called_once()
        assert "Sentinel file missing in sandbox" in str(logger.warning.call_args)

    def test_exec_raises_returns_false(self):
        """Returns False and logs warning when process.exec raises."""
        sandbox = MagicMock()
        sandbox.process.exec.side_effect = RuntimeError("connection lost")
        logger = _mock_logger()

        result = _check_workspace_file_exists(
            sandbox=sandbox,
            local_root=None,
            workspace_root="/home/daytona/workspace",
            path="bin/skills/error/SKILL.md",
            logger=logger,
        )

        assert result is False
        logger.warning.assert_called_once()
        assert "File existence check failed" in str(logger.warning.call_args)

    def test_workspace_root_trailing_slash_stripped(self):
        """Trailing slash on workspace_root does not produce double-slash."""
        sandbox = _make_sandbox_mock(exit_code=0)

        _check_workspace_file_exists(
            sandbox=sandbox,
            local_root=None,
            workspace_root="/home/daytona/workspace/",
            path="file.txt",
            logger=_mock_logger(),
        )

        sandbox.process.exec.assert_called_once_with(
            "test -f /home/daytona/workspace/file.txt",
            timeout=5,
        )

    def test_workspace_root_none_produces_absolute_path(self):
        """When workspace_root is None, path is prefixed with /."""
        sandbox = _make_sandbox_mock(exit_code=0)

        _check_workspace_file_exists(
            sandbox=sandbox,
            local_root=None,
            workspace_root=None,
            path="some/file.txt",
            logger=_mock_logger(),
        )

        sandbox.process.exec.assert_called_once_with(
            "test -f /some/file.txt",
            timeout=5,
        )


# ===========================================================================
# Edge cases
# ===========================================================================


class TestCheckWorkspaceFileExistsEdgeCases:
    """Edge cases for _check_workspace_file_exists()."""

    def test_neither_sandbox_nor_local_root_returns_true(self):
        """Vacuously True when there is nothing to check against."""
        result = _check_workspace_file_exists(
            sandbox=None,
            local_root=None,
            workspace_root=None,
            path="anything.txt",
            logger=_mock_logger(),
        )

        assert result is True
