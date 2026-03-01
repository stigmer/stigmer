"""Unit tests for FilesystemBackend path resolution and file operations.

Covers the chroot-like _resolve_sandbox_path() semantics that ensure absolute
sandbox paths (e.g. /bin/skills) resolve relative to root_dir, not the host
filesystem.
"""

import os
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

    # -- Double-prefix bug (path already contains root_dir) --

    def test_path_starting_with_root_dir(self, sandbox: FilesystemBackend) -> None:
        """Paths starting with root_dir must NOT produce a double prefix."""
        root = str(sandbox.root_dir)
        resolved = sandbox._resolve_sandbox_path(f"{root}/bin/skills/abc/SKILL.md")
        assert resolved == sandbox.root_dir / "bin" / "skills" / "abc" / "SKILL.md"

    def test_path_equal_to_root_dir(self, sandbox: FilesystemBackend) -> None:
        """Path exactly equal to root_dir resolves to root_dir."""
        root = str(sandbox.root_dir)
        resolved = sandbox._resolve_sandbox_path(root)
        assert resolved == sandbox.root_dir

    def test_all_three_path_formats_resolve_identically(
        self, sandbox: FilesystemBackend
    ) -> None:
        """Relative, absolute-no-root, and absolute-with-root all resolve the same."""
        root = str(sandbox.root_dir)
        expected = sandbox.root_dir / "bin" / "skills" / "abc" / "SKILL.md"

        assert sandbox._resolve_sandbox_path("bin/skills/abc/SKILL.md") == expected
        assert sandbox._resolve_sandbox_path("/bin/skills/abc/SKILL.md") == expected
        assert sandbox._resolve_sandbox_path(f"{root}/bin/skills/abc/SKILL.md") == expected


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

    # -- Double-prefix paths (agent uses root_dir prefix) --

    def test_read_with_root_dir_prefix(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """read('{root_dir}/bin/skills/...') should find the file (no double prefix)."""
        root = str(sandbox_with_skills.root_dir)
        content = sandbox_with_skills.read_file(
            f"{root}/bin/skills/abc123hash/SKILL.md"
        )
        assert "test-skill" in content

    def test_write_with_root_dir_prefix(self, sandbox: FilesystemBackend) -> None:
        """write('{root_dir}/output/...', ...) should create under root_dir."""
        root = str(sandbox.root_dir)
        sandbox.write_file(f"{root}/output/result.txt", "double-prefix test")

        expected = sandbox.root_dir / "output" / "result.txt"
        assert expected.exists()
        assert expected.read_text() == "double-prefix test"

    def test_list_files_with_root_dir_prefix(
        self, sandbox_with_skills: FilesystemBackend
    ) -> None:
        """list_files('{root_dir}/bin/skills') should list skill dirs."""
        root = str(sandbox_with_skills.root_dir)
        result = sandbox_with_skills.list_files(f"{root}/bin/skills")
        assert "abc123hash" in result


# =============================================================================
# read_file on directories (graceful listing)
# =============================================================================


@pytest.fixture
def tree_sandbox(tmp_path: Path) -> FilesystemBackend:
    """Sandbox with a multi-level directory tree for listing tests.

    Layout::

        {root_dir}/
        └── project/
            ├── src/
            │   ├── main.py       (30 bytes)
            │   └── utils.py      (15 bytes)
            ├── docs/
            │   └── guide.md      (10 bytes)
            ├── .git/
            │   └── config        (hidden — should be skipped)
            ├── __pycache__/
            │   └── main.cpython-311.pyc  (should be skipped)
            ├── venv/
            │   └── lib/          (should be skipped)
            ├── dist/
            │   └── bundle.js     (should be skipped)
            └── README.md         (20 bytes)
    """
    sb = FilesystemBackend(root_dir=tmp_path)
    base = tmp_path / "project"

    (base / "src").mkdir(parents=True)
    (base / "src" / "main.py").write_text("x" * 30)
    (base / "src" / "utils.py").write_text("x" * 15)

    (base / "docs").mkdir()
    (base / "docs" / "guide.md").write_text("x" * 10)

    (base / ".git").mkdir()
    (base / ".git" / "config").write_text("hidden")

    (base / "__pycache__").mkdir()
    (base / "__pycache__" / "main.cpython-311.pyc").write_text("bytecode")

    (base / "venv" / "lib").mkdir(parents=True)

    (base / "dist").mkdir()
    (base / "dist" / "bundle.js").write_text("compiled")

    (base / "README.md").write_text("x" * 20)
    return sb


class TestReadFileOnDirectory:
    """read_file() on a directory returns a structured listing, not an error."""

    def test_returns_string_not_raises(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert isinstance(result, str)

    def test_header_contains_path(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "[Directory: project]" in result

    def test_listing_contains_child_dirs(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "src/" in result
        assert "docs/" in result

    def test_listing_contains_child_files(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "README.md" in result

    def test_listing_shows_file_sizes(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "20 bytes" in result

    def test_listing_shows_dir_item_counts(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "2 items" in result  # src/ has main.py + utils.py

    def test_listing_skips_hidden_dirs(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert ".git" not in result

    def test_listing_skips_pycache(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "__pycache__" not in result

    def test_listing_skips_venv(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "venv" not in result

    def test_listing_skips_dist(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        assert "dist" not in result

    def test_dirs_listed_before_files(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project")
        first_dir_pos = result.find("src/")
        first_file_pos = result.find("README.md")
        assert first_dir_pos < first_file_pos

    def test_read_file_on_file_still_returns_content(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read_file("project/README.md")
        assert result == "x" * 20

    def test_read_via_facade_on_directory(
        self, tree_sandbox: FilesystemBackend,
    ) -> None:
        result = tree_sandbox.read("project")
        assert "[Directory: project]" in result

    def test_empty_directory(self, sandbox: FilesystemBackend) -> None:
        (sandbox.root_dir / "empty_dir").mkdir()
        result = sandbox.read_file("empty_dir")
        assert "[Directory: empty_dir]" in result
        assert "(empty)" in result

    def test_truncation_with_many_entries(self, tmp_path: Path) -> None:
        sb = FilesystemBackend(root_dir=tmp_path)
        big_dir = tmp_path / "big"
        big_dir.mkdir()
        for i in range(150):
            (big_dir / f"file_{i:04d}.txt").write_text("data")

        result = sb.read_file("big")
        assert "truncated" in result


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


# =============================================================================
# Virtual platform mount (AD-01 v3)
# =============================================================================


@pytest.fixture
def platform_sandbox(tmp_path: Path) -> FilesystemBackend:
    """FilesystemBackend with a separate platform_dir."""
    ws = tmp_path / "workspace"
    pdir = tmp_path / "platform"
    return FilesystemBackend(root_dir=ws, platform_dir=pdir)


@pytest.fixture
def platform_dir(tmp_path: Path) -> Path:
    """The physical platform directory (sibling to workspace)."""
    return tmp_path / "platform"


@pytest.fixture
def workspace_dir(tmp_path: Path) -> Path:
    """The physical workspace directory."""
    return tmp_path / "workspace"


class TestPlatformMountPathResolution:
    """Path resolution for .stigmer/* paths via virtual mount."""

    def test_stigmer_relative(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        resolved = platform_sandbox._resolve_sandbox_path(".stigmer/skills/a/SKILL.md")
        assert resolved == platform_dir / "skills" / "a" / "SKILL.md"

    def test_stigmer_absolute(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        resolved = platform_sandbox._resolve_sandbox_path("/.stigmer/inputs/data.pdf")
        assert resolved == platform_dir / "inputs" / "data.pdf"

    def test_bare_stigmer(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        resolved = platform_sandbox._resolve_sandbox_path(".stigmer")
        assert resolved == platform_dir

    def test_regular_path_unaffected(
        self, platform_sandbox: FilesystemBackend, workspace_dir: Path,
    ) -> None:
        resolved = platform_sandbox._resolve_sandbox_path("src/main.py")
        assert resolved == workspace_dir / "src" / "main.py"


class TestPlatformMountFileOps:
    """File operations routed through the virtual .stigmer/ mount."""

    def test_write_to_stigmer_lands_in_platform_dir(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        platform_sandbox.write_file(".stigmer/skills/a/SKILL.md", "# My Skill")
        assert (platform_dir / "skills" / "a" / "SKILL.md").read_text() == "# My Skill"

    def test_read_from_stigmer(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        (platform_dir / "inputs").mkdir(parents=True)
        (platform_dir / "inputs" / "data.txt").write_text("hello")
        assert platform_sandbox.read_file(".stigmer/inputs/data.txt") == "hello"

    def test_write_then_read_roundtrip(
        self, platform_sandbox: FilesystemBackend,
    ) -> None:
        platform_sandbox.write_file(".stigmer/skills/s/SKILL.md", "content")
        assert platform_sandbox.read_file(".stigmer/skills/s/SKILL.md") == "content"

    def test_workspace_has_no_stigmer_dir(
        self, platform_sandbox: FilesystemBackend,
        platform_dir: Path, workspace_dir: Path,
    ) -> None:
        """Writing to .stigmer/ must NOT create a .stigmer dir in workspace."""
        platform_sandbox.write_file(".stigmer/skills/a/SKILL.md", "data")
        assert not (workspace_dir / ".stigmer").exists()
        assert (platform_dir / "skills" / "a" / "SKILL.md").exists()

    def test_regular_write_to_workspace(
        self, platform_sandbox: FilesystemBackend, workspace_dir: Path,
    ) -> None:
        platform_sandbox.write_file("src/main.py", "print('hi')")
        assert (workspace_dir / "src" / "main.py").read_text() == "print('hi')"


class TestPlatformMountListFiles:
    """list_files() with virtual .stigmer entry."""

    def test_root_listing_includes_stigmer(
        self, platform_sandbox: FilesystemBackend, workspace_dir: Path,
    ) -> None:
        (workspace_dir / "src").mkdir()
        result = platform_sandbox.list_files(".")
        assert ".stigmer" in result
        assert "src" in result

    def test_stigmer_listing_shows_platform_contents(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        (platform_dir / "skills").mkdir(parents=True)
        (platform_dir / "inputs").mkdir(parents=True)
        result = platform_sandbox.list_files(".stigmer")
        assert "skills" in result
        assert "inputs" in result

    def test_stigmer_subdir_listing(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        (platform_dir / "skills" / "my-skill").mkdir(parents=True)
        (platform_dir / "skills" / "my-skill" / "SKILL.md").write_text("x")
        result = platform_sandbox.list_files(".stigmer/skills/my-skill")
        assert "SKILL.md" in result

    def test_no_duplicate_stigmer_entry(
        self, platform_sandbox: FilesystemBackend, workspace_dir: Path,
    ) -> None:
        """If .stigmer physically exists in workspace, don't duplicate."""
        (workspace_dir / ".stigmer").mkdir()
        result = platform_sandbox.list_files(".")
        assert result.count(".stigmer") == 1


class TestPlatformMountTraversalSafety:
    """Containment checks for the platform scope."""

    def test_escape_from_platform_blocked(
        self, platform_sandbox: FilesystemBackend,
    ) -> None:
        with pytest.raises(ValueError, match="outside platform root"):
            platform_sandbox.write_file(".stigmer/../../etc/passwd", "evil")

    def test_workspace_traversal_still_blocked(
        self, platform_sandbox: FilesystemBackend,
    ) -> None:
        with pytest.raises(ValueError, match="resolves outside sandbox root"):
            platform_sandbox.write_file("../../etc/passwd", "evil")


class TestPlatformMountExecuteEnvVar:
    """$STIGMER_PLATFORM_DIR environment variable injection."""

    def test_env_var_set(
        self, platform_sandbox: FilesystemBackend, platform_dir: Path,
    ) -> None:
        result = platform_sandbox.execute("echo $STIGMER_PLATFORM_DIR")
        assert result.exit_code == 0
        assert result.stdout.strip() == str(platform_dir.resolve())

    def test_env_var_absent_without_platform_dir(
        self, sandbox: FilesystemBackend,
    ) -> None:
        result = sandbox.execute("echo ${STIGMER_PLATFORM_DIR:-UNSET}")
        assert result.exit_code == 0
        assert result.stdout.strip() == "UNSET"


class TestPlatformMountBackwardCompat:
    """Without platform_dir, .stigmer paths resolve under root_dir."""

    def test_stigmer_resolves_under_workspace(
        self, sandbox: FilesystemBackend,
    ) -> None:
        sandbox.write_file(".stigmer/skills/a/SKILL.md", "data")
        expected = sandbox.root_dir / ".stigmer" / "skills" / "a" / "SKILL.md"
        assert expected.read_text() == "data"

    def test_root_listing_no_virtual_entry(
        self, sandbox: FilesystemBackend,
    ) -> None:
        result = sandbox.list_files(".")
        assert ".stigmer" not in result


# =============================================================================
# list_files filtering (hidden entries and noise directories)
# =============================================================================


class TestListFilesFiltering:
    """list_files() must exclude hidden dirs and well-known noise directories."""

    def test_git_excluded(self, tree_sandbox: FilesystemBackend) -> None:
        result = tree_sandbox.list_files("project")
        assert ".git" not in result

    def test_pycache_excluded(self, tree_sandbox: FilesystemBackend) -> None:
        result = tree_sandbox.list_files("project")
        assert "__pycache__" not in result

    def test_node_modules_excluded(self, tmp_path: Path) -> None:
        sb = FilesystemBackend(root_dir=tmp_path)
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "pkg").mkdir()
        (tmp_path / "src").mkdir()
        result = sb.list_files(".")
        assert "node_modules" not in result
        assert "src" in result

    def test_hidden_dotfiles_excluded(self, tmp_path: Path) -> None:
        sb = FilesystemBackend(root_dir=tmp_path)
        (tmp_path / ".env").write_text("SECRET=1")
        (tmp_path / ".hidden_dir").mkdir()
        (tmp_path / "visible.txt").write_text("ok")
        result = sb.list_files(".")
        assert ".env" not in result
        assert ".hidden_dir" not in result
        assert "visible.txt" in result

    def test_venv_excluded(self, tree_sandbox: FilesystemBackend) -> None:
        result = tree_sandbox.list_files("project")
        assert "venv" not in result

    def test_dist_excluded(self, tree_sandbox: FilesystemBackend) -> None:
        result = tree_sandbox.list_files("project")
        assert "dist" not in result

    @pytest.mark.parametrize("dirname", [
        "target", "vendor", "coverage", "bower_components",
    ])
    def test_skip_dir_excluded(self, tmp_path: Path, dirname: str) -> None:
        sb = FilesystemBackend(root_dir=tmp_path)
        (tmp_path / dirname).mkdir()
        (tmp_path / dirname / "artifact.bin").write_text("data")
        (tmp_path / "src").mkdir()
        result = sb.list_files(".")
        assert dirname not in result
        assert "src" in result

    def test_visible_entries_preserved(self, tree_sandbox: FilesystemBackend) -> None:
        result = tree_sandbox.list_files("project")
        assert "src" in result
        assert "docs" in result
        assert "README.md" in result

    def test_file_raises_not_a_directory(self, tree_sandbox: FilesystemBackend) -> None:
        with pytest.raises(NotADirectoryError):
            tree_sandbox.list_files("project/README.md")


# =============================================================================
# is_directory()
# =============================================================================


class TestIsDirectory:
    """is_directory() checks whether a sandbox path is a directory."""

    def test_directory_returns_true(self, tree_sandbox: FilesystemBackend) -> None:
        assert tree_sandbox.is_directory("project/src") is True

    def test_file_returns_false(self, tree_sandbox: FilesystemBackend) -> None:
        assert tree_sandbox.is_directory("project/README.md") is False

    def test_nonexistent_returns_false(self, tree_sandbox: FilesystemBackend) -> None:
        assert tree_sandbox.is_directory("does/not/exist") is False

    def test_root_returns_true(self, sandbox: FilesystemBackend) -> None:
        assert sandbox.is_directory(".") is True

    def test_traversal_returns_false(self, sandbox: FilesystemBackend) -> None:
        assert sandbox.is_directory("../../etc") is False


# =============================================================================
# .gitignore filtering
# =============================================================================


@pytest.fixture
def gitignore_sandbox(tmp_path: Path) -> FilesystemBackend:
    """Sandbox with a .gitignore and matching entries.

    Layout::

        {root_dir}/
        ├── .gitignore          ("*.pyc\\nbuild/\\nlogs/*.log\\n")
        ├── src/
        │   ├── main.py
        │   └── main.pyc        (gitignored)
        ├── build/              (gitignored dir)
        │   └── output.js
        ├── logs/
        │   ├── app.log         (gitignored)
        │   └── readme.txt
        ├── lib/
        │   └── helper.py
        └── README.md
    """
    gi = tmp_path / ".gitignore"
    gi.write_text("*.pyc\nbuild/\nlogs/*.log\n")

    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('hi')")
    (tmp_path / "src" / "main.pyc").write_bytes(b"\x00" * 10)

    (tmp_path / "build").mkdir()
    (tmp_path / "build" / "output.js").write_text("//js")

    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "app.log").write_text("error")
    (tmp_path / "logs" / "readme.txt").write_text("kept")

    (tmp_path / "lib").mkdir()
    (tmp_path / "lib" / "helper.py").write_text("def f(): ...")

    (tmp_path / "README.md").write_text("# Hello")

    return FilesystemBackend(root_dir=tmp_path)


class TestGitignoreListFiles:
    """.gitignore patterns must be respected by list_files()."""

    def test_gitignored_dir_excluded(self, gitignore_sandbox: FilesystemBackend) -> None:
        entries = gitignore_sandbox.list_files(".")
        assert "build" not in entries

    def test_non_gitignored_dir_visible(self, gitignore_sandbox: FilesystemBackend) -> None:
        entries = gitignore_sandbox.list_files(".")
        assert "src" in entries
        assert "lib" in entries
        assert "logs" in entries

    def test_gitignored_file_in_subdir(self, gitignore_sandbox: FilesystemBackend) -> None:
        entries = gitignore_sandbox.list_files("src")
        assert "main.py" in entries
        assert "main.pyc" not in entries

    def test_path_prefix_gitignore(self, gitignore_sandbox: FilesystemBackend) -> None:
        entries = gitignore_sandbox.list_files("logs")
        assert "app.log" not in entries
        assert "readme.txt" in entries

    def test_skip_dirs_still_work_with_gitignore(self, tmp_path: Path) -> None:
        (tmp_path / ".gitignore").write_text("*.tmp\n")
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "src").mkdir()
        sb = FilesystemBackend(root_dir=tmp_path)
        entries = sb.list_files(".")
        assert "node_modules" not in entries
        assert "src" in entries

    def test_no_gitignore_no_filtering(self, tmp_path: Path) -> None:
        (tmp_path / "build").mkdir()
        (tmp_path / "build" / "app.js").write_text("//ok")
        (tmp_path / "src").mkdir()
        sb = FilesystemBackend(root_dir=tmp_path)
        entries = sb.list_files(".")
        assert "build" in entries
        assert "src" in entries


class TestGitignoreDirectoryListing:
    """.gitignore filtering in _format_directory_listing (read on a dir)."""

    def test_gitignored_file_excluded_from_listing(
        self, gitignore_sandbox: FilesystemBackend,
    ) -> None:
        listing = gitignore_sandbox.read_file("src")
        assert "main.py" in listing
        assert "main.pyc" not in listing

    def test_gitignored_dir_excluded_from_listing(
        self, gitignore_sandbox: FilesystemBackend,
    ) -> None:
        listing = gitignore_sandbox.read_file(".")
        assert "build" not in listing
        assert "src" in listing

    def test_item_count_excludes_gitignored(
        self, gitignore_sandbox: FilesystemBackend,
    ) -> None:
        listing = gitignore_sandbox.read_file(".")
        assert "logs/" in listing
        # logs/ has readme.txt visible, app.log gitignored → 1 item
        assert "1 item" in listing


class TestGitignorePlatformMount:
    """.gitignore filtering must NOT apply to platform-mount paths."""

    def test_platform_files_bypass_gitignore(self, tmp_path: Path) -> None:
        ws = tmp_path / "workspace"
        pdir = tmp_path / "platform"
        ws.mkdir()
        pdir.mkdir()

        (ws / ".gitignore").write_text("*.md\n")
        (pdir / "skills").mkdir()
        (pdir / "skills" / "SKILL.md").write_text("# Skill")

        sb = FilesystemBackend(root_dir=ws, platform_dir=pdir)
        entries = sb.list_files(".stigmer/skills")
        assert "SKILL.md" in entries


# =============================================================================
# Directory cache (T03)
# =============================================================================


@pytest.fixture
def cache_sandbox(tmp_path: Path) -> FilesystemBackend:
    """Sandbox with a small directory tree for cache tests.

    Layout::

        {root_dir}/
        ├── src/
        │   ├── main.py
        │   └── utils.py
        ├── tests/
        │   └── test_main.py
        └── README.md
    """
    sb = FilesystemBackend(root_dir=tmp_path)
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('main')")
    (tmp_path / "src" / "utils.py").write_text("print('utils')")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_main.py").write_text("def test(): pass")
    (tmp_path / "README.md").write_text("# Hello")
    return sb


class TestDirectoryCache:
    """list_files() and is_directory() caching with invalidation."""

    def test_list_files_returns_same_result_on_repeat(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        first = cache_sandbox.list_files(".")
        second = cache_sandbox.list_files(".")
        assert sorted(first) == sorted(second)

    def test_list_files_returns_copy(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        """Caller cannot corrupt the cache by mutating the returned list."""
        first = cache_sandbox.list_files(".")
        first.append("INJECTED")
        second = cache_sandbox.list_files(".")
        assert "INJECTED" not in second

    def test_list_files_cache_serves_stale_on_direct_fs_mutation(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        """Bypassing the backend to mutate the filesystem leaves the cache stale.

        This proves the cache is active — the new file is invisible until
        the cache is explicitly invalidated.
        """
        cache_sandbox.list_files("src")
        (cache_sandbox.root_dir / "src" / "new_file.py").write_text("x")
        stale = cache_sandbox.list_files("src")
        assert "new_file.py" not in stale

        cache_sandbox._invalidate_cache()
        fresh = cache_sandbox.list_files("src")
        assert "new_file.py" in fresh

    def test_is_directory_cache_hit_after_list_files(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        """list_files() pre-populates the path type cache for all entries."""
        cache_sandbox.list_files(".")
        root = str(cache_sandbox.root_dir)
        assert f"{root}/src" in cache_sandbox._path_type_cache
        assert cache_sandbox._path_type_cache[f"{root}/src"] is True
        assert f"{root}/README.md" in cache_sandbox._path_type_cache
        assert cache_sandbox._path_type_cache[f"{root}/README.md"] is False

    def test_is_directory_caches_own_lookups(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        assert cache_sandbox.is_directory("src") is True
        resolved = str(cache_sandbox.root_dir / "src")
        assert resolved in cache_sandbox._path_type_cache

    def test_write_file_invalidates_cache(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        cache_sandbox.list_files("src")
        assert cache_sandbox._dir_cache

        cache_sandbox.write_file("src/new.py", "x")
        assert not cache_sandbox._dir_cache
        assert not cache_sandbox._path_type_cache

        entries = cache_sandbox.list_files("src")
        assert "new.py" in entries

    def test_write_facade_invalidates_cache(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        cache_sandbox.list_files(".")
        cache_sandbox.write("new_root_file.txt", "x")
        assert not cache_sandbox._dir_cache

    def test_execute_invalidates_cache(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        cache_sandbox.list_files(".")
        assert cache_sandbox._dir_cache

        cache_sandbox.execute("touch new_via_exec.txt")
        assert not cache_sandbox._dir_cache

        entries = cache_sandbox.list_files(".")
        assert "new_via_exec.txt" in entries

    def test_path_representations_share_cache(
        self, cache_sandbox: FilesystemBackend,
    ) -> None:
        """'.', '', and '/' all resolve to root_dir and share one cache entry."""
        cache_sandbox.list_files(".")
        assert len(cache_sandbox._dir_cache) == 1

        result_empty = cache_sandbox.list_files("")
        result_slash = cache_sandbox.list_files("/")
        assert sorted(result_empty) == sorted(result_slash)
        assert len(cache_sandbox._dir_cache) == 1

    def test_platform_stigmer_entry_cached(self, tmp_path: Path) -> None:
        ws = tmp_path / "workspace"
        pdir = tmp_path / "platform"
        sb = FilesystemBackend(root_dir=ws, platform_dir=pdir)
        (ws / "src").mkdir()

        first = sb.list_files(".")
        assert ".stigmer" in first

        second = sb.list_files(".")
        assert ".stigmer" in second

    def test_gitignore_filtering_correct_with_cache(self, tmp_path: Path) -> None:
        (tmp_path / ".gitignore").write_text("*.pyc\nlogs/\n")
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "main.py").write_text("x")
        (tmp_path / "src" / "main.pyc").write_bytes(b"\x00")
        (tmp_path / "logs").mkdir()
        (tmp_path / "logs" / "app.log").write_text("x")

        sb = FilesystemBackend(root_dir=tmp_path)

        first = sb.list_files(".")
        assert "src" in first
        assert "logs" not in first

        second = sb.list_files(".")
        assert sorted(first) == sorted(second)

        sub_first = sb.list_files("src")
        assert "main.py" in sub_first
        assert "main.pyc" not in sub_first

        sub_second = sb.list_files("src")
        assert sorted(sub_first) == sorted(sub_second)
