"""Tests for CostCapMiddleware.

Covers:
- Constructor validation
- abefore_agent: per-invocation state reset
- aafter_model: cost accumulation, warning at 80%, exceeded at 100%
- Warning fires exactly once
- awrap_tool_call: pass-through when under budget, block when exceeded
- Multi-call escalation sequence (under → warning → exceeded)
- Edge cases: zero usage, no usage_metadata, cache-aware cost
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from graphton.core.cost_cap import CostCapMiddleware

# =============================================================================
# Helpers
# =============================================================================


def _make_ai_message(
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read: int = 0,
) -> AIMessage:
    """Build an AIMessage with usage_metadata matching LangChain conventions."""
    msg = AIMessage(content="response")
    msg.usage_metadata = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "input_token_details": {"cache_read": cache_read},
    }
    return msg


def _make_state(ai_msg: AIMessage | None = None) -> dict:
    msgs = [HumanMessage(content="do something")]
    if ai_msg:
        msgs.append(ai_msg)
    return {"messages": msgs}


def _make_request(tool_name: str = "read", tool_call_id: str = "call_1") -> MagicMock:
    request = MagicMock()
    request.tool_call = {"name": tool_name, "id": tool_call_id, "args": {}}
    return request


def _make_handler(content: str = "result") -> AsyncMock:
    msg = ToolMessage(content=content, tool_call_id="call_1", name="read")
    return AsyncMock(return_value=msg)


# Pricing: $10/MTok input, $30/MTok output → easy mental math.
# 1000 input tokens = $0.01, 1000 output tokens = $0.03.
_PRICING = dict(
    input_price_per_million=10.0,
    output_price_per_million=30.0,
    cache_read_price_per_million=1.0,
)


# =============================================================================
# Constructor
# =============================================================================


class TestConstructor:
    def test_valid_construction(self):
        mw = CostCapMiddleware(max_cost_usd=5.0, **_PRICING)
        assert mw._max_cost_usd == 5.0
        assert mw.running_cost == 0.0
        assert mw.exceeded is False

    def test_zero_max_cost_raises(self):
        with pytest.raises(ValueError, match="max_cost_usd must be positive"):
            CostCapMiddleware(max_cost_usd=0.0, **_PRICING)

    def test_negative_max_cost_raises(self):
        with pytest.raises(ValueError, match="max_cost_usd must be positive"):
            CostCapMiddleware(max_cost_usd=-1.0, **_PRICING)

    def test_warning_pct_below_min_raises(self):
        with pytest.raises(ValueError, match="warning_pct must be between"):
            CostCapMiddleware(max_cost_usd=1.0, warning_pct=49, **_PRICING)

    def test_warning_pct_above_max_raises(self):
        with pytest.raises(ValueError, match="warning_pct must be between"):
            CostCapMiddleware(max_cost_usd=1.0, warning_pct=96, **_PRICING)


# =============================================================================
# abefore_agent
# =============================================================================


class TestAbeforeAgent:
    async def test_resets_all_state(self):
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        mw._running_cost = 0.5
        mw._warned = True
        mw._exceeded = True
        mw._model_call_count = 5

        result = await mw.abefore_agent(_make_state(), runtime={})

        assert result is None
        assert mw.running_cost == 0.0
        assert mw._warned is False
        assert mw.exceeded is False
        assert mw._model_call_count == 0


# =============================================================================
# aafter_model — cost accumulation
# =============================================================================


class TestCostAccumulation:
    async def test_accumulates_cost_from_usage(self):
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)
        result = await mw.aafter_model(_make_state(ai), runtime={})

        # cost = (1000 * 10 + 1000 * 30) / 1_000_000 = 0.04
        assert result is None
        assert abs(mw.running_cost - 0.04) < 1e-9

    async def test_no_cost_with_empty_messages(self):
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        result = await mw.aafter_model({"messages": []}, runtime={})
        assert result is None
        assert mw.running_cost == 0.0

    async def test_no_cost_without_ai_message(self):
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        state = {"messages": [HumanMessage(content="hello")]}
        result = await mw.aafter_model(state, runtime={})
        assert result is None
        assert mw.running_cost == 0.0

    async def test_no_cost_without_usage_metadata(self):
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        ai = AIMessage(content="no usage")
        result = await mw.aafter_model(_make_state(ai), runtime={})
        assert result is None
        assert mw.running_cost == 0.0

    async def test_cache_aware_cost(self):
        """Cache-read tokens use the cheaper rate, reducing cost."""
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        # 1000 total input, 800 from cache → 200 regular + 800 cache_read
        ai = _make_ai_message(input_tokens=1000, output_tokens=500, cache_read=800)
        await mw.aafter_model(_make_state(ai), runtime={})

        # cost = (200 * 10 + 800 * 1 + 500 * 30) / 1_000_000
        #      = (2000 + 800 + 15000) / 1_000_000 = 0.0178
        expected = (200 * 10 + 800 * 1 + 500 * 30) / 1_000_000
        assert abs(mw.running_cost - expected) < 1e-9


# =============================================================================
# aafter_model — warning at 80%
# =============================================================================


class TestWarning:
    async def test_no_warning_at_79_percent(self):
        # Cap = $1.00, warning at $0.80. Cost per call = $0.04 (1K input + 1K output).
        # 19 calls = $0.76 → no warning.
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)

        for _ in range(19):
            result = await mw.aafter_model(_make_state(ai), runtime={})
            assert result is None

        assert not mw._warned

    async def test_warning_at_80_percent(self):
        # 20 calls = $0.80 → warning.
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)

        for _ in range(19):
            await mw.aafter_model(_make_state(ai), runtime={})

        result = await mw.aafter_model(_make_state(ai), runtime={})
        assert result is not None
        assert "messages" in result
        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], SystemMessage)
        assert "Budget warning" in result["messages"][0].content
        assert mw._warned is True

    async def test_warning_fires_once(self):
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)

        for _ in range(20):
            await mw.aafter_model(_make_state(ai), runtime={})
        assert mw._warned is True

        # Next call should NOT produce another warning
        result = await mw.aafter_model(_make_state(ai), runtime={})
        # Result could be None (not yet exceeded) or exceeded message, but NOT a warning
        if result is not None:
            msg = result["messages"][0]
            assert "Budget warning" not in msg.content or "exceeded" in msg.content


# =============================================================================
# aafter_model — exceeded at 100%
# =============================================================================


class TestExceeded:
    async def test_exceeded_at_100_percent(self):
        # 25 calls × $0.04 = $1.00 → exceeded.
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)

        for _ in range(24):
            await mw.aafter_model(_make_state(ai), runtime={})

        result = await mw.aafter_model(_make_state(ai), runtime={})
        assert result is not None
        assert mw.exceeded is True
        msg = result["messages"][0]
        assert isinstance(msg, SystemMessage)
        assert "exceeded" in msg.content.lower()

    async def test_exceeded_blocks_further_cost_tracking(self):
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)

        for _ in range(25):
            await mw.aafter_model(_make_state(ai), runtime={})
        assert mw.exceeded is True
        cost_at_exceeded = mw.running_cost

        result = await mw.aafter_model(_make_state(ai), runtime={})
        assert result is None
        assert mw.running_cost == cost_at_exceeded


# =============================================================================
# awrap_tool_call — enforcement
# =============================================================================


class TestToolBlocking:
    async def test_tools_pass_through_when_under_budget(self):
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        request = _make_request()
        handler = _make_handler("tool output")
        result = await mw.awrap_tool_call(request, handler)
        assert isinstance(result, ToolMessage)
        assert result.content == "tool output"
        handler.assert_awaited_once()

    async def test_tools_blocked_when_exceeded(self):
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        mw._exceeded = True
        request = _make_request(tool_name="execute")
        handler = _make_handler("should not run")
        result = await mw.awrap_tool_call(request, handler)

        assert isinstance(result, ToolMessage)
        assert "Budget exceeded" in result.content
        assert result.name == "execute"
        handler.assert_not_awaited()

    async def test_blocked_tool_preserves_call_id(self):
        mw = CostCapMiddleware(max_cost_usd=10.0, **_PRICING)
        mw._exceeded = True
        request = _make_request(tool_call_id="my_call")
        result = await mw.awrap_tool_call(request, _make_handler())
        assert result.tool_call_id == "my_call"


# =============================================================================
# Full escalation sequence
# =============================================================================


class TestEscalationSequence:
    async def test_under_then_warning_then_exceeded(self):
        """Full lifecycle: normal → warning → exceeded → tools blocked."""
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)
        request = _make_request()
        handler = _make_handler()

        # Phase 1: Under budget (19 calls = $0.76)
        for _ in range(19):
            result = await mw.aafter_model(_make_state(ai), runtime={})
            assert result is None
        tool_result = await mw.awrap_tool_call(request, handler)
        assert tool_result.content == "result"

        # Phase 2: Warning (call 20 = $0.80)
        result = await mw.aafter_model(_make_state(ai), runtime={})
        assert result is not None
        assert "Budget warning" in result["messages"][0].content
        tool_result = await mw.awrap_tool_call(request, handler)
        assert tool_result.content == "result"

        # Phase 3: Exceeded (call 25 = $1.00)
        for _ in range(4):
            await mw.aafter_model(_make_state(ai), runtime={})
        result = await mw.aafter_model(_make_state(ai), runtime={})
        assert mw.exceeded is True
        assert "exceeded" in result["messages"][0].content.lower()

        # Phase 4: Tools blocked
        tool_result = await mw.awrap_tool_call(request, handler)
        assert "Budget exceeded" in tool_result.content


# =============================================================================
# aafter_agent
# =============================================================================


class TestAafterAgent:
    async def test_returns_none(self):
        mw = CostCapMiddleware(max_cost_usd=5.0, **_PRICING)
        result = await mw.aafter_agent(_make_state(), runtime={})
        assert result is None


# =============================================================================
# Multi-invocation lifecycle
# =============================================================================


class TestMultiInvocation:
    async def test_reset_between_invocations(self):
        mw = CostCapMiddleware(max_cost_usd=1.0, **_PRICING)
        ai = _make_ai_message(input_tokens=1000, output_tokens=1000)

        for _ in range(25):
            await mw.aafter_model(_make_state(ai), runtime={})
        assert mw.exceeded is True

        await mw.abefore_agent(_make_state(), runtime={})
        assert mw.running_cost == 0.0
        assert mw.exceeded is False
        assert mw._warned is False

        result = await mw.aafter_model(_make_state(ai), runtime={})
        assert result is None
        assert abs(mw.running_cost - 0.04) < 1e-9
