"""Tests for GracefulStopMiddleware."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from graphton.core.graceful_stop import GracefulStopMiddleware


@pytest.fixture
def middleware():
    return GracefulStopMiddleware()


class TestGracefulStopMiddleware:
    def test_initially_inactive(self, middleware):
        assert middleware.activated is False

    def test_activate(self, middleware):
        middleware.activate()
        assert middleware.activated is True

    def test_activate_idempotent(self, middleware):
        middleware.activate()
        middleware.activate()
        assert middleware.activated is True

    @pytest.mark.asyncio
    async def test_aafter_model_noop_when_inactive(self, middleware):
        result = await middleware.aafter_model({"messages": []}, {})
        assert result is None

    @pytest.mark.asyncio
    async def test_aafter_model_injects_stop_message_on_activation(self, middleware):
        middleware.activate()
        result = await middleware.aafter_model({"messages": []}, {})

        assert result is not None
        assert "messages" in result
        assert len(result["messages"]) == 1
        msg = result["messages"][0]
        assert "platform has requested" in msg.content

    @pytest.mark.asyncio
    async def test_aafter_model_uses_custom_reason(self, middleware):
        middleware.activate(reason="Credits exhausted")
        result = await middleware.aafter_model({"messages": []}, {})

        assert result is not None
        msg = result["messages"][0]
        assert msg.content == "Credits exhausted"

    @pytest.mark.asyncio
    async def test_aafter_model_only_injects_once(self, middleware):
        middleware.activate()
        result1 = await middleware.aafter_model({"messages": []}, {})
        result2 = await middleware.aafter_model({"messages": []}, {})

        assert result1 is not None
        assert result2 is None

    @pytest.mark.asyncio
    async def test_awrap_tool_call_passes_through_when_inactive(self, middleware):
        handler = AsyncMock(return_value="tool_result")
        request = type("Req", (), {"tool_call": {"id": "tc-1", "name": "read"}})()

        result = await middleware.awrap_tool_call(request, handler)

        assert result == "tool_result"
        handler.assert_called_once_with(request)

    @pytest.mark.asyncio
    async def test_awrap_tool_call_blocks_when_activated(self, middleware):
        middleware.activate()
        handler = AsyncMock()
        request = type("Req", (), {"tool_call": {"id": "tc-1", "name": "write"}})()

        result = await middleware.awrap_tool_call(request, handler)

        handler.assert_not_called()
        assert "Execution stopped by platform" in result.content
        assert result.tool_call_id == "tc-1"
        assert result.name == "write"


class TestGracefulStopSubAgentView:
    @pytest.mark.asyncio
    async def test_shares_activation_state(self):
        parent = GracefulStopMiddleware()
        view = parent.for_sub_agent()

        assert not parent.activated

        parent.activate()

        handler = AsyncMock()
        request = type("Req", (), {"tool_call": {"id": "tc-2", "name": "exec"}})()
        result = await view.awrap_tool_call(request, handler)

        handler.assert_not_called()
        assert "Execution stopped by platform" in result.content
