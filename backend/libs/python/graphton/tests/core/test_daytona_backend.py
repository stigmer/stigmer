"""Unit tests for WorkspaceNormalizingBackend.

Tests that the normalising wrapper correctly strips workspace-root prefixes
from paths before delegating to the inner backend, preventing the
double-prefix bug (e.g. /workspace/workspace/bin/skills/...).
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock

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
    """Create a WorkspaceNormalizingBackend wrapping the mock."""
    return WorkspaceNormalizingBackend(inner_backend, workspace_root="/workspace")


# ---------------------------------------------------------------------------
# Path normalisation
# ---------------------------------------------------------------------------

class TestNormalize:
    """Tests for the _normalize() path stripping logic."""

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

    def test_absolute_non_workspace_path_unchanged(self, wrapper: WorkspaceNormalizingBackend) -> None:
        # Absolute path that does NOT start with workspace root should pass through
        assert wrapper._normalize("/home/daytona/file.txt") == "/home/daytona/file.txt"

    def test_dot_path_unchanged(self, wrapper: WorkspaceNormalizingBackend) -> None:
        assert wrapper._normalize(".") == "."

    def test_empty_path_unchanged(self, wrapper: WorkspaceNormalizingBackend) -> None:
        assert wrapper._normalize("") == ""

    def test_partial_match_not_stripped(self, wrapper: WorkspaceNormalizingBackend) -> None:
        # "/workspace2/foo" should NOT be stripped (not a prefix match)
        assert wrapper._normalize("/workspace2/foo") == "/workspace2/foo"

    def test_custom_workspace_root(self, inner_backend: MagicMock) -> None:
        w = WorkspaceNormalizingBackend(inner_backend, "/home/daytona")
        assert w._normalize("/home/daytona/skills/a") == "skills/a"
        assert w._normalize("/workspace/skills/a") == "/workspace/skills/a"


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
