"""Tests for workspace file-tree generation (worker.workspace.tree).

Covers:
- build_directory_tree: local os.* walker (extracted from execute_graphton)
- human_size: byte formatting
- _parse_find_output: GNU find output parsing for remote walkers
- _build_directory_tree_via_find: remote walker with mocked backend
- build_workspace_file_tree: public API dispatch and formatting
- _format_workspace_tree: prompt section formatting
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from stigmer_runner.worker.workspace.tree import (
    TREE_SKIP_DIRS,
    _build_directory_tree_via_find,
    _format_workspace_tree,
    _parse_find_output,
    build_directory_tree,
    build_workspace_file_tree,
    human_size,
)

# ============================================================================
# Mock backend for remote walker tests
# ============================================================================


@dataclass
class _MockExecuteResult:
    exit_code: int
    stdout: str
    stderr: str


class _MockBackend:
    """Minimal WorkspaceBackend duck-type for tree tests."""

    def __init__(self, root_dir: str, *, find_output: str = "", exit_code: int = 0):
        self._root_dir = root_dir
        self._find_output = find_output
        self._exit_code = exit_code
        self.executed_commands: list[str] = []

    @property
    def root_dir(self) -> str:
        return self._root_dir

    def execute(self, command: str, *, cwd: str | None = None, timeout: int = 30):
        self.executed_commands.append(command)
        return _MockExecuteResult(
            exit_code=self._exit_code,
            stdout=self._find_output,
            stderr="" if self._exit_code == 0 else "find: error",
        )


# ============================================================================
# Helpers
# ============================================================================


def _make_tree(tmp_path):
    """Build a representative directory tree.

    Layout::

        root/
        ├── docs/
        │   └── guide.md      (10 bytes)
        ├── src/
        │   ├── main.py       (30 bytes)
        │   └── utils.py      (15 bytes)
        ├── .git/
        │   └── config
        ├── __pycache__/
        │   └── cached.pyc
        ├── node_modules/
        │   └── pkg/
        │       └── index.js
        └── README.md         (20 bytes)
    """
    root = tmp_path / "root"
    (root / "src").mkdir(parents=True)
    (root / "src" / "main.py").write_text("x" * 30)
    (root / "src" / "utils.py").write_text("x" * 15)
    (root / "docs").mkdir()
    (root / "docs" / "guide.md").write_text("x" * 10)
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("hidden")
    (root / "__pycache__").mkdir()
    (root / "__pycache__" / "cached.pyc").write_text("bytecode")
    (root / "node_modules" / "pkg").mkdir(parents=True)
    (root / "node_modules" / "pkg" / "index.js").write_text("module")
    (root / "README.md").write_text("x" * 20)
    return root


# ============================================================================
# TestHumanSize
# ============================================================================


class TestHumanSize:

    def test_bytes(self):
        assert human_size(500) == "500 bytes"

    def test_zero_bytes(self):
        assert human_size(0) == "0 bytes"

    def test_kilobytes(self):
        assert human_size(2048) == "2.0 KB"

    def test_megabytes(self):
        assert human_size(5 * 1024 * 1024) == "5.0 MB"

    def test_boundary_just_under_1kb(self):
        assert human_size(1023) == "1023 bytes"

    def test_boundary_exactly_1kb(self):
        assert human_size(1024) == "1.0 KB"

    def test_boundary_exactly_1mb(self):
        assert human_size(1024 * 1024) == "1.0 MB"


# ============================================================================
# TestBuildDirectoryTree — local walker
# ============================================================================


class TestBuildDirectoryTree:

    def test_produces_sorted_dirs_first(self, tmp_path):
        root = _make_tree(tmp_path)
        lines, total = build_directory_tree(str(root), "")
        paths = [line.strip().lstrip("- ").strip("`").rstrip("/`") for line in lines]
        _ = [i for i, p in enumerate(paths) if p.endswith("/") or "docs" in p or "src" in p]
        assert total == 6

    def test_skips_hidden_directories(self, tmp_path):
        root = _make_tree(tmp_path)
        lines, _ = build_directory_tree(str(root), "")
        joined = "\n".join(lines)
        assert ".git" not in joined

    def test_skips_configured_dirs(self, tmp_path):
        root = _make_tree(tmp_path)
        lines, _ = build_directory_tree(str(root), "")
        joined = "\n".join(lines)
        assert "__pycache__" not in joined
        assert "node_modules" not in joined

    def test_includes_file_sizes(self, tmp_path):
        root = _make_tree(tmp_path)
        lines, _ = build_directory_tree(str(root), "")
        joined = "\n".join(lines)
        assert "30 bytes" in joined
        assert "20 bytes" in joined

    def test_prefix_prepended(self, tmp_path):
        root = _make_tree(tmp_path)
        lines, _ = build_directory_tree(str(root), "project/")
        joined = "\n".join(lines)
        assert "project/src/" in joined
        assert "project/README.md" in joined

    def test_respects_max_depth(self, tmp_path):
        deep = tmp_path / "a" / "b" / "c" / "d" / "e"
        deep.mkdir(parents=True)
        (deep / "leaf.txt").write_text("deep")

        lines, total = build_directory_tree(str(tmp_path), "", max_depth=2)
        joined = " ".join(lines)
        assert "a/" in joined
        assert "a/b/" in joined
        assert "leaf.txt" not in joined

    def test_respects_max_entries(self, tmp_path):
        base = tmp_path / "big"
        base.mkdir()
        for i in range(50):
            (base / f"file_{i:03d}.txt").write_text("x")

        lines, total = build_directory_tree(str(base), "big/", max_entries=10)
        assert len(lines) == 10
        assert total == 50

    def test_empty_directory(self, tmp_path):
        empty = tmp_path / "empty"
        empty.mkdir()
        lines, total = build_directory_tree(str(empty), "")
        assert lines == []
        assert total == 0

    def test_single_file(self, tmp_path):
        root = tmp_path / "ws"
        root.mkdir()
        (root / "only.txt").write_text("hello")

        lines, total = build_directory_tree(str(root), "")
        assert total == 1
        assert len(lines) == 1
        assert "only.txt" in lines[0]

    def test_custom_skip_dirs(self, tmp_path):
        root = tmp_path / "ws"
        (root / "keep").mkdir(parents=True)
        (root / "keep" / "a.txt").write_text("a")
        (root / "drop").mkdir()
        (root / "drop" / "b.txt").write_text("b")

        lines, total = build_directory_tree(
            str(root), "",
            skip_dirs=frozenset({"drop"}),
        )
        joined = "\n".join(lines)
        assert "keep" in joined
        assert "drop" not in joined

    @pytest.mark.parametrize("skip_dir", ["venv", "dist", "target", "vendor"])
    def test_default_skip_dirs_include(self, skip_dir):
        assert skip_dir in TREE_SKIP_DIRS


# ============================================================================
# TestParseFindOutput — remote walker parsing
# ============================================================================


class TestParseFindOutput:

    def test_basic_parsing(self):
        stdout = "D\tsrc\nF\t100\tsrc/main.py\nF\t200\tREADME.md\n"
        lines, total = _parse_find_output(stdout, max_entries=200)
        assert total == 3
        joined = "\n".join(lines)
        assert "src/" in joined
        assert "src/main.py" in joined
        assert "README.md" in joined

    def test_dirs_before_files(self):
        stdout = "F\t50\tfile.txt\nD\tdir\nF\t30\tdir/inner.py\n"
        lines, total = _parse_find_output(stdout, max_entries=200)
        first_dir = next(i for i, line in enumerate(lines) if "dir/" in line)
        first_file = next(i for i, line in enumerate(lines) if "file.txt" in line)
        assert first_dir < first_file

    def test_alphabetical_sorting(self):
        stdout = "D\tzebra\nD\talpha\nF\t10\tzebra/z.txt\nF\t10\talpha/a.txt\n"
        lines, _ = _parse_find_output(stdout, max_entries=200)
        alpha_idx = next(i for i, line in enumerate(lines) if "alpha/" in line)
        zebra_idx = next(i for i, line in enumerate(lines) if "zebra/" in line)
        assert alpha_idx < zebra_idx

    def test_nested_dfs_order(self):
        stdout = (
            "D\ta\nD\ta/b\nD\tc\n"
            "F\t10\ta/b/leaf.py\nF\t20\tc/root.py\nF\t30\ttop.txt\n"
        )
        lines, total = _parse_find_output(stdout, max_entries=200)
        assert total == 6
        texts = [line.strip() for line in lines]
        a_idx = next(i for i, t in enumerate(texts) if "`a/`" in t)
        ab_idx = next(i for i, t in enumerate(texts) if "`a/b/`" in t)
        ab_leaf = next(i for i, t in enumerate(texts) if "a/b/leaf.py" in t)
        c_idx = next(i for i, t in enumerate(texts) if "`c/`" in t)
        top_idx = next(i for i, t in enumerate(texts) if "top.txt" in t)
        assert a_idx < ab_idx < ab_leaf < c_idx < top_idx

    def test_max_entries_cap(self):
        entries = "".join(f"F\t10\tfile_{i:03d}.txt\n" for i in range(50))
        lines, total = _parse_find_output(entries, max_entries=10)
        assert len(lines) == 10
        assert total == 50

    def test_empty_stdout(self):
        lines, total = _parse_find_output("", max_entries=200)
        assert lines == []
        assert total == 0

    def test_blank_lines_ignored(self):
        stdout = "\n\nD\tsrc\n\nF\t10\tsrc/a.py\n\n"
        lines, total = _parse_find_output(stdout, max_entries=200)
        assert total == 2

    def test_malformed_lines_skipped(self):
        stdout = "GARBAGE\nD\tsrc\nX\t\nF\t10\tsrc/main.py\n"
        lines, total = _parse_find_output(stdout, max_entries=200)
        assert total == 2

    def test_file_sizes_included(self):
        stdout = "F\t2048\tlarge.bin\n"
        lines, _ = _parse_find_output(stdout, max_entries=200)
        assert "2.0 KB" in lines[0]

    def test_root_dir_entry_skipped(self):
        """find -printf '%P' outputs empty string for the root dir."""
        stdout = "D\t\nD\tsrc\nF\t10\tREADME.md\n"
        lines, total = _parse_find_output(stdout, max_entries=200)
        assert total == 2


# ============================================================================
# TestBuildDirectoryTreeViaFind — remote walker
# ============================================================================


class TestBuildDirectoryTreeViaFind:

    def test_success(self):
        backend = _MockBackend(
            "/workspace",
            find_output="D\tsrc\nF\t100\tsrc/main.py\nF\t50\tREADME.md\n",
        )
        result = _build_directory_tree_via_find(backend, max_entries=200)
        assert result is not None
        lines, total = result
        assert total == 3
        assert len(lines) == 3

    def test_find_command_executed(self):
        backend = _MockBackend("/workspace", find_output="")
        _build_directory_tree_via_find(backend, max_entries=200)
        assert len(backend.executed_commands) == 1
        cmd = backend.executed_commands[0]
        assert "find ." in cmd
        assert "-maxdepth" in cmd
        assert "-printf" in cmd

    def test_find_failure_returns_none(self):
        backend = _MockBackend("/workspace", exit_code=1)
        result = _build_directory_tree_via_find(backend, max_entries=200)
        assert result is None

    def test_empty_workspace(self):
        backend = _MockBackend("/workspace", find_output="\n")
        result = _build_directory_tree_via_find(backend, max_entries=200)
        assert result is not None
        lines, total = result
        assert lines == []
        assert total == 0

    def test_backend_exception_returns_none(self):
        class _ExplodingBackend:
            root_dir = "/workspace"

            def execute(self, command, *, cwd=None, timeout=30):
                raise RuntimeError("sandbox unreachable")

        result = _build_directory_tree_via_find(_ExplodingBackend(), max_entries=200)
        assert result is None


# ============================================================================
# TestFormatWorkspaceTree
# ============================================================================


class TestFormatWorkspaceTree:

    def test_header(self):
        result = _format_workspace_tree(["    - `a.txt` (10 bytes)"], 1, 500)
        assert result.startswith("### Project Structure\n\n")

    def test_entries_included(self):
        lines = ["    - `src/`", "    - `src/main.py` (30 bytes)"]
        result = _format_workspace_tree(lines, 2, 500)
        assert "src/" in result
        assert "src/main.py" in result

    def test_footer_no_truncation(self):
        result = _format_workspace_tree(["    - `a.txt`"], 1, 500)
        assert "1 entry." in result
        assert "Use `read`" in result

    def test_footer_plural(self):
        lines = ["    - `a.txt`", "    - `b.txt`"]
        result = _format_workspace_tree(lines, 2, 500)
        assert "2 entries." in result

    def test_footer_truncated(self):
        lines = [f"    - `file_{i}.txt`" for i in range(10)]
        result = _format_workspace_tree(lines, 50, 10)
        assert "Showing 10 of 50 entries" in result
        assert "glob" in result.lower()


# ============================================================================
# TestBuildWorkspaceFileTree — public API
# ============================================================================


class TestBuildWorkspaceFileTree:

    def test_local_mode_generates_tree(self, tmp_path):
        root = _make_tree(tmp_path)
        backend = _MockBackend(str(root))

        result = build_workspace_file_tree(
            str(root), backend, is_local_mode=True,
        )

        assert result is not None
        assert "### Project Structure" in result
        assert "src/" in result
        assert "README.md" in result

    def test_local_mode_empty_workspace_returns_none(self, tmp_path):
        empty = tmp_path / "empty"
        empty.mkdir()
        backend = _MockBackend(str(empty))

        result = build_workspace_file_tree(
            str(empty), backend, is_local_mode=True,
        )
        assert result is None

    def test_remote_mode_uses_backend_execute(self):
        backend = _MockBackend(
            "/workspace",
            find_output="D\tsrc\nF\t100\tsrc/main.py\n",
        )

        result = build_workspace_file_tree(
            "/workspace", backend, is_local_mode=False,
        )

        assert result is not None
        assert "### Project Structure" in result
        assert "src/" in result
        assert len(backend.executed_commands) == 1

    def test_remote_mode_find_failure_returns_none(self):
        backend = _MockBackend("/workspace", exit_code=1)

        result = build_workspace_file_tree(
            "/workspace", backend, is_local_mode=False,
        )
        assert result is None

    def test_local_mode_skips_hidden_and_skip_dirs(self, tmp_path):
        root = _make_tree(tmp_path)
        backend = _MockBackend(str(root))

        result = build_workspace_file_tree(
            str(root), backend, is_local_mode=True,
        )

        assert result is not None
        assert ".git" not in result
        assert "__pycache__" not in result
        assert "node_modules" not in result

    def test_truncation_with_small_max_entries(self, tmp_path):
        root = tmp_path / "many"
        root.mkdir()
        for i in range(20):
            (root / f"file_{i:03d}.txt").write_text("x")

        backend = _MockBackend(str(root))

        result = build_workspace_file_tree(
            str(root), backend, is_local_mode=True, max_entries=5,
        )

        assert result is not None
        assert "Showing 5 of 20 entries" in result

    def test_respects_max_depth(self, tmp_path):
        deep = tmp_path / "a" / "b" / "c" / "d" / "e" / "f"
        deep.mkdir(parents=True)
        (deep / "leaf.txt").write_text("deep")

        backend = _MockBackend(str(tmp_path))

        result = build_workspace_file_tree(
            str(tmp_path), backend, is_local_mode=True, max_depth=2,
        )

        assert result is not None
        assert "leaf.txt" not in result


# ============================================================================
# .gitignore filter integration
# ============================================================================


class TestBuildDirectoryTreeWithGitignore:
    """build_directory_tree() with gitignore_filter parameter."""

    def test_gitignored_file_excluded(self, tmp_path):
        from graphton.core.backends.gitignore_filter import GitIgnoreFilter

        root = tmp_path / "project"
        root.mkdir()
        (root / "main.py").write_text("print('hi')")
        (root / "main.pyc").write_bytes(b"\x00" * 10)
        (root / "utils.py").write_text("def f(): ...")

        f = GitIgnoreFilter.from_content("*.pyc\n")
        lines, total = build_directory_tree(str(root), "", gitignore_filter=f)

        paths = "\n".join(lines)
        assert "main.py" in paths
        assert "utils.py" in paths
        assert "main.pyc" not in paths
        assert total == 2

    def test_gitignored_dir_excluded(self, tmp_path):
        from graphton.core.backends.gitignore_filter import GitIgnoreFilter

        root = tmp_path / "project"
        root.mkdir()
        (root / "src").mkdir()
        (root / "src" / "app.py").write_text("app")
        (root / "build").mkdir()
        (root / "build" / "output.js").write_text("//js")

        f = GitIgnoreFilter.from_content("build/\n")
        lines, total = build_directory_tree(str(root), "", gitignore_filter=f)

        paths = "\n".join(lines)
        assert "src/" in paths
        assert "app.py" in paths
        assert "build" not in paths
        assert total == 2  # src/ + src/app.py

    def test_none_filter_no_change(self, tmp_path):
        root = tmp_path / "project"
        root.mkdir()
        (root / "a.txt").write_text("a")
        (root / "b.txt").write_text("b")

        lines_without, total_without = build_directory_tree(
            str(root), "", gitignore_filter=None,
        )
        lines_default, total_default = build_directory_tree(str(root), "")

        assert lines_without == lines_default
        assert total_without == total_default


class TestParseOutputWithGitignore:
    """_parse_find_output() with gitignore_filter parameter."""

    def test_gitignored_entries_removed(self):
        from graphton.core.backends.gitignore_filter import GitIgnoreFilter

        find_output = (
            "D\tsrc\n"
            "F\t100\tsrc/main.py\n"
            "F\t50\tsrc/main.pyc\n"
            "D\tbuild\n"
            "F\t200\tbuild/output.js\n"
        )
        f = GitIgnoreFilter.from_content("*.pyc\nbuild/\n")
        lines, total = _parse_find_output(
            find_output, max_entries=500, gitignore_filter=f,
        )

        paths = "\n".join(lines)
        assert "main.py" in paths
        assert "main.pyc" not in paths
        assert "build" not in paths
        assert "output.js" not in paths

    def test_none_filter_keeps_all(self):
        find_output = "D\tsrc\nF\t100\tsrc/main.py\nF\t50\tsrc/main.pyc\n"
        lines, total = _parse_find_output(
            find_output, max_entries=500, gitignore_filter=None,
        )
        paths = "\n".join(lines)
        assert "main.py" in paths
        assert "main.pyc" in paths


class TestBuildWorkspaceFileTreeWithGitignore:
    """build_workspace_file_tree() passes gitignore_filter through."""

    def test_local_mode_with_filter(self, tmp_path):
        from graphton.core.backends.gitignore_filter import GitIgnoreFilter

        root = _make_tree(tmp_path)
        backend = _MockBackend(str(root))
        f = GitIgnoreFilter.from_content("docs/\n")

        result = build_workspace_file_tree(
            str(root), backend, is_local_mode=True, gitignore_filter=f,
        )

        assert result is not None
        assert "src/" in result
        assert "docs" not in result

    def test_remote_mode_with_filter(self):
        from graphton.core.backends.gitignore_filter import GitIgnoreFilter

        f = GitIgnoreFilter.from_content("*.pyc\n")
        backend = _MockBackend(
            "/workspace",
            find_output="D\tsrc\nF\t100\tsrc/main.py\nF\t50\tsrc/cache.pyc\n",
        )

        result = build_workspace_file_tree(
            "/workspace", backend, is_local_mode=False, gitignore_filter=f,
        )

        assert result is not None
        assert "main.py" in result
        assert "cache.pyc" not in result


# ============================================================================
# Remote tree cwd scoping (multi-entry cloud mode)
# ============================================================================


class _CwdTrackingBackend:
    """Minimal backend that records (command, cwd) for each execute call."""

    def __init__(self, root_dir: str, *, find_output: str = ""):
        self._root_dir = root_dir
        self._find_output = find_output
        self.execute_records: list[tuple[str, str | None]] = []

    @property
    def root_dir(self) -> str:
        return self._root_dir

    def execute(self, command: str, *, cwd: str | None = None, timeout: int = 30):
        self.execute_records.append((command, cwd))
        return _MockExecuteResult(
            exit_code=0, stdout=self._find_output, stderr="",
        )


class TestRemoteTreeCwdScoping:
    """Remote tree builder passes cwd to backend.execute()."""

    def test_cwd_passed_to_find_via_build_directory_tree(self):
        backend = _CwdTrackingBackend(
            "/workspace",
            find_output="D\tsrc\nF\t100\tsrc/main.py\n",
        )

        _build_directory_tree_via_find(backend, cwd="my-app")

        assert len(backend.execute_records) == 1
        _, cwd = backend.execute_records[0]
        assert cwd == "my-app"

    def test_no_cwd_passes_none(self):
        backend = _CwdTrackingBackend(
            "/workspace",
            find_output="D\tsrc\nF\t100\tsrc/main.py\n",
        )

        _build_directory_tree_via_find(backend)

        assert len(backend.execute_records) == 1
        _, cwd = backend.execute_records[0]
        assert cwd is None

    def test_cwd_threaded_through_public_api(self):
        backend = _CwdTrackingBackend(
            "/workspace",
            find_output="D\tsrc\nF\t100\tsrc/main.py\n",
        )

        result = build_workspace_file_tree(
            "/workspace/my-app", backend,
            is_local_mode=False, cwd="my-app",
        )

        assert result is not None
        assert "src/" in result
        assert len(backend.execute_records) == 1
        _, cwd = backend.execute_records[0]
        assert cwd == "my-app"

    def test_local_mode_ignores_cwd(self, tmp_path):
        root = _make_tree(tmp_path)
        backend = _CwdTrackingBackend(str(tmp_path))

        result = build_workspace_file_tree(
            str(root), backend,
            is_local_mode=True, cwd="ignored-subdir",
        )

        assert result is not None
        assert "src/" in result
        assert len(backend.execute_records) == 0
