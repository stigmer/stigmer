"""Tests for execute-based fast paths in DeepAgentsBackendAdapter.

When the inner backend supports ``execute()``, the adapter's
``grep_raw()``, ``glob_info()``, and ``ls_info()`` methods delegate to
native shell commands via a single ``execute()`` call instead of
making per-entry ``list_files()`` + ``is_directory()`` + ``read()``
HTTP calls.

These tests verify:
1. The fast path produces correct results.
2. The walk-based fallback is used when ``execute()`` is absent.
3. Edge cases (no matches, invalid regex) are handled.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from graphton.core.backends.deepagents_adapter import DeepAgentsBackendAdapter
from graphton.core.backends.filesystem import FilesystemBackend

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sandbox(tmp_path: Path) -> FilesystemBackend:
    sb = FilesystemBackend(root_dir=tmp_path)
    sb.write("code.py", "def hello():\n    return 42\ndef world():\n    pass")
    sb.write("lib.py", "class MyLib:\n    pass")
    sb.write("readme.txt", "This is a readme")
    sb.write("sub/nested.py", "def nested():\n    pass")
    return sb


@pytest.fixture
def adapter(sandbox: FilesystemBackend) -> DeepAgentsBackendAdapter:
    return DeepAgentsBackendAdapter(sandbox)


class _NoExecuteBackend:
    """Backend wrapping FilesystemBackend but without execute()."""

    def __init__(self, fs: FilesystemBackend) -> None:
        self._fs = fs

    def list_files(self, path: str = ".") -> list[str]:
        return self._fs.list_files(path)

    def is_directory(self, path: str) -> bool:
        return self._fs.is_directory(path)

    def read(self, path: str) -> str:
        return self._fs.read(path)


# =============================================================================
# grep_raw — fast path
# =============================================================================


class TestGrepRawFastPath:
    def test_finds_matches_via_execute(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend,
    ) -> None:
        matches = adapter.grep_raw("def ")
        assert isinstance(matches, list)
        assert len(matches) >= 3
        texts = [m["text"] for m in matches]
        assert any("def hello" in t for t in texts)
        assert any("def world" in t for t in texts)
        assert any("def nested" in t for t in texts)

    def test_respects_glob_filter(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend,
    ) -> None:
        matches = adapter.grep_raw("def ", glob="*.py")
        assert isinstance(matches, list)
        assert len(matches) >= 3

    def test_no_matches_returns_empty(
        self, adapter: DeepAgentsBackendAdapter,
    ) -> None:
        matches = adapter.grep_raw("nonexistent_xyz_123")
        assert isinstance(matches, list)
        assert len(matches) == 0

    def test_invalid_regex_returns_error_string(
        self, adapter: DeepAgentsBackendAdapter,
    ) -> None:
        result = adapter.grep_raw("[invalid")
        assert isinstance(result, str)
        assert "Invalid" in result

    def test_match_has_path_line_text(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend,
    ) -> None:
        matches = adapter.grep_raw("class ")
        assert len(matches) >= 1
        m = matches[0]
        assert "path" in m
        assert "line" in m
        assert "text" in m
        assert isinstance(m["line"], int)


# =============================================================================
# grep_raw — fallback path
# =============================================================================


class TestGrepRawFallback:
    def test_finds_matches_without_execute(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        adapter = DeepAgentsBackendAdapter(no_exec)
        matches = adapter.grep_raw("def ")
        assert isinstance(matches, list)
        assert len(matches) >= 3


# =============================================================================
# glob_info — fast path
# =============================================================================


class TestGlobInfoFastPath:
    def test_finds_python_files(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend,
    ) -> None:
        matches = adapter.glob_info("*.py")
        paths = [m["path"] for m in matches]
        assert any("code.py" in p for p in paths)
        assert any("lib.py" in p for p in paths)
        assert not any("readme.txt" in p for p in paths)

    def test_finds_nested_files(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend,
    ) -> None:
        matches = adapter.glob_info("*.py")
        paths = [m["path"] for m in matches]
        assert any("nested.py" in p for p in paths)

    def test_no_matches_returns_empty(
        self, adapter: DeepAgentsBackendAdapter,
    ) -> None:
        matches = adapter.glob_info("*.rs")
        assert isinstance(matches, list)
        assert len(matches) == 0

    def test_result_has_path_and_is_dir(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend,
    ) -> None:
        matches = adapter.glob_info("*.py")
        assert len(matches) >= 1
        m = matches[0]
        assert "path" in m
        assert "is_dir" in m


# =============================================================================
# glob_info — fallback path
# =============================================================================


class TestGlobInfoFallback:
    def test_finds_files_without_execute(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        adapter = DeepAgentsBackendAdapter(no_exec)
        matches = adapter.glob_info("*.py")
        paths = [m["path"] for m in matches]
        assert any("code.py" in p for p in paths)


# =============================================================================
# ls_info — fast path
# =============================================================================


class TestLsInfoFastPath:
    def test_lists_entries_with_types(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend,
    ) -> None:
        entries = adapter.ls_info(".")
        paths = [e["path"] for e in entries]
        assert any("code.py" in p for p in paths)
        assert any("sub" in p for p in paths)

        sub_entry = next(e for e in entries if "sub" in e["path"])
        assert sub_entry["is_dir"] is True

        file_entry = next(e for e in entries if "code.py" in e["path"])
        assert file_entry["is_dir"] is False


# =============================================================================
# ls_info — fallback path
# =============================================================================


class TestLsInfoFallback:
    def test_lists_entries_without_execute(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        adapter = DeepAgentsBackendAdapter(no_exec)
        entries = adapter.ls_info(".")
        paths = [e["path"] for e in entries]
        assert any("code.py" in p for p in paths)
