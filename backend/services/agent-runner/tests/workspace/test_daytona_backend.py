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


# ---------------------------------------------------------------------------
# _normalize — agent-space to sandbox-space path translation
# ---------------------------------------------------------------------------


class TestNormalize:
    """Verify _normalize translates agent-space paths to sandbox-relative paths.

    When workspace_root is a subdirectory of sandbox_root, a rebase
    prefix must be prepended so that sandbox.fs resolves to the correct
    location.
    """

    def test_rebase_prefix_computed(self):
        """Rebase prefix is 'workspace' when workspace is under sandbox root."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        assert backend._rebase_prefix == "workspace"

    def test_no_rebase_when_roots_equal(self):
        """No rebase prefix when workspace_root == sandbox_root."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona",
            sandbox_root="/home/daytona",
        )
        assert backend._rebase_prefix == ""

    def test_no_rebase_when_sandbox_root_omitted(self):
        """No rebase prefix when sandbox_root is not provided."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
        )
        assert backend._rebase_prefix == ""

    def test_bare_relative_path(self):
        """A bare filename is rebased to workspace/filename."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        assert backend._normalize("mcp-server-stigmer.yaml") == "workspace/mcp-server-stigmer.yaml"

    def test_relative_path_with_subdirectory(self):
        """A relative path with subdirectories is rebased correctly."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        assert backend._normalize("bin/skills/a/SKILL.md") == "workspace/bin/skills/a/SKILL.md"

    def test_absolute_workspace_path_stripped_and_rebased(self):
        """An absolute path with workspace_root prefix is stripped then rebased."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        result = backend._normalize("/home/daytona/workspace/bin/skills/a/SKILL.md")
        assert result == "workspace/bin/skills/a/SKILL.md"

    def test_leading_slash_stripped_and_rebased(self):
        """A leading-slash relative path is stripped then rebased."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        assert backend._normalize("/bin/skills/a/SKILL.md") == "workspace/bin/skills/a/SKILL.md"

    def test_workspace_root_path_normalizes_to_prefix(self):
        """The workspace root itself normalizes to the rebase prefix."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        assert backend._normalize("/home/daytona/workspace") == "workspace"

    def test_no_rebase_strips_slashes_only(self):
        """Without rebase, normalize just strips leading slashes."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona",
            sandbox_root="/home/daytona",
        )
        assert backend._normalize("/output.txt") == "output.txt"
        assert backend._normalize("output.txt") == "output.txt"

    def test_no_rebase_workspace_root_returns_dot(self):
        """Without rebase, workspace root path normalizes to '.'."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona",
            sandbox_root="/home/daytona",
        )
        assert backend._normalize("/home/daytona") == "."

    def test_hasattr_normalize_true(self):
        """The publish code uses hasattr to detect _normalize — confirm it exists."""
        sandbox = _make_sandbox()
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        assert hasattr(backend, "_normalize")
