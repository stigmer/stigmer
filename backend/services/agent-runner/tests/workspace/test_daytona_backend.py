"""Tests for DaytonaWorkspaceBackend — mocked sandbox.

All Daytona SDK interactions (sandbox.fs, sandbox.process) are mocked.
These tests verify the adapter's correct translation of protocol calls
to Daytona SDK calls.
"""

from unittest.mock import MagicMock, call

import pytest

from worker.workspace.backend import ExecuteResult, WorkspaceBackend
from worker.workspace.daytona import DaytonaWorkspaceBackend


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sandbox(*, exec_exit_code: int = 0, exec_output: str = ""):
    """Build a mock Daytona sandbox."""
    sandbox = MagicMock()
    result = MagicMock()
    result.exit_code = exec_exit_code
    result.output = exec_output
    result.stderr = ""
    sandbox.process.exec.return_value = result
    sandbox.fs.upload_files = MagicMock()
    sandbox.fs.download_file = MagicMock()
    return sandbox


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """Constructor invariants."""

    def test_valid_construction(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/home/daytona/workspace",
        )
        assert backend.root_dir == "/home/daytona/workspace"

    def test_none_sandbox_raises(self):
        with pytest.raises(ValueError, match="must not be None"):
            DaytonaWorkspaceBackend(sandbox=None, workspace_root="/ws")

    def test_empty_workspace_root_raises(self):
        with pytest.raises(ValueError, match="non-empty absolute path"):
            DaytonaWorkspaceBackend(sandbox=_make_sandbox(), workspace_root="")

    def test_relative_workspace_root_raises(self):
        with pytest.raises(ValueError, match="non-empty absolute path"):
            DaytonaWorkspaceBackend(
                sandbox=_make_sandbox(), workspace_root="relative/path",
            )

    def test_trailing_slash_stripped(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/home/daytona/workspace/",
        )
        assert backend.root_dir == "/home/daytona/workspace"

    def test_satisfies_protocol(self):
        backend = DaytonaWorkspaceBackend(
            sandbox=_make_sandbox(), workspace_root="/ws",
        )
        assert isinstance(backend, WorkspaceBackend)


# ---------------------------------------------------------------------------
# File operations
# ---------------------------------------------------------------------------


class TestWriteFile:
    """write_file() delegates to sandbox.fs.upload_files."""

    def test_single_file(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        backend.write_file("bin/skills/SKILL.md", b"content")

        sandbox.fs.upload_files.assert_called_once()
        uploads = sandbox.fs.upload_files.call_args[0][0]
        assert len(uploads) == 1
        assert uploads[0].destination == "/ws/bin/skills/SKILL.md"


class TestWriteFiles:
    """write_files() batches uploads."""

    def test_batch_upload(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        backend.write_files([
            ("a/one.txt", b"1"),
            ("b/two.txt", b"2"),
        ])

        sandbox.fs.upload_files.assert_called_once()
        uploads = sandbox.fs.upload_files.call_args[0][0]
        assert len(uploads) == 2
        destinations = {u.destination for u in uploads}
        assert "/ws/a/one.txt" in destinations
        assert "/ws/b/two.txt" in destinations

    def test_empty_list_is_noop(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        backend.write_files([])
        sandbox.fs.upload_files.assert_not_called()


class TestReadFile:
    """read_file() delegates to sandbox.fs.download_file."""

    def test_returns_bytes(self):
        sandbox = _make_sandbox()
        sandbox.fs.download_file.return_value = b"file content"
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        result = backend.read_file("data.txt")
        assert result == b"file content"
        sandbox.fs.download_file.assert_called_once_with("/ws/data.txt")

    def test_string_response_encoded(self):
        sandbox = _make_sandbox()
        sandbox.fs.download_file.return_value = "string content"
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        result = backend.read_file("data.txt")
        assert result == b"string content"

    def test_missing_file_raises(self):
        sandbox = _make_sandbox()
        sandbox.fs.download_file.side_effect = Exception("Not found")
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        with pytest.raises(FileNotFoundError):
            backend.read_file("missing.txt")


class TestFileExists:
    """file_exists() via test -e."""

    def test_exists(self):
        backend = DaytonaWorkspaceBackend(
            sandbox=_make_sandbox(exec_exit_code=0),
            workspace_root="/ws",
        )
        assert backend.file_exists("file.txt") is True

    def test_not_exists(self):
        backend = DaytonaWorkspaceBackend(
            sandbox=_make_sandbox(exec_exit_code=1),
            workspace_root="/ws",
        )
        assert backend.file_exists("missing.txt") is False


class TestMkdir:
    """mkdir() via sandbox.process.exec."""

    def test_creates_directory(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        backend.mkdir("a/b/c")
        sandbox.process.exec.assert_called_once()
        cmd = sandbox.process.exec.call_args[0][0]
        assert "mkdir -p /ws/a/b/c" in cmd


# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------


class TestExecute:
    """execute() via sandbox.process.exec."""

    def test_basic_command(self):
        sandbox = _make_sandbox(exec_exit_code=0, exec_output="hello")
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        result = backend.execute("echo hello")
        assert isinstance(result, ExecuteResult)
        assert result.exit_code == 0
        assert result.stdout == "hello"

    def test_cwd_relative(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        backend.execute("ls", cwd="sub")
        cmd = sandbox.process.exec.call_args[0][0]
        assert "cd /ws/sub" in cmd

    def test_default_cwd_is_root(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        backend.execute("ls")
        cmd = sandbox.process.exec.call_args[0][0]
        assert "cd /ws" in cmd

    def test_exec_failure_returns_error(self):
        sandbox = MagicMock()
        sandbox.process.exec.side_effect = RuntimeError("connection lost")
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        result = backend.execute("echo test")
        assert result.exit_code == 1
        assert "connection lost" in result.stderr
