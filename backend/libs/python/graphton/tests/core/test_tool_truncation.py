"""Tests for ToolTruncationMiddleware.

Covers:
- Constructor validation and defaults
- awrap_tool_call: pass-through under limit, truncation over limit
- Truncation marker content
- on_truncation callback invocation
- Multiple truncations accumulate counters
- Non-string content and Command results pass through unchanged
- abefore_agent resets per-invocation state
- aafter_agent logs summary
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from graphton.core.tool_truncation import (
    _DEFAULT_MAX_CHARS,
    ToolTruncationMiddleware,
)


# =============================================================================
# Helpers
# =============================================================================


def _make_request(tool_name: str = "read", tool_call_id: str = "call_1") -> MagicMock:
    """Build a minimal ToolCallRequest-like object."""
    request = MagicMock()
    request.tool_call = {"name": tool_name, "id": tool_call_id, "args": {}}
    return request


def _make_handler(content: str, *, name: str = "read") -> AsyncMock:
    """Build an async handler that returns a ToolMessage with given content."""
    msg = ToolMessage(content=content, tool_call_id="call_1", name=name)
    handler = AsyncMock(return_value=msg)
    return handler


def _make_state() -> dict:
    return {"messages": []}


# =============================================================================
# Constructor
# =============================================================================


class TestConstructor:
    def test_default_max_chars(self):
        mw = ToolTruncationMiddleware()
        assert mw._max_chars == _DEFAULT_MAX_CHARS

    def test_custom_max_chars(self):
        mw = ToolTruncationMiddleware(max_chars=5_000)
        assert mw._max_chars == 5_000

    def test_zero_max_chars_raises(self):
        with pytest.raises(ValueError, match="max_chars must be positive"):
            ToolTruncationMiddleware(max_chars=0)

    def test_negative_max_chars_raises(self):
        with pytest.raises(ValueError, match="max_chars must be positive"):
            ToolTruncationMiddleware(max_chars=-100)

    def test_callback_stored(self):
        cb = MagicMock()
        mw = ToolTruncationMiddleware(on_truncation=cb)
        assert mw._on_truncation is cb


# =============================================================================
# awrap_tool_call — pass-through (under limit)
# =============================================================================


class TestPassThrough:
    async def test_short_result_unchanged(self):
        mw = ToolTruncationMiddleware(max_chars=100)
        request = _make_request()
        handler = _make_handler("short result")
        result = await mw.awrap_tool_call(request, handler)
        assert isinstance(result, ToolMessage)
        assert result.content == "short result"

    async def test_exact_limit_not_truncated(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()
        handler = _make_handler("x" * 10)
        result = await mw.awrap_tool_call(request, handler)
        assert result.content == "x" * 10
        assert mw.truncation_count == 0

    async def test_command_result_passes_through(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()
        cmd = Command(goto="some_node")
        handler = AsyncMock(return_value=cmd)
        result = await mw.awrap_tool_call(request, handler)
        assert result is cmd

    async def test_non_string_content_passes_through(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()
        msg = ToolMessage(
            content=[{"type": "text", "text": "x" * 100}],
            tool_call_id="call_1",
            name="read",
        )
        handler = AsyncMock(return_value=msg)
        result = await mw.awrap_tool_call(request, handler)
        assert result.content == [{"type": "text", "text": "x" * 100}]

    async def test_no_callback_when_no_truncation(self):
        cb = MagicMock()
        mw = ToolTruncationMiddleware(max_chars=100, on_truncation=cb)
        request = _make_request()
        handler = _make_handler("short")
        await mw.awrap_tool_call(request, handler)
        cb.assert_not_called()


# =============================================================================
# awrap_tool_call — truncation (over limit)
# =============================================================================


class TestTruncation:
    async def test_result_truncated_at_limit(self):
        mw = ToolTruncationMiddleware(max_chars=20)
        request = _make_request()
        handler = _make_handler("a" * 50)
        result = await mw.awrap_tool_call(request, handler)
        assert result.content.startswith("a" * 20)
        assert "[truncated" in result.content

    async def test_truncation_marker_contains_original_size(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()
        handler = _make_handler("b" * 500)
        result = await mw.awrap_tool_call(request, handler)
        assert "500" in result.content
        assert "10" in result.content

    async def test_truncation_preserves_tool_call_id(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request(tool_call_id="my_id")
        handler = _make_handler("c" * 100)
        result = await mw.awrap_tool_call(request, handler)
        assert result.tool_call_id == "my_id"

    async def test_truncation_preserves_tool_name(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request(tool_name="execute")
        handler = _make_handler("d" * 100, name="execute")
        result = await mw.awrap_tool_call(request, handler)
        assert result.name == "execute"

    async def test_callback_invoked_with_correct_args(self):
        cb = MagicMock()
        mw = ToolTruncationMiddleware(max_chars=20, on_truncation=cb)
        request = _make_request(tool_name="shell")
        handler = _make_handler("e" * 50)
        await mw.awrap_tool_call(request, handler)
        cb.assert_called_once_with("shell", 30)

    async def test_truncation_count_incremented(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()
        handler = _make_handler("f" * 100)
        await mw.awrap_tool_call(request, handler)
        assert mw.truncation_count == 1

    async def test_total_chars_truncated_accumulated(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()
        await mw.awrap_tool_call(request, _make_handler("g" * 60))
        await mw.awrap_tool_call(request, _make_handler("h" * 110))
        assert mw.truncation_count == 2
        assert mw.total_chars_truncated == (60 - 10) + (110 - 10)


# =============================================================================
# Multiple truncations
# =============================================================================


class TestMultipleTruncations:
    async def test_mixed_truncated_and_not(self):
        cb = MagicMock()
        mw = ToolTruncationMiddleware(max_chars=20, on_truncation=cb)
        request = _make_request()

        await mw.awrap_tool_call(request, _make_handler("short"))
        await mw.awrap_tool_call(request, _make_handler("x" * 50))
        await mw.awrap_tool_call(request, _make_handler("also short"))
        await mw.awrap_tool_call(request, _make_handler("y" * 100))

        assert mw.truncation_count == 2
        assert cb.call_count == 2
        assert mw.total_chars_truncated == (50 - 20) + (100 - 20)


# =============================================================================
# Lifecycle hooks
# =============================================================================


class TestLifecycle:
    async def test_abefore_agent_resets_counters(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()
        await mw.awrap_tool_call(request, _make_handler("z" * 50))
        assert mw.truncation_count == 1

        result = await mw.abefore_agent(_make_state(), runtime={})
        assert result is None
        assert mw.truncation_count == 0
        assert mw.total_chars_truncated == 0

    async def test_aafter_agent_returns_none(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        result = await mw.aafter_agent(_make_state(), runtime={})
        assert result is None

    async def test_counters_accumulate_within_invocation(self):
        mw = ToolTruncationMiddleware(max_chars=10)
        request = _make_request()

        await mw.abefore_agent(_make_state(), runtime={})
        await mw.awrap_tool_call(request, _make_handler("a" * 30))
        await mw.awrap_tool_call(request, _make_handler("b" * 40))
        assert mw.truncation_count == 2

        await mw.abefore_agent(_make_state(), runtime={})
        assert mw.truncation_count == 0

        await mw.awrap_tool_call(request, _make_handler("c" * 50))
        assert mw.truncation_count == 1
