"""Tests for shell-based fast paths in glob, grep, and search tools.

When the backend supports ``execute()``, glob/grep/search delegate to
native shell commands (``find``, ``grep``) inside the sandbox via a
single ``backend.execute()`` call.  This reduces O(N) HTTP round trips
to O(1) per tool invocation.

These tests verify:
1. The fast path is selected when ``execute()`` is available.
2. Results match the expected structure and content.
3. The Python fallback is used when ``execute()`` is absent.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from graphton.core.backends.filesystem import FilesystemBackend
from graphton.core.tool_wrappers import (
    _create_glob_tool,
    _create_grep_tool,
    _create_search_tool,
)


def _tc(name: str, args: dict, tc_id: str = "test_001") -> dict:
    return {"name": name, "args": args, "id": tc_id, "type": "tool_call"}


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sandbox(tmp_path: Path) -> FilesystemBackend:
    sb = FilesystemBackend(root_dir=tmp_path)
    sb.write("hello.txt", "line one\nline two\nline three")
    sb.write("code.py", "def hello():\n    return 42\ndef world():\n    pass")
    sb.write("sub/nested.py", "class MyClass:\n    pass\ndef nested_func():\n    pass")
    sb.write("sub/deep/data.txt", "some data here")
    sb.write("chart.yaml", "apiVersion: v1\nkind: Chart")
    return sb


class _NoExecuteBackend:
    """Backend that supports list_files/read/is_directory but NOT execute."""

    def __init__(self, fs: FilesystemBackend) -> None:
        self._fs = fs

    def list_files(self, path: str = ".") -> list[str]:
        return self._fs.list_files(path)

    def is_directory(self, path: str) -> bool:
        return self._fs.is_directory(path)

    def read(self, path: str) -> str:
        return self._fs.read(path)


# =============================================================================
# Glob — fast path
# =============================================================================


class TestGlobFastPath:
    @pytest.mark.asyncio
    async def test_glob_finds_python_files(
        self, sandbox: FilesystemBackend,
    ) -> None:
        glob_fn = _create_glob_tool(sandbox)
        result = await glob_fn.ainvoke({"pattern": "*.py"})
        assert "code.py" in result
        assert "nested.py" in result

    @pytest.mark.asyncio
    async def test_glob_finds_specific_file(
        self, sandbox: FilesystemBackend,
    ) -> None:
        glob_fn = _create_glob_tool(sandbox)
        result = await glob_fn.ainvoke({"pattern": "chart.yaml"})
        assert "chart.yaml" in result

    @pytest.mark.asyncio
    async def test_glob_with_path_pattern(
        self, sandbox: FilesystemBackend,
    ) -> None:
        glob_fn = _create_glob_tool(sandbox)
        result = await glob_fn.ainvoke({"pattern": "**/*.py"})
        # **/*.py requires at least one directory component (fnmatch semantics)
        assert "nested.py" in result

    @pytest.mark.asyncio
    async def test_glob_no_matches(
        self, sandbox: FilesystemBackend,
    ) -> None:
        glob_fn = _create_glob_tool(sandbox)
        result = await glob_fn.ainvoke({"pattern": "*.rs"})
        assert "No files matching" in result

    @pytest.mark.asyncio
    async def test_glob_with_subdirectory(
        self, sandbox: FilesystemBackend,
    ) -> None:
        glob_fn = _create_glob_tool(sandbox)
        result = await glob_fn.ainvoke({"pattern": "*.txt", "path": "sub"})
        assert "data.txt" in result or "nested" in result

    @pytest.mark.asyncio
    async def test_glob_excludes_git_directory(
        self, sandbox: FilesystemBackend, tmp_path: Path,
    ) -> None:
        (tmp_path / ".git" / "objects").mkdir(parents=True)
        (tmp_path / ".git" / "objects" / "hidden.py").write_text("x")
        glob_fn = _create_glob_tool(sandbox)
        result = await glob_fn.ainvoke({"pattern": "*.py"})
        assert "hidden.py" not in result


# =============================================================================
# Glob — fallback path
# =============================================================================


class TestGlobFallback:
    @pytest.mark.asyncio
    async def test_glob_fallback_finds_files(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        glob_fn = _create_glob_tool(no_exec)
        result = await glob_fn.ainvoke({"pattern": "*.py"})
        assert "code.py" in result

    @pytest.mark.asyncio
    async def test_glob_fallback_no_matches(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        glob_fn = _create_glob_tool(no_exec)
        result = await glob_fn.ainvoke({"pattern": "*.rs"})
        assert "No files matching" in result


# =============================================================================
# Grep — fast path
# =============================================================================


class TestGrepFastPath:
    @pytest.mark.asyncio
    async def test_grep_finds_pattern(
        self, sandbox: FilesystemBackend,
    ) -> None:
        grep_fn = _create_grep_tool(sandbox)
        result = await grep_fn.ainvoke({"pattern": "def ", "path": "."})
        assert "def hello" in result
        assert "def world" in result

    @pytest.mark.asyncio
    async def test_grep_with_include_filter(
        self, sandbox: FilesystemBackend,
    ) -> None:
        grep_fn = _create_grep_tool(sandbox)
        result = await grep_fn.ainvoke({
            "pattern": "line",
            "path": ".",
            "include": "*.txt",
        })
        assert "hello.txt" in result
        assert "code.py" not in result

    @pytest.mark.asyncio
    async def test_grep_no_matches(
        self, sandbox: FilesystemBackend,
    ) -> None:
        grep_fn = _create_grep_tool(sandbox)
        result = await grep_fn.ainvoke({"pattern": "nonexistent_pattern_xyz"})
        assert "No matches" in result

    @pytest.mark.asyncio
    async def test_grep_invalid_regex(
        self, sandbox: FilesystemBackend,
    ) -> None:
        grep_fn = _create_grep_tool(sandbox)
        result = await grep_fn.ainvoke({"pattern": "[invalid"})
        assert "Invalid regex" in result

    @pytest.mark.asyncio
    async def test_grep_reports_match_count(
        self, sandbox: FilesystemBackend,
    ) -> None:
        grep_fn = _create_grep_tool(sandbox)
        result = await grep_fn.ainvoke({"pattern": "def ", "include": "*.py"})
        assert "Found" in result
        assert "matches" in result


# =============================================================================
# Grep — fallback path
# =============================================================================


class TestGrepFallback:
    @pytest.mark.asyncio
    async def test_grep_fallback_finds_pattern(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        grep_fn = _create_grep_tool(no_exec)
        result = await grep_fn.ainvoke({"pattern": "def ", "path": "."})
        assert "def hello" in result

    @pytest.mark.asyncio
    async def test_grep_fallback_no_matches(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        grep_fn = _create_grep_tool(no_exec)
        result = await grep_fn.ainvoke({"pattern": "nonexistent_pattern_xyz"})
        assert "No matches" in result


# =============================================================================
# Search — fast path (grep-based index build)
# =============================================================================


class TestSearchFastPath:
    @pytest.mark.asyncio
    async def test_search_finds_function(
        self, sandbox: FilesystemBackend,
    ) -> None:
        search_fn = _create_search_tool(sandbox)
        result = await search_fn.ainvoke({"query": "hello"})
        assert "hello" in result

    @pytest.mark.asyncio
    async def test_search_finds_class(
        self, sandbox: FilesystemBackend,
    ) -> None:
        search_fn = _create_search_tool(sandbox)
        result = await search_fn.ainvoke({"query": "MyClass"})
        assert "MyClass" in result

    @pytest.mark.asyncio
    async def test_search_no_results(
        self, sandbox: FilesystemBackend,
    ) -> None:
        search_fn = _create_search_tool(sandbox)
        result = await search_fn.ainvoke({"query": "nonexistent_symbol_xyz"})
        assert "No definitions found" in result

    @pytest.mark.asyncio
    async def test_search_empty_query(
        self, sandbox: FilesystemBackend,
    ) -> None:
        search_fn = _create_search_tool(sandbox)
        result = await search_fn.ainvoke({"query": ""})
        assert "provide a search query" in result.lower()


# =============================================================================
# Search — fallback path
# =============================================================================


class TestSearchFallback:
    @pytest.mark.asyncio
    async def test_search_fallback_finds_function(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        search_fn = _create_search_tool(no_exec)
        result = await search_fn.ainvoke({"query": "hello"})
        assert "hello" in result

    @pytest.mark.asyncio
    async def test_search_fallback_finds_class(
        self, sandbox: FilesystemBackend,
    ) -> None:
        no_exec = _NoExecuteBackend(sandbox)
        search_fn = _create_search_tool(no_exec)
        result = await search_fn.ainvoke({"query": "MyClass"})
        assert "MyClass" in result
