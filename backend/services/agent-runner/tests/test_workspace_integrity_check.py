"""Unit tests for WorkspaceBackend.file_exists() — sentinel check.

Replaces the old _check_workspace_file_exists() tests.  The sentinel
check is now done through the unified WorkspaceBackend interface.
Local-mode tests use real filesystem (via ``tmp_path``).
"""

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
