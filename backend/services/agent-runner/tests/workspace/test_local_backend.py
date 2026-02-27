"""Tests for LocalWorkspaceBackend — real filesystem via pytest tmp_path."""

import os

import pytest

from worker.workspace.backend import ExecuteResult, WorkspaceBackend
from worker.workspace.local import LocalWorkspaceBackend


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
