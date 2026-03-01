"""Unit tests for WorkspaceNormalizingBackend.

Tests that the normalising wrapper correctly:
1. Strips workspace-root prefixes from paths before delegating to the inner
   backend, preventing the double-prefix bug (e.g. /workspace/workspace/...).
2. Rebases paths when the agent workspace root is a subdirectory of the
   sandbox root (volume-mount scenario).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from graphton.core.backends.daytona import WorkspaceNormalizingBackend

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def inner_backend() -> MagicMock:
    """Create a mock inner backend (stands in for DaytonaBackend)."""
    backend = MagicMock()
    backend.read.return_value = "file content"
    backend.write.return_value = None
    backend.list_files.return_value = ["SKILL.md", "scripts"]
    return backend


@pytest.fixture
def wrapper(inner_backend: MagicMock) -> WorkspaceNormalizingBackend:
    """Create a WorkspaceNormalizingBackend wrapping the mock (no rebase)."""
    return WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")


@pytest.fixture
def rebase_wrapper(inner_backend: MagicMock) -> WorkspaceNormalizingBackend:
    """Create a WorkspaceNormalizingBackend with rebase (volume-mount scenario).

    workspace_root = /home/daytona/workspace  (volume mount)
    sandbox_root   = /home/daytona            (sandbox.get_work_dir())
    rebase_prefix  = "workspace"
    """
    return WorkspaceNormalizingBackend(
        inner_backend,
        workspace_root="/home/daytona/workspace",
        sandbox_root="/home/daytona",
    )


# ---------------------------------------------------------------------------
# Path normalisation (no rebase)
# ---------------------------------------------------------------------------

class TestNormalize:
    """Tests for the _normalize() path stripping logic without rebase."""

    def test_strips_workspace_prefix(self, wrapper: WorkspaceNormalizingBackend) -> None:
        assert wrapper._normalize("/workspace/bin/skills/a/SKILL.md") == "bin/skills/a/SKILL.md"

    def test_strips_workspace_prefix_trailing_slash(self) -> None:
        # workspace_root passed with trailing slash should still work
        w = WorkspaceNormalizingBackend(MagicMock(), "/workspace/")
        assert w._normalize("/workspace/bin/skills/a") == "bin/skills/a"

    def test_exact_workspace_root_returns_dot(self, wrapper: WorkspaceNormalizingBackend) -> None:
        assert wrapper._normalize("/workspace") == "."

    def test_relative_path_unchanged(self, wrapper: WorkspaceNormalizingBackend) -> None:
        assert wrapper._normalize("bin/skills/a/SKILL.md") == "bin/skills/a/SKILL.md"

    def test_absolute_non_workspace_path_stripped(self, wrapper: WorkspaceNormalizingBackend) -> None:
        # Defense-in-depth: leading "/" is always stripped so paths resolve
        # relative to the workspace root, not the filesystem root.
        assert wrapper._normalize("/home/daytona/file.txt") == "home/daytona/file.txt"

    def test_dot_path_unchanged(self, wrapper: WorkspaceNormalizingBackend) -> None:
        assert wrapper._normalize(".") == "."

    def test_empty_path_returns_dot(self, wrapper: WorkspaceNormalizingBackend) -> None:
        # Empty path normalises to "." (current directory)
        assert wrapper._normalize("") == "."

    def test_partial_match_not_stripped(self, wrapper: WorkspaceNormalizingBackend) -> None:
        # "/workspace2/foo" should NOT be prefix-stripped (not a prefix match),
        # but leading "/" is stripped by defense-in-depth.
        assert wrapper._normalize("/workspace2/foo") == "workspace2/foo"

    def test_custom_workspace_root(self, inner_backend: MagicMock) -> None:
        w = WorkspaceNormalizingBackend(inner_backend, "/home/daytona")
        assert w._normalize("/home/daytona/skills/a") == "skills/a"
        # Non-matching absolute path: leading "/" stripped by defense-in-depth
        assert w._normalize("/workspace/skills/a") == "workspace/skills/a"


# ---------------------------------------------------------------------------
# Path normalisation with rebase (volume-mount scenario)
# ---------------------------------------------------------------------------

class TestNormalizeRebase:
    """Tests for _normalize() with rebase prefix (workspace != sandbox root)."""

    def test_rebase_prefix_computed(self, rebase_wrapper: WorkspaceNormalizingBackend) -> None:
        assert rebase_wrapper._rebase_prefix == "workspace"

    def test_strips_workspace_prefix_and_rebases(
        self, rebase_wrapper: WorkspaceNormalizingBackend
    ) -> None:
        # Absolute agent path → strip workspace root → prepend rebase prefix
        result = rebase_wrapper._normalize(
            "/home/daytona/workspace/bin/skills/a/SKILL.md"
        )
        assert result == "workspace/bin/skills/a/SKILL.md"

    def test_exact_workspace_root_returns_rebase_prefix(
        self, rebase_wrapper: WorkspaceNormalizingBackend
    ) -> None:
        # Exact workspace root → empty relative → returns rebase prefix only
        assert rebase_wrapper._normalize("/home/daytona/workspace") == "workspace"

    def test_relative_path_rebased(self, rebase_wrapper: WorkspaceNormalizingBackend) -> None:
        # Workspace-relative paths get the rebase prefix prepended
        assert rebase_wrapper._normalize("bin/skills/a/SKILL.md") == "workspace/bin/skills/a/SKILL.md"

    def test_absolute_non_workspace_path_rebased(
        self, rebase_wrapper: WorkspaceNormalizingBackend
    ) -> None:
        # Leading "/" stripped, then rebase prefix prepended
        assert rebase_wrapper._normalize("/bin/skills/a/SKILL.md") == "workspace/bin/skills/a/SKILL.md"

    def test_dot_path_rebased(self, rebase_wrapper: WorkspaceNormalizingBackend) -> None:
        # "." → stripped to "." by lstrip → becomes "workspace/."
        assert rebase_wrapper._normalize(".") == "workspace/."

    def test_no_rebase_when_roots_match(self, inner_backend: MagicMock) -> None:
        """When sandbox_root == workspace_root, no rebase prefix is added."""
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
            sandbox_root="/workspace",
        )
        assert w._rebase_prefix == ""
        assert w._normalize("bin/skills/a/SKILL.md") == "bin/skills/a/SKILL.md"

    def test_no_rebase_when_sandbox_root_omitted(self, inner_backend: MagicMock) -> None:
        """When sandbox_root is None, defaults to workspace_root (no rebase)."""
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
            sandbox_root=None,
        )
        assert w._rebase_prefix == ""
        assert w._normalize("bin/skills/a/SKILL.md") == "bin/skills/a/SKILL.md"

    def test_no_rebase_when_workspace_not_under_sandbox(
        self, inner_backend: MagicMock
    ) -> None:
        """When workspace_root is NOT a subdirectory of sandbox_root, no rebase."""
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/opt/workspace",
            sandbox_root="/home/daytona",
        )
        assert w._rebase_prefix == ""

    def test_rebase_with_deep_subpath(self, inner_backend: MagicMock) -> None:
        """Rebase works with multi-level relative subpath."""
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/home/daytona/data/workspace",
            sandbox_root="/home/daytona",
        )
        assert w._rebase_prefix == "data/workspace"
        assert w._normalize("foo.txt") == "data/workspace/foo.txt"


# ---------------------------------------------------------------------------
# Delegation: file operations
# ---------------------------------------------------------------------------

class TestDelegation:
    """Tests that normalised paths are forwarded to the inner backend."""

    def test_read_normalises(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        wrapper.read("/workspace/bin/skills/a/SKILL.md")
        inner_backend.read.assert_called_once_with("bin/skills/a/SKILL.md")

    def test_read_file_normalises(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        wrapper.read_file("/workspace/data.txt")
        inner_backend.read_file.assert_called_once_with("data.txt")

    def test_write_normalises(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        wrapper.write("/workspace/output/result.txt", "hello")
        inner_backend.write.assert_called_once_with("output/result.txt", "hello")

    def test_write_file_normalises(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        wrapper.write_file("/workspace/output/result.txt", "hello")
        inner_backend.write_file.assert_called_once_with("output/result.txt", "hello")

    def test_list_files_normalises(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        wrapper.list_files("/workspace/bin/skills")
        inner_backend.list_files.assert_called_once_with("bin/skills")

    def test_list_files_default_dot(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        wrapper.list_files()
        inner_backend.list_files.assert_called_once_with(".")

    def test_execute_not_normalised(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        """execute() passes the command string through unchanged."""
        wrapper.execute("ls -la /workspace/bin/skills", timeout=10)
        inner_backend.execute.assert_called_once_with(
            "ls -la /workspace/bin/skills", timeout=10
        )

    def test_relative_path_passed_through(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        wrapper.read("bin/skills/a/SKILL.md")
        inner_backend.read.assert_called_once_with("bin/skills/a/SKILL.md")


class TestDelegationRebase:
    """Tests that rebased paths are forwarded correctly to the inner backend."""

    def test_read_rebases(
        self, rebase_wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        rebase_wrapper.read("/home/daytona/workspace/data.txt")
        inner_backend.read.assert_called_once_with("workspace/data.txt")

    def test_write_rebases_relative(
        self, rebase_wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        rebase_wrapper.write("output/result.txt", "hello")
        inner_backend.write.assert_called_once_with("workspace/output/result.txt", "hello")

    def test_list_files_rebases(
        self, rebase_wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        rebase_wrapper.list_files("bin/skills")
        inner_backend.list_files.assert_called_once_with("workspace/bin/skills")


# ---------------------------------------------------------------------------
# Transparent __getattr__ delegation
# ---------------------------------------------------------------------------

class TestGetattr:
    """Tests that unknown attributes are forwarded to the inner backend."""

    def test_unknown_attribute_delegated(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        inner_backend.some_custom_method.return_value = 42
        assert wrapper.some_custom_method() == 42
        inner_backend.some_custom_method.assert_called_once()

    def test_property_delegated(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        inner_backend.sandbox_id = "sandbox-123"
        assert wrapper.sandbox_id == "sandbox-123"


# ---------------------------------------------------------------------------
# .gitignore filtering
# ---------------------------------------------------------------------------

class TestGitignoreFiltering:
    """Lazy .gitignore loading and list_files() filtering."""

    def test_gitignore_loaded_lazily(self, inner_backend: MagicMock) -> None:
        inner_backend.read.return_value = "*.pyc\nbuild/\n"
        inner_backend.list_files.return_value = [
            "src", "build", "main.py", "cache.pyc",
        ]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        entries = w.list_files(".")
        assert "src" in entries
        assert "main.py" in entries
        assert "build" not in entries
        assert "cache.pyc" not in entries

    def test_gitignore_missing_no_filtering(self, inner_backend: MagicMock) -> None:
        inner_backend.read.side_effect = FileNotFoundError(".gitignore not found")
        inner_backend.list_files.return_value = ["src", "build", "cache.pyc"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        entries = w.list_files(".")
        assert entries == ["src", "build", "cache.pyc"]

    def test_gitignore_read_error_graceful(self, inner_backend: MagicMock) -> None:
        inner_backend.read.side_effect = RuntimeError("sandbox down")
        inner_backend.list_files.return_value = ["src", "build"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        entries = w.list_files(".")
        assert entries == ["src", "build"]

    def test_subdir_path_filtering(self, inner_backend: MagicMock) -> None:
        inner_backend.read.return_value = "*.pyc\n"
        inner_backend.list_files.return_value = ["main.py", "main.pyc", "utils.py"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        entries = w.list_files("src")
        assert "main.py" in entries
        assert "utils.py" in entries
        assert "main.pyc" not in entries

    def test_gitignore_cached_across_calls(self, inner_backend: MagicMock) -> None:
        inner_backend.read.return_value = "*.log\n"
        inner_backend.list_files.return_value = ["app.log", "main.py"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        w.list_files(".")
        w.list_files(".")
        # .gitignore should be read only once (the first list_files call)
        inner_backend.read.assert_called_once()

    def test_workspace_relative_strips_prefix(self) -> None:
        inner = MagicMock()
        inner.read.return_value = "*.log\n"
        inner.list_files.return_value = ["debug.log", "main.py"]
        w = WorkspaceNormalizingBackend(inner, workspace_root="/workspace")
        entries = w.list_files("/workspace/src")
        assert "main.py" in entries
        assert "debug.log" not in entries

    def test_rebase_wrapper_gitignore(self, inner_backend: MagicMock) -> None:
        inner_backend.read.return_value = "dist/\n"
        inner_backend.list_files.return_value = ["src", "dist", "README.md"]
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        entries = w.list_files(".")
        assert "src" in entries
        assert "README.md" in entries
        assert "dist" not in entries


# ---------------------------------------------------------------------------
# Directory cache (T03)
# ---------------------------------------------------------------------------


class TestDirectoryCache:
    """list_files() and is_directory() caching with invalidation."""

    def test_list_files_cache_hit(self, inner_backend: MagicMock) -> None:
        """Second list_files() call uses the cache, not the inner backend."""
        inner_backend.read.side_effect = FileNotFoundError
        inner_backend.list_files.return_value = ["src", "README.md"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        first = w.list_files(".")
        second = w.list_files(".")
        assert sorted(first) == sorted(second)
        inner_backend.list_files.assert_called_once()

    def test_list_files_returns_copy(self, inner_backend: MagicMock) -> None:
        """Caller cannot corrupt the cache by mutating the returned list."""
        inner_backend.read.side_effect = FileNotFoundError
        inner_backend.list_files.return_value = ["src"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        first = w.list_files(".")
        first.append("INJECTED")
        second = w.list_files(".")
        assert "INJECTED" not in second

    def test_is_directory_cache_hit(self, inner_backend: MagicMock) -> None:
        """Second is_directory() call uses the cache, not the inner backend."""
        inner_backend.is_directory.return_value = True
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        assert w.is_directory("src") is True
        assert w.is_directory("src") is True
        inner_backend.is_directory.assert_called_once()

    def test_write_invalidates_cache(self, inner_backend: MagicMock) -> None:
        inner_backend.read.side_effect = FileNotFoundError
        inner_backend.list_files.return_value = ["src"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        w.list_files(".")
        assert inner_backend.list_files.call_count == 1

        w.write("new.py", "x")
        w.list_files(".")
        assert inner_backend.list_files.call_count == 2

    def test_write_file_invalidates_cache(self, inner_backend: MagicMock) -> None:
        inner_backend.read.side_effect = FileNotFoundError
        inner_backend.list_files.return_value = ["src"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        w.list_files(".")
        w.write_file("new.py", "x")
        w.list_files(".")
        assert inner_backend.list_files.call_count == 2

    def test_execute_invalidates_cache(self, inner_backend: MagicMock) -> None:
        inner_backend.read.side_effect = FileNotFoundError
        inner_backend.list_files.return_value = ["src"]
        inner_backend.execute.return_value = None
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        w.list_files(".")
        w.execute("touch new.txt")
        w.list_files(".")
        assert inner_backend.list_files.call_count == 2

    def test_gitignore_filtering_with_cache(self, inner_backend: MagicMock) -> None:
        """Gitignore filtering is applied before caching, so cached results are filtered."""
        inner_backend.read.return_value = "*.pyc\n"
        inner_backend.list_files.return_value = ["main.py", "main.pyc", "utils.py"]
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        first = w.list_files("src")
        assert "main.py" in first
        assert "main.pyc" not in first

        second = w.list_files("src")
        assert sorted(first) == sorted(second)
        inner_backend.list_files.assert_called_once()

    def test_rebase_wrapper_cache(self, inner_backend: MagicMock) -> None:
        """Cache works correctly with rebase prefix normalisation."""
        inner_backend.read.side_effect = FileNotFoundError
        inner_backend.list_files.return_value = ["SKILL.md", "scripts"]
        inner_backend.is_directory.return_value = True
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )

        w.list_files("bin/skills")
        w.list_files("bin/skills")
        inner_backend.list_files.assert_called_once_with("workspace/bin/skills")

        assert w.is_directory("bin/skills") is True
        assert w.is_directory("bin/skills") is True
        inner_backend.is_directory.assert_called_once()

    def test_is_directory_invalidated_by_write(
        self, inner_backend: MagicMock,
    ) -> None:
        inner_backend.is_directory.return_value = False
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")

        assert w.is_directory("new_dir") is False
        assert inner_backend.is_directory.call_count == 1

        inner_backend.is_directory.return_value = True
        w.write("new_dir/file.txt", "x")
        assert w.is_directory("new_dir") is True
        assert inner_backend.is_directory.call_count == 2
