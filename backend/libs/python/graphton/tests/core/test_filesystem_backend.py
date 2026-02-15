"""Unit tests for FilesystemBackend path resolution and file operations.

Covers the chroot-like _resolve_sandbox_path() semantics that ensure absolute
sandbox paths (e.g. /bin/skills) resolve relative to root_dir, not the host
filesystem.
"""

import os
import tempfile
from pathlib import Path

import pytest

from graphton.core.backends.filesystem import FilesystemBackend


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sandbox(tmp_path: Path) -> FilesystemBackend:
    """Create a FilesystemBackend rooted at a fresh temp directory."""
    return FilesystemBackend(root_dir=tmp_path)


@pytest.fixture
def sandbox_with_skills(sandbox: FilesystemBackend) -> FilesystemBackend:
    """Create a sandbox with a pre-populated /bin/skills/ structure.

    Simulates what SkillWriter._write_skills_local() produces.

    Layout::

        {root_dir}/
        └── bin/
            └── skills/
                └── abc123hash/
                    ├── SKILL.md
                    └── scripts/
                        └── init_skill.py
    """
    skill_dir = sandbox.root_dir / "bin" / "skills" / "abc123hash"
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True)

    (skill_dir / "SKILL.md").write_text("---\nname: test-skill\n---\n# Test")
    (scripts_dir / "init_skill.py").write_text("#!/usr/bin/env python3\nprint('hello')")
    os.chmod(scripts_dir / "init_skill.py", 0o755)

    return sandbox


# =============================================================================
# _resolve_sandbox_path
# =============================================================================


class TestResolveSandboxPath:
    """Tests for the chroot-like path resolution method."""

    def test_relative_path(self, sandbox: FilesystemBackend) -> None:
        """Relative paths resolve under root_dir."""
        resolved = sandbox._resolve_sandbox_path("inputs/data.txt")
        assert resolved == sandbox.root_dir / "inputs" / "data.txt"

    def test_dot_path(self, sandbox: FilesystemBackend) -> None:
        """The default '.' path resolves to root_dir itself."""
        resolved = sandbox._resolve_sandbox_path(".")
        assert resolved == sandbox.root_dir

    def test_absolute_path_stripped(self, sandbox: FilesystemBackend) -> None:
        """Absolute paths like /bin/skills resolve under root_dir, not host."""
        resolved = sandbox._resolve_sandbox_path("/bin/skills")
        assert resolved == sandbox.root_dir / "bin" / "skills"

    def test_absolute_path_deep(self, sandbox: FilesystemBackend) -> None:
        """Deep absolute paths resolve correctly."""
        resolved = sandbox._resolve_sandbox_path("/bin/skills/abc123/SKILL.md")
        assert resolved == sandbox.root_dir / "bin" / "skills" / "abc123" / "SKILL.md"

    def test_multiple_leading_slashes(self, sandbox: FilesystemBackend) -> None:
        """Multiple leading slashes are all stripped."""
        resolved = sandbox._resolve_sandbox_path("///bin/skills")
        assert resolved == sandbox.root_dir / "bin" / "skills"

    def test_traversal_blocked(self, sandbox: FilesystemBackend) -> None:
        """Paths that traverse outside root_dir are rejected."""
        with pytest.raises(ValueError, match="resolves outside sandbox root"):
            sandbox._resolve_sandbox_path("../../etc/passwd")

    def test_traversal_via_absolute_blocked(self, sandbox: FilesystemBackend) -> None:
        """Absolute traversal like /../../../etc/passwd is rejected."""
        with pytest.raises(ValueError, match="resolves outside sandbox root"):
            sandbox._resolve_sandbox_path("/../../../etc/passwd")

    def test_traversal_inside_root_allowed(self, sandbox: FilesystemBackend) -> None:
        """Paths that go up and back down within root_dir are allowed."""
        # Create a directory so the resolution can normalize
        (sandbox.root_dir / "a" / "b").mkdir(parents=True)
        resolved = sandbox._resolve_sandbox_path("a/b/../b/file.txt")
        assert resolved == sandbox.root_dir / "a" / "b" / "file.txt"

    def test_empty_path(self, sandbox: FilesystemBackend) -> None:
        """Empty string resolves to root_dir itself."""
        resolved = sandbox._resolve_sandbox_path("")
        assert resolved == sandbox.root_dir

    def test_just_slash(self, sandbox: FilesystemBackend) -> None:
        """A single '/' resolves to root_dir (sandbox root)."""
        resolved = sandbox._resolve_sandbox_path("/")
        assert resolved == sandbox.root_dir


# =============================================================================
# list_files with absolute paths (the exact bug scenario from the logs)
# =============================================================================


class TestListFilesAbsolutePath:
    """Reproduce and verify the fix for the /bin/skills ls bug."""

    def test_ls_bin_skills_absolute_finds_content(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """ls('/bin/skills') should list the skill hash directory, not host /bin/skills."""
        result = sandbox_with_skills.list_files("/bin/skills")
        assert "abc123hash" in result

    def test_ls_bin_skills_relative_also_works(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """ls('bin/skills') (relative) should also find the content."""
        result = sandbox_with_skills.list_files("bin/skills")
        assert "abc123hash" in result

    def test_ls_skill_dir_absolute(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """ls('/bin/skills/abc123hash') should list SKILL.md and scripts/."""
        result = sandbox_with_skills.list_files("/bin/skills/abc123hash")
        assert "SKILL.md" in result
        assert "scripts" in result

    def test_ls_nonexistent_returns_empty(
        self, sandbox: FilesystemBackend
    ) -> None:
        """ls of a non-existent absolute path returns empty list."""
        result = sandbox.list_files("/does/not/exist")
        assert result == []

    def test_ls_root_slash(self, sandbox_with_skills: FilesystemBackend) -> None:
        """ls('/') should list the sandbox root, not host root."""
        result = sandbox_with_skills.list_files("/")
        assert "bin" in result


# =============================================================================
# read_file / write_file with absolute paths
# =============================================================================


class TestReadWriteAbsolutePaths:
    """Verify read and write work with absolute sandbox paths."""

    def test_read_absolute_path(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """read('/bin/skills/abc123hash/SKILL.md') should return file content."""
        content = sandbox_with_skills.read_file("/bin/skills/abc123hash/SKILL.md")
        assert "test-skill" in content

    def test_read_relative_path(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """read('bin/skills/abc123hash/SKILL.md') should also work."""
        content = sandbox_with_skills.read_file("bin/skills/abc123hash/SKILL.md")
        assert "test-skill" in content

    def test_write_absolute_path(self, sandbox: FilesystemBackend) -> None:
        """write('/output/result.txt', ...) should create the file under root_dir."""
        sandbox.write_file("/output/result.txt", "hello world")

        expected = sandbox.root_dir / "output" / "result.txt"
        assert expected.exists()
        assert expected.read_text() == "hello world"

    def test_write_then_read_absolute(self, sandbox: FilesystemBackend) -> None:
        """Round-trip: write via absolute path, read via absolute path."""
        sandbox.write_file("/data/config.json", '{"key": "value"}')
        content = sandbox.read_file("/data/config.json")
        assert content == '{"key": "value"}'

    def test_read_via_facade(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """The read() facade also resolves absolute paths."""
        content = sandbox_with_skills.read("/bin/skills/abc123hash/SKILL.md")
        assert "test-skill" in content

    def test_write_via_facade(self, sandbox: FilesystemBackend) -> None:
        """The write() facade also resolves absolute paths."""
        sandbox.write("/output/data.txt", "test content")

        expected = sandbox.root_dir / "output" / "data.txt"
        assert expected.exists()
        assert expected.read_text() == "test content"


# =============================================================================
# execute command with relative skill paths
# =============================================================================


class TestExecuteWithSkillPaths:
    """Verify the execute tool works when skill paths are sandbox-relative."""

    def test_execute_ls_relative_skill_dir(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """Shell 'ls bin/skills' (relative) should list skill hash dir from cwd=root_dir."""
        result = sandbox_with_skills.execute("ls bin/skills")
        assert result.exit_code == 0
        assert "abc123hash" in result.stdout

    def test_execute_cat_relative_skill_file(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """Shell 'cat bin/skills/abc123hash/SKILL.md' should work."""
        result = sandbox_with_skills.execute(
            "cat bin/skills/abc123hash/SKILL.md"
        )
        assert result.exit_code == 0
        assert "test-skill" in result.stdout

    def test_execute_python_script_relative(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """Shell 'python3 bin/skills/abc123hash/scripts/init_skill.py' should work."""
        result = sandbox_with_skills.execute(
            "python3 bin/skills/abc123hash/scripts/init_skill.py"
        )
        assert result.exit_code == 0
        assert "hello" in result.stdout
