"""Tests verifying tool wrappers do not block the asyncio event loop.

Each tool wrapper is an ``async def`` that historically called sync
backend methods directly (``backend.read()``, ``backend.list_files()``,
``subprocess.run()``).  With the fix, these are offloaded via
``asyncio.to_thread()`` so the event loop remains responsive even
when multiple sub-agents invoke tools concurrently.

These tests verify the non-blocking property by running each tool
while a concurrent probe task measures event-loop drift.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from graphton.core.backends.filesystem import FilesystemBackend
from graphton.core.tool_wrappers import (
    _create_edit_tool,
    _create_execute_tool,
    _create_glob_tool,
    _create_grep_tool,
    _create_ls_tool,
    _create_read_tool,
    _create_write_tool,
)


def _tc(name: str, args: dict, tc_id: str = "call_async_001") -> dict:
    return {"name": name, "args": args, "id": tc_id, "type": "tool_call"}


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sandbox(tmp_path: Path) -> FilesystemBackend:
    sb = FilesystemBackend(root_dir=tmp_path)
    sb.write("hello.txt", "line one\nline two\nline three")
    sb.write("code.py", "def hello():\n    return 42\ndef world():\n    pass")
    sb.write("sub/nested.txt", "nested content")
    return sb


# =============================================================================
# Helpers
# =============================================================================


class _EventLoopProbe:
    """Measures event loop responsiveness alongside a tool invocation.

    Spawns a concurrent task that does a short sleep and measures the
    actual elapsed time.  If the tool blocks the event loop, the
    probe's sleep will be delayed far beyond the requested duration.
    """

    def __init__(self, threshold_ms: float = 400) -> None:
        self._threshold_ms = threshold_ms
        self.max_drift_ms: float = 0

    async def run(self) -> None:
        for _ in range(5):
            t0 = asyncio.get_event_loop().time()
            await asyncio.sleep(0.02)
            drift = (asyncio.get_event_loop().time() - t0) * 1000
            self.max_drift_ms = max(self.max_drift_ms, drift)

    @property
    def was_blocked(self) -> bool:
        return self.max_drift_ms > self._threshold_ms


# =============================================================================
# Tests
# =============================================================================


class TestReadNonBlocking:
    @pytest.mark.asyncio
    async def test_read_does_not_block_event_loop(
        self, sandbox: FilesystemBackend,
    ) -> None:
        read_fn = _create_read_tool(sandbox)
        probe = _EventLoopProbe()
        probe_task = asyncio.create_task(probe.run())
        await read_fn.ainvoke(_tc("read", {"path": "hello.txt"}))
        await probe_task
        assert not probe.was_blocked, (
            f"Event loop blocked for {probe.max_drift_ms:.0f}ms during read"
        )


class TestWriteNonBlocking:
    @pytest.mark.asyncio
    async def test_write_does_not_block_event_loop(
        self, sandbox: FilesystemBackend,
    ) -> None:
        write_fn = _create_write_tool(sandbox)
        probe = _EventLoopProbe()
        probe_task = asyncio.create_task(probe.run())
        await write_fn.ainvoke(
            _tc("write", {"path": "out.txt", "content": "hello world"}),
        )
        await probe_task
        assert not probe.was_blocked, (
            f"Event loop blocked for {probe.max_drift_ms:.0f}ms during write"
        )


class TestEditNonBlocking:
    @pytest.mark.asyncio
    async def test_edit_does_not_block_event_loop(
        self, sandbox: FilesystemBackend,
    ) -> None:
        edit_fn = _create_edit_tool(sandbox)
        probe = _EventLoopProbe()
        probe_task = asyncio.create_task(probe.run())
        await edit_fn.ainvoke(
            _tc("edit", {
                "path": "hello.txt",
                "old_text": "line two",
                "new_text": "line TWO",
            }),
        )
        await probe_task
        assert not probe.was_blocked, (
            f"Event loop blocked for {probe.max_drift_ms:.0f}ms during edit"
        )


class TestExecuteNonBlocking:
    @pytest.mark.asyncio
    async def test_execute_does_not_block_event_loop(
        self, sandbox: FilesystemBackend,
    ) -> None:
        exec_fn = _create_execute_tool(sandbox)
        probe = _EventLoopProbe()
        probe_task = asyncio.create_task(probe.run())
        await exec_fn.ainvoke(
            _tc("execute", {"command": "echo test", "timeout": 10}),
        )
        await probe_task
        assert not probe.was_blocked, (
            f"Event loop blocked for {probe.max_drift_ms:.0f}ms during execute"
        )


class TestLsNonBlocking:
    @pytest.mark.asyncio
    async def test_ls_does_not_block_event_loop(
        self, sandbox: FilesystemBackend,
    ) -> None:
        ls_fn = _create_ls_tool(sandbox)
        probe = _EventLoopProbe()
        probe_task = asyncio.create_task(probe.run())
        await ls_fn.ainvoke({"path": "."})
        await probe_task
        assert not probe.was_blocked, (
            f"Event loop blocked for {probe.max_drift_ms:.0f}ms during ls"
        )


class TestGlobNonBlocking:
    @pytest.mark.asyncio
    async def test_glob_does_not_block_event_loop(
        self, sandbox: FilesystemBackend,
    ) -> None:
        glob_fn = _create_glob_tool(sandbox)
        probe = _EventLoopProbe()
        probe_task = asyncio.create_task(probe.run())
        await glob_fn.ainvoke({"pattern": "*.py"})
        await probe_task
        assert not probe.was_blocked, (
            f"Event loop blocked for {probe.max_drift_ms:.0f}ms during glob"
        )


class TestGrepNonBlocking:
    @pytest.mark.asyncio
    async def test_grep_does_not_block_event_loop(
        self, sandbox: FilesystemBackend,
    ) -> None:
        grep_fn = _create_grep_tool(sandbox)
        probe = _EventLoopProbe()
        probe_task = asyncio.create_task(probe.run())
        await grep_fn.ainvoke({"pattern": "def ", "path": ".", "include": "*.py"})
        await probe_task
        assert not probe.was_blocked, (
            f"Event loop blocked for {probe.max_drift_ms:.0f}ms during grep"
        )
