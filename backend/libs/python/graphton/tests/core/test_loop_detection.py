"""Comprehensive tests for LoopDetectionMiddleware.

Covers:
- Internal helpers: _hash_params, _detect_consecutive_loops, _detect_total_repetitions
- Intervention message generation
- aafter_model hook: detection, tracking, and intervention injection
- awrap_tool_call hook: enforcement at hard stop
- Lifecycle hooks: abefore_agent (reset), aafter_agent (stats)
- Edge cases: disabled middleware, empty state, no tool_calls, threshold=1
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest

from graphton.core.loop_detection import LoopDetectionMiddleware

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def middleware():
    """Default middleware with small thresholds for easy testing."""
    return LoopDetectionMiddleware(
        history_size=10,
        consecutive_threshold=3,
        total_threshold=5,
        enabled=True,
    )


@pytest.fixture
def disabled_middleware():
    """Middleware with detection disabled."""
    return LoopDetectionMiddleware(enabled=False)


@pytest.fixture
def tight_middleware():
    """Middleware with threshold=1 to test boundary behavior."""
    return LoopDetectionMiddleware(
        history_size=5,
        consecutive_threshold=1,
        total_threshold=2,
        enabled=True,
    )


def _make_state(messages: list) -> dict:
    """Build a minimal agent state dict."""
    return {"messages": messages}


def _make_ai_message_with_tool_calls(
    tool_calls: list[dict],
    content: str = "",
) -> AIMessage:
    """Build an AIMessage with the given tool_calls."""
    return AIMessage(content=content, tool_calls=tool_calls)


def _make_tool_call(name: str, args: dict | None = None, call_id: str = "tc1") -> dict:
    """Build a single tool_call dict."""
    return {"name": name, "args": args or {}, "id": call_id}


def _make_tool_call_request(
    name: str = "read_file",
    args: dict | None = None,
    call_id: str = "tc1",
) -> ToolCallRequest:
    """Build a ToolCallRequest for awrap_tool_call tests."""
    tool_call = _make_tool_call(name, args, call_id)
    return ToolCallRequest(
        tool_call=tool_call,
        tool=None,
        state={},
        runtime=MagicMock(),
    )


# =============================================================================
# Unit Tests: _hash_params
# =============================================================================


class TestHashParams:
    def test_deterministic(self, middleware):
        params = {"path": "/foo/bar", "encoding": "utf-8"}
        assert middleware._hash_params(params) == middleware._hash_params(params)

    def test_key_order_independent(self, middleware):
        a = middleware._hash_params({"a": 1, "b": 2})
        b = middleware._hash_params({"b": 2, "a": 1})
        assert a == b

    def test_different_params_different_hash(self, middleware):
        a = middleware._hash_params({"path": "/foo"})
        b = middleware._hash_params({"path": "/bar"})
        assert a != b

    def test_empty_params(self, middleware):
        h = middleware._hash_params({})
        assert isinstance(h, str) and len(h) == 16

    def test_non_serializable_falls_back(self, middleware):
        """Non-JSON-serializable values use default=str fallback."""
        h = middleware._hash_params({"obj": object()})
        assert isinstance(h, str) and len(h) == 16

    def test_returns_16_hex_chars(self, middleware):
        h = middleware._hash_params({"key": "value"})
        assert len(h) == 16
        int(h, 16)  # should not raise


# =============================================================================
# Unit Tests: _detect_consecutive_loops
# =============================================================================


class TestDetectConsecutiveLoops:
    def test_empty_history(self, middleware):
        is_loop, tool, count = middleware._detect_consecutive_loops()
        assert not is_loop
        assert tool == ""
        assert count == 0

    def test_no_loop_below_threshold(self, middleware):
        middleware._tool_history.append(("read", "aaa"))
        middleware._tool_history.append(("read", "aaa"))
        is_loop, tool, count = middleware._detect_consecutive_loops()
        assert not is_loop
        assert count == 2

    def test_loop_at_threshold(self, middleware):
        for _ in range(3):
            middleware._tool_history.append(("read", "aaa"))
        is_loop, tool, count = middleware._detect_consecutive_loops()
        assert is_loop
        assert tool == "read"
        assert count == 3

    def test_broken_by_different_tool(self, middleware):
        middleware._tool_history.append(("read", "aaa"))
        middleware._tool_history.append(("write", "bbb"))
        middleware._tool_history.append(("read", "aaa"))
        middleware._tool_history.append(("read", "aaa"))
        is_loop, tool, count = middleware._detect_consecutive_loops()
        assert not is_loop
        assert count == 2

    def test_broken_by_different_params(self, middleware):
        middleware._tool_history.append(("read", "aaa"))
        middleware._tool_history.append(("read", "bbb"))
        middleware._tool_history.append(("read", "aaa"))
        is_loop, _, count = middleware._detect_consecutive_loops()
        assert not is_loop
        assert count == 1


# =============================================================================
# Unit Tests: _detect_total_repetitions
# =============================================================================


class TestDetectTotalRepetitions:
    def test_empty_history(self, middleware):
        is_excessive, tool, count = middleware._detect_total_repetitions()
        assert not is_excessive
        assert count == 0

    def test_below_threshold(self, middleware):
        for _ in range(4):
            middleware._tool_history.append(("read", "aaa"))
        _, _, count = middleware._detect_total_repetitions()
        assert count == 4
        assert not middleware._detect_total_repetitions()[0]

    def test_at_threshold(self, middleware):
        for _ in range(5):
            middleware._tool_history.append(("read", "aaa"))
        is_excessive, tool, count = middleware._detect_total_repetitions()
        assert is_excessive
        assert tool == "read"
        assert count == 5

    def test_non_consecutive_still_counted(self, middleware):
        """Total count includes non-consecutive repetitions."""
        for i in range(5):
            middleware._tool_history.append(("read", "aaa"))
            if i < 4:
                middleware._tool_history.append(("write", "bbb"))
        is_excessive, tool, count = middleware._detect_total_repetitions()
        assert is_excessive
        assert count == 5

    def test_different_params_not_counted(self, middleware):
        for i in range(5):
            middleware._tool_history.append(("read", f"hash{i}"))
        is_excessive, _, count = middleware._detect_total_repetitions()
        assert not is_excessive
        assert count == 1


# =============================================================================
# Unit Tests: _create_intervention_message
# =============================================================================


class TestCreateInterventionMessage:
    def test_warning_message(self, middleware):
        msg = middleware._create_intervention_message(
            "read_file", 3, 3, is_final=False,
        )
        assert isinstance(msg, SystemMessage)
        assert "LOOP WARNING" in msg.content
        assert "read_file" in msg.content
        assert "3 times in a row" in msg.content

    def test_final_message(self, middleware):
        msg = middleware._create_intervention_message(
            "search", 5, 10, is_final=True,
        )
        assert isinstance(msg, SystemMessage)
        assert "LOOP DETECTED" in msg.content
        assert "search" in msg.content
        assert "10 times" in msg.content
        assert "MUST conclude" in msg.content


# =============================================================================
# Hook Tests: abefore_agent (lifecycle reset)
# =============================================================================


class TestAbforeAgent:
    async def test_clears_state(self, middleware):
        middleware._tool_history.append(("read", "aaa"))
        middleware._intervention_count = 2
        middleware._stopped = True

        result = await middleware.abefore_agent(
            _make_state([HumanMessage(content="hi")]),
            runtime={},
        )
        assert result is None
        assert len(middleware._tool_history) == 0
        assert middleware._intervention_count == 0
        assert middleware._stopped is False

    async def test_disabled_skips_reset(self, disabled_middleware):
        disabled_middleware._intervention_count = 5
        result = await disabled_middleware.abefore_agent(
            _make_state([]),
            runtime={},
        )
        assert result is None
        assert disabled_middleware._intervention_count == 5


# =============================================================================
# Hook Tests: aafter_model (detection + intervention)
# =============================================================================


class TestAafterModel:
    async def test_no_messages(self, middleware):
        result = await middleware.aafter_model(_make_state([]), runtime={})
        assert result is None

    async def test_no_ai_message(self, middleware):
        state = _make_state([HumanMessage(content="hello")])
        result = await middleware.aafter_model(state, runtime={})
        assert result is None

    async def test_ai_message_without_tool_calls(self, middleware):
        state = _make_state([AIMessage(content="I'll help you.")])
        result = await middleware.aafter_model(state, runtime={})
        assert result is None
        assert len(middleware._tool_history) == 0

    async def test_tracks_single_tool_call(self, middleware):
        tc = _make_tool_call("read_file", {"path": "/foo"})
        state = _make_state([_make_ai_message_with_tool_calls([tc])])

        result = await middleware.aafter_model(state, runtime={})
        assert result is None
        assert len(middleware._tool_history) == 1

    async def test_tracks_multiple_tool_calls_in_one_message(self, middleware):
        tcs = [
            _make_tool_call("read_file", {"path": "/a"}, "tc1"),
            _make_tool_call("write_file", {"path": "/b"}, "tc2"),
        ]
        state = _make_state([_make_ai_message_with_tool_calls(tcs)])

        result = await middleware.aafter_model(state, runtime={})
        assert result is None
        assert len(middleware._tool_history) == 2

    async def test_warning_at_consecutive_threshold(self, middleware):
        tc = _make_tool_call("read_file", {"path": "/foo"})
        ai_msg = _make_ai_message_with_tool_calls([tc])

        # First two calls: no intervention
        for _ in range(2):
            state = _make_state([ai_msg])
            result = await middleware.aafter_model(state, runtime={})
            assert result is None

        # Third call: consecutive threshold reached
        state = _make_state([ai_msg])
        result = await middleware.aafter_model(state, runtime={})

        assert result is not None
        assert "messages" in result
        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], SystemMessage)
        assert "LOOP WARNING" in result["messages"][0].content
        assert middleware._intervention_count == 1
        assert middleware._stopped is False

    async def test_only_one_warning_issued(self, middleware):
        """After the first warning, subsequent consecutive loops do not warn again."""
        tc = _make_tool_call("read_file", {"path": "/foo"})
        ai_msg = _make_ai_message_with_tool_calls([tc])

        # Trigger first warning at call 3
        for _ in range(3):
            await middleware.aafter_model(_make_state([ai_msg]), runtime={})

        assert middleware._intervention_count == 1

        # Call 4: still looping but no second warning
        result = await middleware.aafter_model(_make_state([ai_msg]), runtime={})
        assert result is None
        assert middleware._intervention_count == 1

    async def test_stop_at_total_threshold(self, middleware):
        tc = _make_tool_call("read_file", {"path": "/foo"})
        ai_msg = _make_ai_message_with_tool_calls([tc])

        # Drive through consecutive warning and up to total threshold
        for _ in range(4):
            await middleware.aafter_model(_make_state([ai_msg]), runtime={})

        # 5th call: total threshold hit
        result = await middleware.aafter_model(_make_state([ai_msg]), runtime={})

        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content
        assert middleware._stopped is True
        assert middleware._intervention_count == 2

    async def test_stopped_middleware_is_noop(self, middleware):
        middleware._stopped = True
        tc = _make_tool_call("read_file", {"path": "/foo"})
        state = _make_state([_make_ai_message_with_tool_calls([tc])])

        result = await middleware.aafter_model(state, runtime={})
        assert result is None
        assert len(middleware._tool_history) == 0

    async def test_disabled_middleware_is_noop(self, disabled_middleware):
        tc = _make_tool_call("read_file", {"path": "/foo"})
        state = _make_state([_make_ai_message_with_tool_calls([tc])])

        result = await disabled_middleware.aafter_model(state, runtime={})
        assert result is None

    async def test_uses_last_ai_message(self, middleware):
        """When multiple messages exist, only the last AIMessage is inspected."""
        old_ai = _make_ai_message_with_tool_calls(
            [_make_tool_call("old_tool", {}, "tc_old")]
        )
        new_ai = _make_ai_message_with_tool_calls(
            [_make_tool_call("new_tool", {}, "tc_new")]
        )
        state = _make_state([
            HumanMessage(content="hi"),
            old_ai,
            ToolMessage(content="ok", tool_call_id="tc_old"),
            new_ai,
        ])

        await middleware.aafter_model(state, runtime={})

        assert len(middleware._tool_history) == 1
        assert middleware._tool_history[0][0] == "new_tool"

    async def test_state_not_mutated(self, middleware):
        """aafter_model must not mutate the input state's messages list."""
        tc = _make_tool_call("read_file", {"path": "/foo"})
        ai_msg = _make_ai_message_with_tool_calls([tc])

        for _ in range(3):
            state = _make_state([ai_msg])
            original_len = len(state["messages"])
            await middleware.aafter_model(state, runtime={})
            assert len(state["messages"]) == original_len

    async def test_intervention_has_unique_content(self, middleware):
        """Warning and stop interventions have distinct content."""
        tc = _make_tool_call("search", {"query": "foo"})
        ai_msg = _make_ai_message_with_tool_calls([tc])

        warning_result = None
        stop_result = None

        for i in range(middleware.total_threshold):
            result = await middleware.aafter_model(_make_state([ai_msg]), runtime={})
            if result is not None and "LOOP WARNING" in result["messages"][0].content:
                warning_result = result
            if result is not None and "LOOP DETECTED" in result["messages"][0].content:
                stop_result = result

        assert warning_result is not None, "Expected a warning intervention"
        assert stop_result is not None, "Expected a stop intervention"
        assert warning_result["messages"][0].content != stop_result["messages"][0].content


# =============================================================================
# Hook Tests: awrap_tool_call (enforcement)
# =============================================================================


class TestAwrapToolCall:
    async def test_passthrough_when_not_stopped(self, middleware):
        handler = AsyncMock(return_value=ToolMessage(
            content="file contents",
            tool_call_id="tc1",
        ))
        request = _make_tool_call_request("read_file", {"path": "/foo"}, "tc1")

        result = await middleware.awrap_tool_call(request, handler)

        handler.assert_awaited_once_with(request)
        assert isinstance(result, ToolMessage)
        assert result.content == "file contents"

    async def test_blocks_when_stopped(self, middleware):
        middleware._stopped = True
        handler = AsyncMock()
        request = _make_tool_call_request("read_file", {"path": "/foo"}, "tc1")

        result = await middleware.awrap_tool_call(request, handler)

        handler.assert_not_awaited()
        assert isinstance(result, ToolMessage)
        assert result.tool_call_id == "tc1"
        assert "Loop detected" in result.content
        assert "halted" in result.content

    async def test_blocked_message_has_correct_tool_name(self, middleware):
        middleware._stopped = True
        handler = AsyncMock()
        request = _make_tool_call_request("search_code", {"q": "foo"}, "tc42")

        result = await middleware.awrap_tool_call(request, handler)

        assert result.name == "search_code"
        assert result.tool_call_id == "tc42"

    async def test_blocks_multiple_calls(self, middleware):
        """All tool calls are blocked once _stopped is True."""
        middleware._stopped = True
        handler = AsyncMock()

        for i in range(3):
            req = _make_tool_call_request(f"tool_{i}", {}, f"tc{i}")
            result = await middleware.awrap_tool_call(req, handler)
            assert isinstance(result, ToolMessage)
            assert "halted" in result.content

        handler.assert_not_awaited()


# =============================================================================
# Hook Tests: aafter_agent (stats logging)
# =============================================================================


class TestAafterAgent:
    async def test_returns_none(self, middleware):
        middleware._tool_history.append(("read", "aaa"))
        result = await middleware.aafter_agent(
            _make_state([HumanMessage(content="done")]),
            runtime={},
        )
        assert result is None

    async def test_disabled_returns_none(self, disabled_middleware):
        result = await disabled_middleware.aafter_agent(
            _make_state([]),
            runtime={},
        )
        assert result is None


# =============================================================================
# Integration: Full lifecycle
# =============================================================================


class TestFullLifecycle:
    async def test_reset_between_executions(self, middleware):
        """abefore_agent clears state accumulated in a previous execution."""
        tc = _make_tool_call("read_file", {"path": "/foo"})
        ai_msg = _make_ai_message_with_tool_calls([tc])

        # First execution: accumulate history
        for _ in range(4):
            await middleware.aafter_model(_make_state([ai_msg]), runtime={})
        assert len(middleware._tool_history) == 4
        assert middleware._intervention_count == 1

        # Reset
        await middleware.abefore_agent(_make_state([]), runtime={})

        # Second execution: clean slate
        assert len(middleware._tool_history) == 0
        assert middleware._intervention_count == 0
        assert middleware._stopped is False

    async def test_end_to_end_warning_then_stop_then_block(self, middleware):
        """Full flow: detection -> warning -> stop -> tool blocking."""
        tc = _make_tool_call("search", {"query": "foo"})
        ai_msg = _make_ai_message_with_tool_calls([tc])
        handler = AsyncMock(return_value=ToolMessage(
            content="result", tool_call_id="tc1",
        ))
        request = _make_tool_call_request("search", {"query": "foo"}, "tc1")

        # Phase 1: Below thresholds — tools pass through
        for _ in range(2):
            result = await middleware.aafter_model(_make_state([ai_msg]), runtime={})
            assert result is None
            tool_result = await middleware.awrap_tool_call(request, handler)
            assert tool_result.content == "result"

        # Phase 2: Consecutive threshold — warning injected, tools still pass
        result = await middleware.aafter_model(_make_state([ai_msg]), runtime={})
        assert result is not None and "LOOP WARNING" in result["messages"][0].content
        tool_result = await middleware.awrap_tool_call(request, handler)
        assert tool_result.content == "result"

        # Phase 3: Continue toward total threshold
        await middleware.aafter_model(_make_state([ai_msg]), runtime={})
        await middleware.awrap_tool_call(request, handler)

        # Phase 4: Total threshold — stop injected, tools blocked
        result = await middleware.aafter_model(_make_state([ai_msg]), runtime={})
        assert result is not None and "LOOP DETECTED" in result["messages"][0].content
        assert middleware._stopped is True

        tool_result = await middleware.awrap_tool_call(request, handler)
        assert "halted" in tool_result.content


# =============================================================================
# Edge Cases
# =============================================================================


class TestEdgeCases:
    async def test_threshold_one(self, tight_middleware):
        """With consecutive_threshold=1, the very first call triggers a warning."""
        tc = _make_tool_call("read", {"path": "/"})
        state = _make_state([_make_ai_message_with_tool_calls([tc])])

        result = await tight_middleware.aafter_model(state, runtime={})
        assert result is not None
        assert "LOOP WARNING" in result["messages"][0].content

    async def test_threshold_one_total_stops_on_second(self, tight_middleware):
        """With total_threshold=2, the second identical call triggers hard stop."""
        tc = _make_tool_call("read", {"path": "/"})
        state = _make_state([_make_ai_message_with_tool_calls([tc])])

        await tight_middleware.aafter_model(state, runtime={})
        result = await tight_middleware.aafter_model(state, runtime={})

        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content
        assert tight_middleware._stopped is True

    async def test_history_window_evicts_old_entries(self):
        """Sliding window (history_size) evicts oldest entries."""
        mw = LoopDetectionMiddleware(
            history_size=3,
            consecutive_threshold=10,
            total_threshold=10,
        )
        for i in range(5):
            mw._tool_history.append((f"tool_{i}", f"hash_{i}"))

        assert len(mw._tool_history) == 3
        assert mw._tool_history[0] == ("tool_2", "hash_2")

    async def test_ai_message_with_empty_tool_calls(self, middleware):
        """AIMessage with tool_calls=[] is treated as no tool calls."""
        state = _make_state([AIMessage(content="thinking...", tool_calls=[])])
        result = await middleware.aafter_model(state, runtime={})
        assert result is None
        assert len(middleware._tool_history) == 0

    async def test_mixed_tool_calls_only_repeated_ones_detected(self, middleware):
        """Consecutive detection only applies to the most recent tool+params."""
        tc_a = _make_tool_call("read", {"path": "/a"}, "tc1")
        tc_b = _make_tool_call("read", {"path": "/b"}, "tc2")

        state_a = _make_state([_make_ai_message_with_tool_calls([tc_a])])
        state_b = _make_state([_make_ai_message_with_tool_calls([tc_b])])

        await middleware.aafter_model(state_a, runtime={})
        await middleware.aafter_model(state_b, runtime={})
        await middleware.aafter_model(state_a, runtime={})

        # No consecutive loop since calls alternate
        is_loop, _, _ = middleware._detect_consecutive_loops()
        assert not is_loop
