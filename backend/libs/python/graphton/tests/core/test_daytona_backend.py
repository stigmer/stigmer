"""Unit tests for WorkspaceNormalizingBackend and execution result translation.

Tests that the normalising wrapper correctly:
1. Strips workspace-root prefixes from paths before delegating to the inner
   backend, preventing the double-prefix bug (e.g. /workspace/workspace/...).
2. Rebases paths when the agent workspace root is a subdirectory of the
   sandbox root (volume-mount scenario).
3. Translates inner-backend execution responses into graphton's canonical
   ``ExecutionResult`` type (fixes the ``'ExecuteResponse' object has no
   attribute 'stdout'`` crash).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

import pytest

from graphton.core.backends.daytona import WorkspaceNormalizingBackend
from graphton.core.backends.types import (
    ExecutionResult,
    to_execution_result,
    to_file_list,
    to_is_directory,
)

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
        """write_file delegates to write (which handles overwrite semantics)."""
        wrapper.write_file("/workspace/output/result.txt", "hello")
        inner_backend.write.assert_called_once_with("output/result.txt", "hello")

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

    def test_execute_prepends_cd_to_workspace_root(
        self, wrapper: WorkspaceNormalizingBackend, inner_backend: MagicMock
    ) -> None:
        """execute() prepends ``cd <workspace_root> &&`` so commands run
        from the workspace root, not the sandbox root."""
        wrapper.execute("ls -la /workspace/bin/skills", timeout=10)
        inner_backend.execute.assert_called_once_with(
            "cd /workspace && ls -la /workspace/bin/skills", timeout=10
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


# ---------------------------------------------------------------------------
# to_execution_result() normalisation
# ---------------------------------------------------------------------------


@dataclass
class _FakeExecuteResponse:
    """Mimics deepagents' ExecuteResponse (has .output, no .stdout/.stderr)."""

    output: str
    exit_code: int
    truncated: bool = False


class TestToExecutionResult:
    """Tests for the to_execution_result() normalisation helper."""

    def test_passthrough_execution_result(self) -> None:
        original = ExecutionResult(exit_code=0, stdout="hello", stderr="")
        result = to_execution_result(original)
        assert result is original

    def test_translates_execute_response_output(self) -> None:
        raw = _FakeExecuteResponse(output="listing\nfiles", exit_code=0)
        result = to_execution_result(raw)
        assert isinstance(result, ExecutionResult)
        assert result.stdout == "listing\nfiles"
        assert result.stderr == ""
        assert result.exit_code == 0

    def test_translates_execute_response_failure(self) -> None:
        raw = _FakeExecuteResponse(output="not found", exit_code=127)
        result = to_execution_result(raw)
        assert result.exit_code == 127
        assert result.stdout == "not found"

    def test_prefers_stdout_over_output(self) -> None:
        raw = MagicMock()
        raw.stdout = "real stdout"
        raw.stderr = "real stderr"
        raw.output = "combined"
        raw.exit_code = 0
        result = to_execution_result(raw)
        assert result.stdout == "real stdout"
        assert result.stderr == "real stderr"

    def test_falls_back_to_output_when_stdout_empty(self) -> None:
        raw = MagicMock()
        raw.stdout = ""
        raw.stderr = ""
        raw.output = "combined output"
        raw.exit_code = 0
        result = to_execution_result(raw)
        assert result.stdout == "combined output"

    def test_handles_none_exit_code(self) -> None:
        raw = _FakeExecuteResponse(output="ok", exit_code=None)  # type: ignore[arg-type]
        result = to_execution_result(raw)
        assert result.exit_code == 0

    def test_handles_minimal_object(self) -> None:
        raw = MagicMock(spec=[])
        result = to_execution_result(raw)
        assert result.exit_code == 1  # unknown exit code defaults to failure
        assert result.stdout == ""
        assert result.stderr == ""


# ---------------------------------------------------------------------------
# WorkspaceNormalizingBackend.execute() result translation
# ---------------------------------------------------------------------------


class TestExecuteResultTranslation:
    """Tests that execute() translates inner-backend responses to ExecutionResult."""

    def test_translates_execute_response_to_execution_result(
        self, inner_backend: MagicMock,
    ) -> None:
        """Inner backend returning ExecuteResponse-like object is normalised."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="drwxr-xr-x 5 user staff", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        result = w.execute("ls -la")
        assert isinstance(result, ExecutionResult)
        assert result.stdout == "drwxr-xr-x 5 user staff"
        assert result.stderr == ""
        assert result.exit_code == 0

    def test_passes_through_execution_result(
        self, inner_backend: MagicMock,
    ) -> None:
        """Inner backend returning ExecutionResult is passed through."""
        inner_result = ExecutionResult(exit_code=0, stdout="ok", stderr="")
        inner_backend.execute.return_value = inner_result
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        result = w.execute("echo ok")
        assert result is inner_result

    def test_translates_failure_response(
        self, inner_backend: MagicMock,
    ) -> None:
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="command not found", exit_code=127,
        )
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        result = w.execute("nonexistent")
        assert result.exit_code == 127
        assert result.stdout == "command not found"

    def test_env_vars_injected_before_translation(
        self, inner_backend: MagicMock,
    ) -> None:
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="token=secret", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
            env_vars={"TOKEN": "secret"},
        )
        result = w.execute("echo $TOKEN")
        assert isinstance(result, ExecutionResult)
        call_args = inner_backend.execute.call_args[0][0]
        assert "export TOKEN=" in call_args


# ---------------------------------------------------------------------------
# execute() cd-preamble behaviour
# ---------------------------------------------------------------------------


class TestExecuteCwd:
    """Verify that execute() prepends ``cd <workspace_root> &&``."""

    def test_cd_targets_workspace_root_with_rebase(
        self, inner_backend: MagicMock,
    ) -> None:
        """With rebase (sandbox_root != workspace_root), the cd must
        target the *workspace* root, not the sandbox root."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="/home/daytona/workspace", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        w.execute("pwd")
        call_args = inner_backend.execute.call_args[0][0]
        assert call_args == "cd /home/daytona/workspace && pwd"

    def test_cd_before_user_command_after_exports(
        self, inner_backend: MagicMock,
    ) -> None:
        """Shell shape must be: ``export ...; cd ... && <command>``."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
            env_vars={"TOKEN": "secret"},
        )
        w.execute("echo $TOKEN")
        call_args = inner_backend.execute.call_args[0][0]
        assert call_args == (
            "export TOKEN=secret; "
            "cd /home/daytona/workspace && echo $TOKEN"
        )

    def test_platform_resolution_before_cd_wrapping(
        self, inner_backend: MagicMock,
    ) -> None:
        """resolve_platform_command() must run on the raw user command
        before the cd preamble wraps it."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
            env_vars={"STIGMER_PLATFORM_DIR": "/opt/platform"},
        )
        w.execute("python3 .stigmer/skills/init_skill.py")
        call_args = inner_backend.execute.call_args[0][0]
        assert ".stigmer" not in call_args
        assert "$STIGMER_PLATFORM_DIR/skills/init_skill.py" in call_args
        assert "cd /workspace &&" in call_args

    def test_cd_without_env_vars(self, inner_backend: MagicMock) -> None:
        """Without env_vars, the command is just ``cd ... && <command>``."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend, workspace_root="/workspace",
        )
        w.execute("ls -la")
        call_args = inner_backend.execute.call_args[0][0]
        assert call_args == "cd /workspace && ls -la"

    def test_kwargs_forwarded(self, inner_backend: MagicMock) -> None:
        """Extra kwargs (e.g. timeout) must be forwarded to the inner."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend, workspace_root="/workspace",
        )
        w.execute("sleep 5", timeout=60)
        inner_backend.execute.assert_called_once_with(
            "cd /workspace && sleep 5", timeout=60,
        )


# ---------------------------------------------------------------------------
# execute_streaming() cd-preamble behaviour
# ---------------------------------------------------------------------------


class TestExecuteStreamingCwd:
    """Verify that execute_streaming() applies the same cd preamble as
    execute(), preventing the __getattr__ bypass."""

    @pytest.mark.asyncio
    async def test_streaming_applies_cd_preamble(
        self, inner_backend: MagicMock,
    ) -> None:
        """execute_streaming() must prepend cd to workspace root."""
        async def fake_streaming(cmd: str, **kwargs: Any) -> _FakeExecuteResponse:
            return _FakeExecuteResponse(output="ok", exit_code=0)

        inner_backend.execute_streaming = fake_streaming
        w = WorkspaceNormalizingBackend(
            inner_backend, workspace_root="/workspace",
        )
        chunks: list[str] = []
        result = await w.execute_streaming(
            "pwd", timeout=30, on_chunk=chunks.append,
        )
        assert isinstance(result, ExecutionResult)

    @pytest.mark.asyncio
    async def test_streaming_cd_with_rebase_and_env(
        self, inner_backend: MagicMock,
    ) -> None:
        """Streaming must apply cd, env exports, and platform resolution."""
        captured_cmd: list[str] = []

        async def fake_streaming(cmd: str, **kwargs: Any) -> _FakeExecuteResponse:
            captured_cmd.append(cmd)
            return _FakeExecuteResponse(output="ok", exit_code=0)

        inner_backend.execute_streaming = fake_streaming
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
            env_vars={"TOKEN": "abc"},
        )
        await w.execute_streaming("echo hi")
        assert captured_cmd
        assert captured_cmd[0] == (
            "export TOKEN=abc; "
            "cd /home/daytona/workspace && echo hi"
        )

    @pytest.mark.asyncio
    async def test_streaming_falls_back_to_sync_execute(
        self, inner_backend: MagicMock,
    ) -> None:
        """When the inner backend has no execute_streaming, fall back to
        the sync execute() path via asyncio.to_thread."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="sync fallback", exit_code=0,
        )
        # Ensure no execute_streaming on inner
        if hasattr(inner_backend, "execute_streaming"):
            del inner_backend.execute_streaming
        w = WorkspaceNormalizingBackend(
            inner_backend, workspace_root="/workspace",
        )
        result = await w.execute_streaming("pwd")
        assert isinstance(result, ExecutionResult)
        assert result.stdout == "sync fallback"

    def test_execute_streaming_not_leaked_via_getattr(
        self, inner_backend: MagicMock,
    ) -> None:
        """The wrapper's own execute_streaming must shadow the inner's,
        so __getattr__ never exposes the inner's raw method."""
        async def raw_inner_streaming(cmd: str, **kwargs: Any) -> None:
            pass

        inner_backend.execute_streaming = raw_inner_streaming
        w = WorkspaceNormalizingBackend(
            inner_backend, workspace_root="/workspace",
        )
        method = getattr(w, "execute_streaming", None)
        assert method is not None
        # Must be the wrapper's method, not the inner backend's
        assert method != raw_inner_streaming
        assert hasattr(method, "__self__") and method.__self__ is w


# ---------------------------------------------------------------------------
# Write overwrite semantics (Bug 1 fix)
# ---------------------------------------------------------------------------


class TestWriteOverwrite:
    """Verify that write() handles inner backends that return WriteResult
    with error fields (create-only semantics like DaytonaBackend)."""

    def test_write_succeeds_when_no_error(self, inner_backend: MagicMock) -> None:
        inner_backend.write.return_value = None
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        w.write("file.txt", "content")
        inner_backend.write.assert_called_once_with("file.txt", "content")

    def test_write_retries_on_already_exists(self, inner_backend: MagicMock) -> None:
        """When the inner backend returns 'already exists', write should
        delete the file and retry."""
        write_result_error = MagicMock()
        write_result_error.error = "Error: File 'file.txt' already exists"
        write_result_ok = MagicMock()
        write_result_ok.error = None

        inner_backend.write.side_effect = [write_result_error, write_result_ok]
        inner_backend.execute.return_value = MagicMock(exit_code=0)

        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        w.write("file.txt", "new content")

        assert inner_backend.write.call_count == 2
        inner_backend.execute.assert_called_once()
        rm_cmd = inner_backend.execute.call_args[0][0]
        assert "rm -f" in rm_cmd
        assert "file.txt" in rm_cmd

    def test_write_raises_on_persistent_error(self, inner_backend: MagicMock) -> None:
        """When the retry also fails, write should raise RuntimeError."""
        write_result = MagicMock()
        write_result.error = "Error: File 'file.txt' already exists"

        inner_backend.write.return_value = write_result
        inner_backend.execute.return_value = MagicMock(exit_code=0)

        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        with pytest.raises(RuntimeError, match="Failed to write"):
            w.write("file.txt", "content")

    def test_write_raises_on_non_exists_error(self, inner_backend: MagicMock) -> None:
        """Non 'already exists' errors should raise immediately."""
        write_result = MagicMock()
        write_result.error = "Permission denied"

        inner_backend.write.return_value = write_result

        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        with pytest.raises(RuntimeError, match="Permission denied"):
            w.write("file.txt", "content")

    def test_write_file_delegates_to_write(self, inner_backend: MagicMock) -> None:
        """write_file should use write() to get overwrite semantics."""
        inner_backend.write.return_value = None
        w = WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")
        w.write_file("file.txt", "content")
        inner_backend.write.assert_called_once_with("file.txt", "content")


# ---------------------------------------------------------------------------
# .stigmer/ resolution in execute (Bug 3 fix)
# ---------------------------------------------------------------------------


class TestResolvePlatformCommand:
    """Verify that .stigmer/ paths are resolved to $STIGMER_PLATFORM_DIR
    in execute() when the env var is configured."""

    def test_stigmer_path_resolved_when_env_present(
        self, inner_backend: MagicMock,
    ) -> None:
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
            env_vars={"STIGMER_PLATFORM_DIR": "/opt/platform"},
        )
        w.execute("python3 .stigmer/skills/init_skill.py")
        call_args = inner_backend.execute.call_args[0][0]
        assert ".stigmer" not in call_args
        assert "$STIGMER_PLATFORM_DIR" in call_args

    def test_stigmer_path_not_resolved_without_env(
        self, inner_backend: MagicMock,
    ) -> None:
        """When STIGMER_PLATFORM_DIR is not in env_vars, .stigmer/
        should pass through unchanged."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
            env_vars={"OTHER_VAR": "value"},
        )
        w.execute("cat .stigmer/config.yaml")
        call_args = inner_backend.execute.call_args[0][0]
        assert ".stigmer" in call_args

    def test_stigmer_path_not_resolved_without_any_env(
        self, inner_backend: MagicMock,
    ) -> None:
        """When no env_vars at all, .stigmer/ should pass through."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
        )
        w.execute("cat .stigmer/config.yaml")
        call_args = inner_backend.execute.call_args[0][0]
        assert ".stigmer" in call_args

    def test_resolution_and_env_export_combined(
        self, inner_backend: MagicMock,
    ) -> None:
        """Both resolution and env var export should work together."""
        inner_backend.execute.return_value = _FakeExecuteResponse(
            output="ok", exit_code=0,
        )
        w = WorkspaceNormalizingBackend(
            inner_backend,
            workspace_root="/workspace",
            env_vars={
                "STIGMER_PLATFORM_DIR": "/opt/platform",
                "TOKEN": "secret",
            },
        )
        w.execute("python3 .stigmer/skills/init_skill.py")
        call_args = inner_backend.execute.call_args[0][0]
        assert "$STIGMER_PLATFORM_DIR" in call_args
        assert "export STIGMER_PLATFORM_DIR=" in call_args
        assert "export TOKEN=" in call_args


# ---------------------------------------------------------------------------
# to_file_list() normalisation
# ---------------------------------------------------------------------------


@dataclass
class _FakeFileInfo:
    """Mimics deepagents' FileInfo (dataclass with .path and .is_dir)."""

    path: str
    is_dir: bool = False


class TestToFileList:
    """Tests for the to_file_list() normalisation helper."""

    def test_prefers_list_files_over_ls_info(self) -> None:
        """When the backend has both methods, list_files() takes precedence."""
        inner = MagicMock()
        inner.list_files.return_value = ["src", "README.md"]
        inner.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
            _FakeFileInfo(path="README.md"),
        ]
        result = to_file_list(inner, ".")
        assert result == ["src", "README.md"]
        inner.list_files.assert_called_once_with(".")
        inner.ls_info.assert_not_called()

    def test_falls_back_to_ls_info_object_style(self) -> None:
        """Backend with only ls_info (dataclass FileInfo) works correctly."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
            _FakeFileInfo(path="README.md"),
            _FakeFileInfo(path="main.py"),
        ]
        result = to_file_list(inner, ".")
        assert result == ["src", "README.md", "main.py"]

    def test_falls_back_to_ls_info_dict_style(self) -> None:
        """Backend with only ls_info (dict FileInfo) works correctly."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.return_value = [
            {"path": "src", "is_dir": True},
            {"path": "README.md", "is_dir": False},
        ]
        result = to_file_list(inner, ".")
        assert result == ["src", "README.md"]

    def test_ls_info_extracts_basename_from_full_path(self) -> None:
        """ls_info returning full relative paths still yields bare names."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.return_value = [
            _FakeFileInfo(path="project/src", is_dir=True),
            _FakeFileInfo(path="project/README.md"),
        ]
        result = to_file_list(inner, "project")
        assert result == ["src", "README.md"]

    def test_raises_when_neither_method_available(self) -> None:
        """Clean error when the backend has neither list_files nor ls_info."""
        inner = MagicMock(spec=[])
        with pytest.raises(AttributeError, match="neither list_files.*nor ls_info"):
            to_file_list(inner, ".")


# ---------------------------------------------------------------------------
# to_is_directory() normalisation
# ---------------------------------------------------------------------------


class TestToIsDirectory:
    """Tests for the to_is_directory() normalisation helper."""

    def test_prefers_is_directory_over_ls_info(self) -> None:
        inner = MagicMock()
        inner.is_directory.return_value = True
        result = to_is_directory(inner, "src")
        assert result is True
        inner.is_directory.assert_called_once_with("src")

    def test_falls_back_to_ls_info_object_style(self) -> None:
        """Backend with only ls_info correctly detects directories."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
            _FakeFileInfo(path="README.md", is_dir=False),
        ]
        assert to_is_directory(inner, "src") is True
        assert to_is_directory(inner, "README.md") is False

    def test_falls_back_to_ls_info_dict_style(self) -> None:
        """Backend with only ls_info (dict FileInfo) correctly detects directories."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.return_value = [
            {"path": "data", "is_dir": True},
            {"path": "config.yaml", "is_dir": False},
        ]
        assert to_is_directory(inner, "data") is True
        assert to_is_directory(inner, "config.yaml") is False

    def test_returns_false_for_unknown_entry(self) -> None:
        """Returns False when the entry is not found in parent listing."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
        ]
        assert to_is_directory(inner, "nonexistent") is False

    def test_returns_false_when_neither_method_available(self) -> None:
        """Returns False (defensive) when backend has no useful method."""
        inner = MagicMock(spec=[])
        assert to_is_directory(inner, "anything") is False

    def test_returns_false_when_ls_info_raises(self) -> None:
        """ls_info errors are swallowed; returns False defensively."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.side_effect = RuntimeError("sandbox down")
        assert to_is_directory(inner, "src") is False

    def test_uses_parent_directory_for_ls_info(self) -> None:
        """ls_info is called on the *parent* of the target path."""
        inner = MagicMock(spec=["ls_info"])
        inner.ls_info.return_value = [
            _FakeFileInfo(path="scripts", is_dir=True),
        ]
        to_is_directory(inner, "bin/scripts")
        inner.ls_info.assert_called_once_with("bin")


# ---------------------------------------------------------------------------
# WorkspaceNormalizingBackend with ls_info-only backend (real DaytonaBackend)
# ---------------------------------------------------------------------------


@pytest.fixture
def ls_info_backend() -> MagicMock:
    """Mock backend that has ls_info but NOT list_files/is_directory.

    This simulates the real DaytonaBackend from deepagents_cli which
    implements SandboxBackendProtocol (ls_info) not graphton's interface.
    """
    backend = MagicMock(spec=["ls_info", "read", "write", "execute"])
    backend.read.return_value = ""
    return backend


class TestWorkspaceNormalizingWithLsInfoBackend:
    """Integration tests: WorkspaceNormalizingBackend over an ls_info-only backend."""

    def test_list_files_works_via_ls_info(
        self, ls_info_backend: MagicMock,
    ) -> None:
        ls_info_backend.ls_info.return_value = [
            _FakeFileInfo(path="SKILL.md", is_dir=False),
            _FakeFileInfo(path="scripts", is_dir=True),
        ]
        ls_info_backend.read.side_effect = FileNotFoundError
        w = WorkspaceNormalizingBackend(ls_info_backend, workspace_root="/workspace")
        entries = w.list_files("bin/skills")
        assert "SKILL.md" in entries
        assert "scripts" in entries
        ls_info_backend.ls_info.assert_called_once_with("bin/skills")

    def test_list_files_with_rebase_via_ls_info(
        self, ls_info_backend: MagicMock,
    ) -> None:
        ls_info_backend.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
        ]
        ls_info_backend.read.side_effect = FileNotFoundError
        w = WorkspaceNormalizingBackend(
            ls_info_backend,
            workspace_root="/home/daytona/workspace",
            sandbox_root="/home/daytona",
        )
        entries = w.list_files("project")
        assert entries == ["src"]
        ls_info_backend.ls_info.assert_called_once_with("workspace/project")

    def test_is_directory_works_via_ls_info(
        self, ls_info_backend: MagicMock,
    ) -> None:
        ls_info_backend.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
            _FakeFileInfo(path="README.md", is_dir=False),
        ]
        w = WorkspaceNormalizingBackend(ls_info_backend, workspace_root="/workspace")
        assert w.is_directory("src") is True
        assert w.is_directory("README.md") is False

    def test_list_files_gitignore_filtering_with_ls_info(
        self, ls_info_backend: MagicMock,
    ) -> None:
        """Gitignore filtering works correctly over ls_info backend."""
        ls_info_backend.read.return_value = "*.pyc\nbuild/\n"
        ls_info_backend.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
            _FakeFileInfo(path="build", is_dir=True),
            _FakeFileInfo(path="main.py", is_dir=False),
            _FakeFileInfo(path="cache.pyc", is_dir=False),
        ]
        w = WorkspaceNormalizingBackend(ls_info_backend, workspace_root="/workspace")
        entries = w.list_files(".")
        assert "src" in entries
        assert "main.py" in entries
        assert "build" not in entries
        assert "cache.pyc" not in entries

    def test_list_files_cache_with_ls_info(
        self, ls_info_backend: MagicMock,
    ) -> None:
        """Caching works correctly when backed by ls_info."""
        ls_info_backend.read.side_effect = FileNotFoundError
        ls_info_backend.ls_info.return_value = [
            _FakeFileInfo(path="src", is_dir=True),
        ]
        w = WorkspaceNormalizingBackend(ls_info_backend, workspace_root="/workspace")
        first = w.list_files(".")
        second = w.list_files(".")
        assert first == second
        ls_info_backend.ls_info.assert_called_once()
