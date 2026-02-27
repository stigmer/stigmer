"""Unit tests for WorkspaceBackend.file_exists() — sentinel check.

Replaces the old _check_workspace_file_exists() tests.  The sentinel
check is now done through the unified WorkspaceBackend interface.
Local-mode tests use real filesystem (via ``tmp_path``); cloud-mode
tests use mocked sandbox.
"""

from unittest.mock import MagicMock

from worker.workspace.local import LocalWorkspaceBackend


class TestFileExistsLocal:
    """WorkspaceBackend.file_exists() via LocalWorkspaceBackend."""

    def test_file_exists(self, tmp_path):
        sentinel = tmp_path / "bin" / "skills" / "my-skill" / "SKILL.md"
        sentinel.parent.mkdir(parents=True)
        sentinel.write_text("# My Skill")

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.file_exists("bin/skills/my-skill/SKILL.md") is True

    def test_file_missing(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.file_exists("bin/skills/missing/SKILL.md") is False

    def test_nested_path(self, tmp_path):
        deep = tmp_path / "a" / "b" / "c" / "d.txt"
        deep.parent.mkdir(parents=True)
        deep.write_text("deep")

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.file_exists("a/b/c/d.txt") is True

    def test_directory_exists(self, tmp_path):
        (tmp_path / "some_dir").mkdir()
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.file_exists("some_dir") is True


class TestFileExistsDaytona:
    """WorkspaceBackend.file_exists() via DaytonaWorkspaceBackend."""

    @staticmethod
    def _make_backend(*, exit_code: int = 0):
        from worker.workspace.daytona import DaytonaWorkspaceBackend

        sandbox = MagicMock()
        result = MagicMock()
        result.exit_code = exit_code
        sandbox.process.exec.return_value = result

        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/home/daytona/workspace",
        )
        return backend, sandbox

    def test_file_exists(self):
        backend, sandbox = self._make_backend(exit_code=0)
        assert backend.file_exists("bin/skills/my-skill/SKILL.md") is True

        sandbox.process.exec.assert_called_once()
        cmd = sandbox.process.exec.call_args[0][0]
        assert "test -e" in cmd
        assert "/home/daytona/workspace/bin/skills/my-skill/SKILL.md" in cmd

    def test_file_missing(self):
        backend, _ = self._make_backend(exit_code=1)
        assert backend.file_exists("bin/skills/gone/SKILL.md") is False

    def test_exec_raises_returns_false(self):
        from worker.workspace.daytona import DaytonaWorkspaceBackend

        sandbox = MagicMock()
        sandbox.process.exec.side_effect = RuntimeError("connection lost")
        backend = DaytonaWorkspaceBackend(
            sandbox=sandbox, workspace_root="/home/daytona/workspace",
        )

        assert backend.file_exists("bin/skills/error/SKILL.md") is False
