"""Tests for LocalWorkspaceBackend — real filesystem via pytest tmp_path."""

import os

import pytest

from stigmer_runner.worker.workspace.backend import ExecuteResult, WorkspaceBackend
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend


class TestConstruction:
    """Constructor invariants."""

    def test_creates_root_dir(self, tmp_path):
        root = tmp_path / "workspace"
        backend = LocalWorkspaceBackend(root_dir=root)
        assert os.path.isdir(root)
        assert backend.root_dir == str(root.resolve())

    def test_empty_root_raises(self):
        with pytest.raises(ValueError, match="non-empty"):
            LocalWorkspaceBackend(root_dir="")

    def test_satisfies_protocol(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert isinstance(backend, WorkspaceBackend)


class TestWriteFile:
    """write_file() and write_files()."""

    def test_write_file_creates_parents(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        backend.write_file("a/b/c.txt", b"hello")
        assert (tmp_path / "a" / "b" / "c.txt").read_bytes() == b"hello"

    def test_write_files_batch(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        backend.write_files([
            ("x/one.txt", b"1"),
            ("x/two.txt", b"2"),
        ])
        assert (tmp_path / "x" / "one.txt").read_bytes() == b"1"
        assert (tmp_path / "x" / "two.txt").read_bytes() == b"2"


class TestReadFile:
    """read_file()."""

    def test_read_existing_file(self, tmp_path):
        (tmp_path / "hello.txt").write_bytes(b"world")
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.read_file("hello.txt") == b"world"

    def test_read_missing_file_raises(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        with pytest.raises(FileNotFoundError):
            backend.read_file("missing.txt")


class TestFileExists:
    """file_exists()."""

    def test_exists(self, tmp_path):
        (tmp_path / "present.txt").write_text("yes")
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.file_exists("present.txt") is True

    def test_not_exists(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.file_exists("absent.txt") is False

    def test_directory_exists(self, tmp_path):
        (tmp_path / "dir").mkdir()
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.file_exists("dir") is True


class TestMkdir:
    """mkdir()."""

    def test_creates_nested(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        backend.mkdir("a/b/c")
        assert (tmp_path / "a" / "b" / "c").is_dir()

    def test_idempotent(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        backend.mkdir("d")
        backend.mkdir("d")
        assert (tmp_path / "d").is_dir()


class TestExecute:
    """execute()."""

    def test_echo(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = backend.execute("echo hello")
        assert isinstance(result, ExecuteResult)
        assert result.exit_code == 0
        assert "hello" in result.stdout

    def test_cwd_relative(self, tmp_path):
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "marker.txt").write_text("ok")
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = backend.execute("cat marker.txt", cwd="sub")
        assert result.exit_code == 0
        assert "ok" in result.stdout

    def test_failure_returns_nonzero(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = backend.execute("false")
        assert result.exit_code != 0

    def test_timeout(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = backend.execute("sleep 60", timeout=1)
        assert result.exit_code == 124
        assert "timed out" in result.stderr.lower()


class TestPathSafety:
    """Path traversal protection."""

    def test_traversal_blocked(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        with pytest.raises(ValueError, match="outside workspace"):
            backend.write_file("../../etc/passwd", b"evil")

    def test_absolute_path_treated_as_relative(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        backend.write_file("/bin/test.txt", b"data")
        assert (tmp_path / "bin" / "test.txt").read_bytes() == b"data"


# =============================================================================
# Virtual platform mount (AD-01 v3)
# =============================================================================


class TestPlatformMountConstruction:
    """Construction with platform_dir."""

    def test_creates_platform_dir(self, tmp_path):
        pdir = tmp_path / "platform"
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "ws", platform_dir=pdir)
        assert pdir.is_dir()
        assert backend.platform_dir == str(pdir.resolve())

    def test_no_platform_dir_returns_none(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.platform_dir is None

    def test_satisfies_protocol_with_platform_dir(self, tmp_path):
        backend = LocalWorkspaceBackend(
            root_dir=tmp_path / "ws",
            platform_dir=tmp_path / "platform",
        )
        assert isinstance(backend, WorkspaceBackend)


class TestPlatformMountFileOperations:
    """File operations routed through the virtual .stigmer/ mount."""

    @pytest.fixture()
    def backend(self, tmp_path):
        ws = tmp_path / "workspace"
        pdir = tmp_path / "platform"
        return LocalWorkspaceBackend(root_dir=ws, platform_dir=pdir)

    @pytest.fixture()
    def platform_path(self, tmp_path):
        return tmp_path / "platform"

    @pytest.fixture()
    def workspace_path(self, tmp_path):
        return tmp_path / "workspace"

    def test_write_to_stigmer_lands_in_platform_dir(
        self, backend, platform_path,
    ):
        backend.write_file(".stigmer/skills/my-skill/SKILL.md", b"# Skill")
        assert (platform_path / "skills" / "my-skill" / "SKILL.md").read_bytes() == b"# Skill"

    def test_read_from_stigmer_reads_platform_dir(
        self, backend, platform_path,
    ):
        (platform_path / "skills").mkdir(parents=True)
        (platform_path / "skills" / "SKILL.md").write_bytes(b"content")
        assert backend.read_file(".stigmer/skills/SKILL.md") == b"content"

    def test_file_exists_in_stigmer(self, backend, platform_path):
        (platform_path / "inputs").mkdir(parents=True)
        (platform_path / "inputs" / "data.pdf").write_bytes(b"pdf")
        assert backend.file_exists(".stigmer/inputs/data.pdf") is True
        assert backend.file_exists(".stigmer/inputs/missing.pdf") is False

    def test_mkdir_in_stigmer(self, backend, platform_path):
        backend.mkdir(".stigmer/skills/new-skill/scripts")
        assert (platform_path / "skills" / "new-skill" / "scripts").is_dir()

    def test_regular_paths_still_resolve_to_workspace(
        self, backend, workspace_path,
    ):
        backend.write_file("src/main.py", b"print('hello')")
        assert (workspace_path / "src" / "main.py").read_bytes() == b"print('hello')"

    def test_workspace_has_no_stigmer_dir(
        self, backend, workspace_path, platform_path,
    ):
        """Writing to .stigmer/ must NOT create a .stigmer dir in workspace."""
        backend.write_file(".stigmer/skills/a/SKILL.md", b"data")
        assert not (workspace_path / ".stigmer").exists()
        assert (platform_path / "skills" / "a" / "SKILL.md").exists()

    def test_absolute_stigmer_path(self, backend, platform_path):
        backend.write_file("/.stigmer/inputs/file.txt", b"abs")
        assert (platform_path / "inputs" / "file.txt").read_bytes() == b"abs"

    def test_bare_stigmer_resolves_to_platform_root(self, backend, platform_path):
        assert backend.file_exists(".stigmer") is True


class TestPlatformMountTraversalSafety:
    """Containment checks for the platform scope."""

    @pytest.fixture()
    def backend(self, tmp_path):
        return LocalWorkspaceBackend(
            root_dir=tmp_path / "workspace",
            platform_dir=tmp_path / "platform",
        )

    def test_escape_from_platform_blocked(self, backend):
        with pytest.raises(ValueError, match="outside platform root"):
            backend.write_file(".stigmer/../../etc/passwd", b"evil")

    def test_workspace_traversal_still_blocked(self, backend):
        with pytest.raises(ValueError, match="outside workspace root"):
            backend.write_file("../../etc/passwd", b"evil")


class TestPlatformMountExecuteEnvVar:
    """$STIGMER_PLATFORM_DIR environment variable injection."""

    def test_env_var_set_when_platform_dir_configured(self, tmp_path):
        pdir = tmp_path / "platform"
        backend = LocalWorkspaceBackend(
            root_dir=tmp_path / "ws", platform_dir=pdir,
        )
        result = backend.execute("echo $STIGMER_PLATFORM_DIR")
        assert result.exit_code == 0
        assert result.stdout.strip() == str(pdir.resolve())

    def test_env_var_absent_when_no_platform_dir(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = backend.execute(
            "echo ${STIGMER_PLATFORM_DIR:-UNSET}",
        )
        assert result.exit_code == 0
        assert result.stdout.strip() == "UNSET"


class TestPlatformMountBackwardCompat:
    """Without platform_dir, behavior is identical to before."""

    def test_stigmer_path_resolves_under_workspace(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        backend.write_file(".stigmer/skills/a/SKILL.md", b"data")
        assert (tmp_path / ".stigmer" / "skills" / "a" / "SKILL.md").read_bytes() == b"data"
