"""Tests for DaytonaWorkspaceBackend — mocked sandbox.

All Daytona SDK interactions (sandbox.fs, sandbox.process) are mocked.
These tests verify the adapter's correct translation of protocol calls
to Daytona SDK calls.
"""

from unittest.mock import MagicMock

import pytest

from worker.workspace.backend import ExecuteResult, WorkspaceBackend
from worker.workspace.daytona import DaytonaWorkspaceBackend

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sandbox(*, exec_exit_code: int = 0, exec_output: str = ""):
    """Build a mock Daytona sandbox.

    Mocks both ``process.exec`` (used by mkdir, file_exists, write_file,
    and workspace-root bootstrapping) and
    ``process.execute_session_command`` (used by execute()).
    """
    sandbox = MagicMock()

    exec_result = MagicMock()
    exec_result.exit_code = exec_exit_code
    exec_result.output = exec_output
    exec_result.stderr = ""
    sandbox.process.exec.return_value = exec_result

    session_result = MagicMock()
    session_result.exit_code = exec_exit_code
    session_result.stdout = exec_output
    session_result.stderr = ""
    sandbox.process.execute_session_command.return_value = session_result

    sandbox.fs.upload_files = MagicMock()
    sandbox.fs.download_file = MagicMock()
    return sandbox


def _last_session_command(sandbox) -> str:
    """Extract the command string from the last ``execute_session_command`` call."""
    return sandbox.process.execute_session_command.call_args[0][1].command


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

    def test_creates_workspace_root_directory(self):
        sandbox = _make_sandbox()
        DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/home/daytona/workspace",
        )
        first_exec_call = sandbox.process.exec.call_args_list[0]
        assert first_exec_call[0][0] == "mkdir -p /home/daytona/workspace"

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
        sandbox.process.exec.reset_mock()
        backend.mkdir("a/b/c")
        sandbox.process.exec.assert_called_once()
        cmd = sandbox.process.exec.call_args[0][0]
        assert "mkdir -p /ws/a/b/c" in cmd


# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------


class TestExecute:
    """execute() via sandbox.process.execute_session_command."""

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
        assert "cd /ws/sub" in _last_session_command(sandbox)

    def test_default_cwd_is_root(self):
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        backend.execute("ls")
        assert "cd /ws" in _last_session_command(sandbox)

    def test_exec_failure_returns_error(self):
        sandbox = MagicMock()
        sandbox.process.execute_session_command.side_effect = RuntimeError(
            "connection lost",
        )
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/ws",
        )
        result = backend.execute("echo test")
        assert result.exit_code == 1
        assert "connection lost" in result.stderr


# ---------------------------------------------------------------------------
# cwd conformance — multi-workspace subdirectory scoping
# ---------------------------------------------------------------------------


class TestCwdConformance:
    """Verify the ``cwd`` parameter contract for multi-entry subdirectory scoping.

    The ``WorkspaceBackend`` protocol (``backend.py``) defines ``cwd``
    as "relative to ``root_dir``" with ``None`` meaning the workspace
    root itself.  These tests verify Daytona implements this correctly,
    addressing the open question from Phase 4 Session 4.
    """

    def test_cwd_scopes_to_subdirectory(self):
        """execute(cmd, cwd="my-repo") runs in {root}/my-repo/."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/home/daytona/workspace",
        )
        backend.execute("git diff", cwd="my-repo")

        cmd = _last_session_command(sandbox)
        assert cmd == "cd /home/daytona/workspace/my-repo && git diff"

    def test_no_cwd_runs_in_root(self):
        """execute(cmd) without cwd runs in the workspace root."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/home/daytona/workspace",
        )
        backend.execute("ls -la")

        cmd = _last_session_command(sandbox)
        assert cmd == "cd /home/daytona/workspace && ls -la"

    def test_cwd_strips_leading_slash(self):
        """Leading slash is stripped — cwd is always relative to root."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/workspace",
        )
        backend.execute("find .", cwd="/my-repo")

        cmd = _last_session_command(sandbox)
        assert cmd == "cd /workspace/my-repo && find ."

    def test_cwd_nested_subdirectory(self):
        """cwd can be a nested path within the workspace."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/workspace",
        )
        backend.execute("cat README.md", cwd="services/api")

        cmd = _last_session_command(sandbox)
        assert cmd == "cd /workspace/services/api && cat README.md"
