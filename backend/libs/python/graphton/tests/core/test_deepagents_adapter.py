"""Tests for DeepAgentsBackendAdapter.

Verifies that the adapter:
1. Satisfies deepagents' SandboxBackendProtocol (isinstance + MRO inheritance)
2. Correctly delegates operations to the inner backend
3. Converts return types between graphton and deepagents formats
4. Preserves the execute tool through FilesystemMiddleware (integration)
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from deepagents.backends.protocol import (  # type: ignore[import-untyped]
    BackendProtocol,
    EditResult,
    ExecuteResponse,
    SandboxBackendProtocol,
    WriteResult,
)
from deepagents.middleware.filesystem import (  # type: ignore[import-untyped]
    FilesystemMiddleware,
    _supports_execution,
)
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage
from langchain_core.tools import tool

from graphton.core.backends.deepagents_adapter import DeepAgentsBackendAdapter
from graphton.core.backends.filesystem import FilesystemBackend

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sandbox(tmp_path: Path) -> FilesystemBackend:
    """Create a FilesystemBackend rooted at a fresh temp directory."""
    return FilesystemBackend(root_dir=tmp_path)


@pytest.fixture
def adapter(sandbox: FilesystemBackend) -> DeepAgentsBackendAdapter:
    """Create an adapter wrapping a FilesystemBackend."""
    return DeepAgentsBackendAdapter(sandbox)


# =============================================================================
# Protocol compliance — the core invariant this adapter exists to satisfy
# =============================================================================


class TestProtocolCompliance:
    """The adapter MUST pass isinstance checks for SandboxBackendProtocol.

    This is the single most important property: deepagents'
    FilesystemMiddleware uses ``_supports_execution()`` to decide whether
    to strip the execute tool.  If this check fails, the entire fix is
    broken.

    The adapter explicitly inherits from ``SandboxBackendProtocol``
    (not duck typing), so ``isinstance`` is guaranteed via MRO.
    """

    def test_isinstance_sandbox_backend_protocol(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        assert isinstance(adapter, SandboxBackendProtocol)

    def test_isinstance_backend_protocol(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        assert isinstance(adapter, BackendProtocol)

    def test_mro_includes_sandbox_backend_protocol(self) -> None:
        """Explicit inheritance puts SandboxBackendProtocol in the MRO.

        This is stronger than isinstance (which also works via structural
        subtyping for @runtime_checkable protocols).  MRO membership
        proves the adapter truly inherits from the protocol, not just
        that it happens to have the right method names.
        """
        assert SandboxBackendProtocol in DeepAgentsBackendAdapter.__mro__

    def test_supports_execution_returns_true(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        """Verify using the exact function deepagents uses internally."""
        assert _supports_execution(adapter) is True

    def test_has_id_property(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        assert isinstance(adapter.id, str)
        assert len(adapter.id) > 0


# =============================================================================
# Execute — the tool that was being stripped
# =============================================================================


class TestExecute:
    def test_execute_returns_execute_response(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        result = adapter.execute("echo hello")
        assert isinstance(result, ExecuteResponse)

    def test_execute_captures_stdout(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        result = adapter.execute("echo hello")
        assert "hello" in result.output
        assert result.exit_code == 0

    def test_execute_captures_stderr(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        result = adapter.execute("echo error >&2")
        assert "error" in result.output

    def test_execute_nonzero_exit_code(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        result = adapter.execute("exit 42")
        assert result.exit_code == 42


# =============================================================================
# File operations
# =============================================================================


class TestRead:
    def test_read_existing_file(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("test.txt", "line one\nline two\nline three")
        content = adapter.read("test.txt")
        assert "line one" in content
        assert "line two" in content

    def test_read_with_offset_and_limit(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("test.txt", "a\nb\nc\nd\ne")
        content = adapter.read("test.txt", offset=1, limit=2)
        assert "b" in content
        assert "c" in content
        assert "d" not in content

    def test_read_nonexistent_returns_error_string(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        result = adapter.read("nonexistent.txt")
        assert "Error" in result or "not found" in result.lower()


class TestWrite:
    def test_write_creates_file(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        result = adapter.write("new.txt", "content")
        assert isinstance(result, WriteResult)
        assert result.error is None
        assert result.path == "new.txt"
        assert sandbox.read("new.txt") == "content"

    def test_write_creates_parent_dirs(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        result = adapter.write("sub/dir/file.txt", "nested")
        assert result.error is None
        assert sandbox.read("sub/dir/file.txt") == "nested"


class TestEdit:
    def test_edit_replaces_text(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("edit.txt", "hello world")
        result = adapter.edit("edit.txt", "world", "planet")
        assert isinstance(result, EditResult)
        assert result.error is None
        assert result.occurrences == 1
        assert sandbox.read("edit.txt") == "hello planet"

    def test_edit_replace_all(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("edit.txt", "aaa bbb aaa")
        result = adapter.edit("edit.txt", "aaa", "xxx", replace_all=True)
        assert result.occurrences == 2
        assert sandbox.read("edit.txt") == "xxx bbb xxx"

    def test_edit_text_not_found(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("edit.txt", "hello")
        result = adapter.edit("edit.txt", "missing", "replacement")
        assert result.error is not None
        assert "not found" in result.error.lower()


class TestLsInfo:
    def test_lists_directory_entries(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("a.txt", "a")
        sandbox.write("b.txt", "b")
        entries = adapter.ls_info(".")
        paths = [e["path"] for e in entries]
        assert "a.txt" in paths
        assert "b.txt" in paths


class TestGrepRaw:
    def test_finds_matching_lines(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("code.py", "def hello():\n    return 42\ndef world():\n    pass")
        matches = adapter.grep_raw("def ")
        assert isinstance(matches, list)
        assert len(matches) >= 2
        assert all("def " in m["text"] for m in matches)

    def test_invalid_regex_returns_error(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        result = adapter.grep_raw("[invalid")
        assert isinstance(result, str)
        assert "Invalid" in result


class TestGlobInfo:
    def test_finds_files_by_pattern(
        self, adapter: DeepAgentsBackendAdapter, sandbox: FilesystemBackend
    ) -> None:
        sandbox.write("a.py", "python")
        sandbox.write("b.txt", "text")
        matches = adapter.glob_info("*.py")
        paths = [m["path"] for m in matches]
        assert any("a.py" in p for p in paths)
        assert not any("b.txt" in p for p in paths)


# =============================================================================
# Upload / download
# =============================================================================


class TestUploadDownload:
    def test_upload_and_download_roundtrip(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        upload_result = adapter.upload_files([
            ("round.txt", b"roundtrip content"),
        ])
        assert len(upload_result) == 1
        assert upload_result[0].error is None

        download_result = adapter.download_files(["round.txt"])
        assert len(download_result) == 1
        assert download_result[0].error is None
        assert download_result[0].content == b"roundtrip content"

    def test_download_nonexistent_returns_error(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        result = adapter.download_files(["nope.txt"])
        assert result[0].error == "file_not_found"


# =============================================================================
# ID delegation
# =============================================================================


class TestId:
    def test_generates_stable_id(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        assert adapter.id == adapter.id

    def test_delegates_to_inner_when_available(self) -> None:
        class FakeBackend:
            id = "custom-id-123"
            def execute(self, cmd: str, **kw): ...  # noqa: ANN003
            def read(self, p: str) -> str: return ""
            def write(self, p: str, c: str) -> None: ...
            def list_files(self, p: str = ".") -> list[str]: return []
            def is_directory(self, p: str) -> bool: return False

        adapter = DeepAgentsBackendAdapter(FakeBackend())
        assert adapter.id == "custom-id-123"


# =============================================================================
# Middleware integration — the execute tool must survive awrap_model_call
# =============================================================================


@tool
def _dummy_execute(command: str) -> str:
    """Execute a shell command (test stub)."""
    return "ok"


_dummy_execute.name = "execute"  # type: ignore[attr-defined]


@tool
def _dummy_read(file_path: str) -> str:
    """Read a file (test stub)."""
    return "content"


class TestMiddlewareIntegration:
    """Verify that the execute tool is NOT stripped by FilesystemMiddleware.

    This is the end-to-end test for the original bug: deepagents'
    ``FilesystemMiddleware.wrap_model_call`` checks
    ``_supports_execution(backend)`` and removes all tools named
    ``"execute"`` when the check returns ``False``.

    With the adapter backed by a real ``FilesystemBackend``, the check
    must return ``True`` and the execute tool must remain in
    ``request.tools`` after middleware processing.
    """

    def test_execute_tool_preserved_after_wrap_model_call(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        """The execute tool must survive FilesystemMiddleware filtering."""
        middleware = FilesystemMiddleware(backend=adapter)

        captured: list[ModelRequest] = []

        def capturing_handler(req: ModelRequest) -> ModelResponse:
            captured.append(req)
            return ModelResponse(result=[AIMessage(content="done")])

        request = ModelRequest(
            model=MagicMock(),
            messages=[],
            tools=[_dummy_execute, _dummy_read],
        )

        middleware.wrap_model_call(request, capturing_handler)

        assert len(captured) == 1
        forwarded = captured[0]
        tool_names = [
            t.name if hasattr(t, "name") else t.get("name")
            for t in forwarded.tools
        ]
        assert "execute" in tool_names, (
            f"execute tool was stripped by FilesystemMiddleware. "
            f"Remaining tools: {tool_names}"
        )

    @pytest.mark.asyncio
    async def test_execute_tool_preserved_after_awrap_model_call(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        """The async path must also preserve the execute tool."""
        middleware = FilesystemMiddleware(backend=adapter)

        captured: list[ModelRequest] = []

        async def capturing_handler(req: ModelRequest) -> ModelResponse:
            captured.append(req)
            return ModelResponse(result=[AIMessage(content="done")])

        request = ModelRequest(
            model=MagicMock(),
            messages=[],
            tools=[_dummy_execute, _dummy_read],
        )

        await middleware.awrap_model_call(request, capturing_handler)

        assert len(captured) == 1
        forwarded = captured[0]
        tool_names = [
            t.name if hasattr(t, "name") else t.get("name")
            for t in forwarded.tools
        ]
        assert "execute" in tool_names, (
            f"execute tool was stripped by async FilesystemMiddleware. "
            f"Remaining tools: {tool_names}"
        )

    def test_execution_system_prompt_appended(
        self, adapter: DeepAgentsBackendAdapter
    ) -> None:
        """When execute is present and supported, the execution system
        prompt must be appended to the request's system prompt."""
        middleware = FilesystemMiddleware(backend=adapter)

        captured: list[ModelRequest] = []

        def capturing_handler(req: ModelRequest) -> ModelResponse:
            captured.append(req)
            return ModelResponse(result=[AIMessage(content="done")])

        request = ModelRequest(
            model=MagicMock(),
            messages=[],
            tools=[_dummy_execute],
            system_prompt="Base prompt.",
        )

        middleware.wrap_model_call(request, capturing_handler)

        assert len(captured) == 1
        system = captured[0].system_prompt or ""
        assert "execute" in system.lower(), (
            "Execution system prompt was not appended despite backend "
            "supporting execution."
        )

    def test_execute_stripped_without_adapter(self) -> None:
        """Baseline: without the adapter, the middleware MUST strip execute.

        This confirms the middleware's filtering logic is active and that
        our other tests are meaningful (not vacuously passing).
        """
        middleware = FilesystemMiddleware(backend=None)

        captured: list[ModelRequest] = []

        def capturing_handler(req: ModelRequest) -> ModelResponse:
            captured.append(req)
            return ModelResponse(result=[AIMessage(content="done")])

        request = ModelRequest(
            model=MagicMock(),
            messages=[],
            tools=[_dummy_execute, _dummy_read],
        )

        middleware.wrap_model_call(request, capturing_handler)

        assert len(captured) == 1
        forwarded = captured[0]
        tool_names = [
            t.name if hasattr(t, "name") else t.get("name")
            for t in forwarded.tools
        ]
        assert "execute" not in tool_names, (
            "execute tool should be stripped when backend=None "
            "(StateBackend does not implement SandboxBackendProtocol)"
        )
