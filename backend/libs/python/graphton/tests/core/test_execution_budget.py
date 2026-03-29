"""Comprehensive tests for ExecutionBudgetMiddleware.

Covers both operating modes:

**Threshold mode** (default):
- Constructor validation and defaults
- Internal helpers: _compute_warning_round, _create_threshold_warning
- abefore_agent hook: per-invocation state reset
- awrap_model_call hook: round counting, advisory queuing, input injection
- aafter_agent hook: budget stats logging
- Edge cases: tiny recursion limits, custom warning_pct, boundary conditions

**Periodic mode** (warning_interval set):
- Constructor validation for periodic parameters
- Periodic advisory injection at every N rounds
- Escalating message urgency
- max_warnings cap
- State reset between invocations

**Message ordering safety**:
- Advisory is prepended to the NEXT model call's input, never appended to
  the current call's output — ensuring no SystemMessage lands between
  AIMessage(tool_use) and ToolMessage(tool_result) in the LangGraph state.
"""

from __future__ import annotations

import dataclasses

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from graphton.core.execution_budget import (
    _DEFAULT_RECURSION_LIMIT,
    _DEFAULT_WARNING_PCT,
    _MAX_WARNING_PCT,
    _MIN_ROUNDS_BEFORE_WARNING,
    _MIN_WARNING_PCT,
    _PERIODIC_MESSAGES,
    ExecutionBudgetMiddleware,
)

# =============================================================================
# Test helpers
# =============================================================================


@dataclasses.dataclass
class _FakeModelRequest:
    """Minimal stand-in for ModelRequest used in awrap_model_call tests."""
    messages: list


@dataclasses.dataclass
class _FakeModelResponse:
    """Minimal stand-in for ModelResponse."""
    result: list


def _make_request(messages: list | None = None) -> _FakeModelRequest:
    return _FakeModelRequest(
        messages=messages or [HumanMessage(content="do something")],
    )


def _make_response() -> _FakeModelResponse:
    return _FakeModelResponse(result=[AIMessage(content="I did it")])


async def _mock_handler(request: _FakeModelRequest) -> _FakeModelResponse:
    """Async handler that returns a canned model response."""
    return _make_response()


def _make_state(messages: list | None = None) -> dict:
    """Build a minimal agent state dict."""
    return {"messages": messages or [HumanMessage(content="do something")]}


async def _simulate_rounds(
    mw: ExecutionBudgetMiddleware, n: int
) -> list[_FakeModelResponse]:
    """Call awrap_model_call n times and return all responses."""
    responses = []
    for _ in range(n):
        resp = await mw.awrap_model_call(_make_request(), _mock_handler)
        responses.append(resp)
    return responses


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def middleware():
    """Default middleware with platform defaults (limit=6000, warning=80%)."""
    return ExecutionBudgetMiddleware(recursion_limit=6000, warning_pct=80)


@pytest.fixture
def small_budget():
    """Middleware with a very small recursion limit for fast threshold tests."""
    return ExecutionBudgetMiddleware(recursion_limit=60, warning_pct=80)


@pytest.fixture
def high_threshold():
    """Middleware with 90% warning for late-warning tests."""
    return ExecutionBudgetMiddleware(recursion_limit=6000, warning_pct=90)


@pytest.fixture
def periodic():
    """Middleware in periodic mode (interval=30, max_warnings=4)."""
    return ExecutionBudgetMiddleware(warning_interval=30, max_warnings=4)


@pytest.fixture
def periodic_small():
    """Periodic middleware with small interval for fast iteration tests."""
    return ExecutionBudgetMiddleware(warning_interval=5, max_warnings=3)


# =============================================================================
# Constructor validation — threshold mode
# =============================================================================


class TestConstructorThreshold:
    def test_defaults(self):
        mw = ExecutionBudgetMiddleware()
        assert mw.recursion_limit == _DEFAULT_RECURSION_LIMIT
        assert mw.warning_pct == _DEFAULT_WARNING_PCT
        assert mw._periodic is False

    def test_custom_values(self):
        mw = ExecutionBudgetMiddleware(recursion_limit=200, warning_pct=90)
        assert mw.recursion_limit == 200
        assert mw.warning_pct == 90

    def test_warning_pct_below_min_raises(self):
        with pytest.raises(ValueError, match="warning_pct must be between"):
            ExecutionBudgetMiddleware(warning_pct=_MIN_WARNING_PCT - 1)

    def test_warning_pct_above_max_raises(self):
        with pytest.raises(ValueError, match="warning_pct must be between"):
            ExecutionBudgetMiddleware(warning_pct=_MAX_WARNING_PCT + 1)

    def test_warning_pct_at_min_boundary(self):
        mw = ExecutionBudgetMiddleware(warning_pct=_MIN_WARNING_PCT)
        assert mw.warning_pct == _MIN_WARNING_PCT

    def test_warning_pct_at_max_boundary(self):
        mw = ExecutionBudgetMiddleware(warning_pct=_MAX_WARNING_PCT)
        assert mw.warning_pct == _MAX_WARNING_PCT

    def test_zero_recursion_limit_raises(self):
        with pytest.raises(ValueError, match="recursion_limit must be positive"):
            ExecutionBudgetMiddleware(recursion_limit=0)

    def test_negative_recursion_limit_raises(self):
        with pytest.raises(ValueError, match="recursion_limit must be positive"):
            ExecutionBudgetMiddleware(recursion_limit=-5)

    def test_pending_advisory_initialized_to_none(self):
        mw = ExecutionBudgetMiddleware()
        assert mw._pending_advisory is None


# =============================================================================
# Constructor validation — periodic mode
# =============================================================================


class TestConstructorPeriodic:
    def test_basic_construction(self):
        mw = ExecutionBudgetMiddleware(warning_interval=30, max_warnings=4)
        assert mw._periodic is True
        assert mw.warning_interval == 30
        assert mw.max_warnings == 4

    def test_zero_interval_raises(self):
        with pytest.raises(ValueError, match="warning_interval must be positive"):
            ExecutionBudgetMiddleware(warning_interval=0)

    def test_negative_interval_raises(self):
        with pytest.raises(ValueError, match="warning_interval must be positive"):
            ExecutionBudgetMiddleware(warning_interval=-10)

    def test_zero_max_warnings_raises(self):
        with pytest.raises(ValueError, match="max_warnings must be positive"):
            ExecutionBudgetMiddleware(warning_interval=30, max_warnings=0)

    def test_negative_max_warnings_raises(self):
        with pytest.raises(ValueError, match="max_warnings must be positive"):
            ExecutionBudgetMiddleware(warning_interval=30, max_warnings=-1)

    def test_warning_pct_ignored_in_periodic_mode(self):
        """warning_pct validation is skipped in periodic mode."""
        mw = ExecutionBudgetMiddleware(warning_interval=30, warning_pct=10)
        assert mw._periodic is True

    def test_recursion_limit_ignored_in_periodic_mode(self):
        """recursion_limit validation is skipped in periodic mode."""
        mw = ExecutionBudgetMiddleware(warning_interval=30, recursion_limit=-1)
        assert mw._periodic is True


# =============================================================================
# _compute_warning_round (threshold mode only)
# =============================================================================


class TestComputeWarningRound:
    def test_default_6000_at_80pct(self):
        result = ExecutionBudgetMiddleware._compute_warning_round(6000, 80)
        assert result == 800

    def test_small_limit_respects_minimum(self):
        result = ExecutionBudgetMiddleware._compute_warning_round(4, 80)
        assert result == _MIN_ROUNDS_BEFORE_WARNING

    def test_limit_200_at_80pct(self):
        result = ExecutionBudgetMiddleware._compute_warning_round(200, 80)
        assert result == 26

    def test_limit_100_at_90pct(self):
        result = ExecutionBudgetMiddleware._compute_warning_round(100, 90)
        assert result == 14

    def test_limit_100_at_50pct(self):
        result = ExecutionBudgetMiddleware._compute_warning_round(100, 50)
        assert result == 8

    def test_limit_10_at_80pct(self):
        result = ExecutionBudgetMiddleware._compute_warning_round(10, 80)
        assert result == _MIN_ROUNDS_BEFORE_WARNING

    def test_always_at_least_minimum(self):
        result = ExecutionBudgetMiddleware._compute_warning_round(1, 50)
        assert result >= _MIN_ROUNDS_BEFORE_WARNING


# =============================================================================
# _create_threshold_warning (threshold mode)
# =============================================================================


class TestCreateThresholdWarning:
    def test_returns_system_message(self, middleware):
        msg = middleware._create_threshold_warning()
        assert isinstance(msg, SystemMessage)

    def test_contains_percentage(self, middleware):
        msg = middleware._create_threshold_warning()
        assert "80%" in msg.content

    def test_contains_remaining_rounds(self, middleware):
        middleware._model_round_count = 800
        msg = middleware._create_threshold_warning()
        assert "~200 rounds remaining" in msg.content

    def test_contains_wrap_up_guidance(self, middleware):
        msg = middleware._create_threshold_warning()
        assert "Prioritize completing" in msg.content
        assert "Summarize results" in msg.content

    def test_custom_pct_reflected(self, high_threshold):
        msg = high_threshold._create_threshold_warning()
        assert "90%" in msg.content


# =============================================================================
# _create_periodic_warning (periodic mode)
# =============================================================================


class TestCreatePeriodicWarning:
    def test_returns_system_message(self, periodic):
        periodic._model_round_count = 30
        periodic._warning_count = 1
        msg = periodic._create_periodic_warning()
        assert isinstance(msg, SystemMessage)

    def test_first_warning_content(self, periodic):
        periodic._model_round_count = 30
        periodic._warning_count = 1
        msg = periodic._create_periodic_warning()
        assert "30 model rounds" in msg.content
        assert "wrapping up" in msg.content.lower() or "nearing completion" in msg.content.lower()

    def test_second_warning_escalates(self, periodic):
        periodic._model_round_count = 60
        periodic._warning_count = 2
        msg = periodic._create_periodic_warning()
        assert "60 model rounds" in msg.content
        assert "Prioritize" in msg.content

    def test_third_warning_escalates_further(self, periodic):
        periodic._model_round_count = 90
        periodic._warning_count = 3
        msg = periodic._create_periodic_warning()
        assert "90 model rounds" in msg.content
        assert "Wrap up" in msg.content

    def test_fourth_warning_is_critical(self, periodic):
        periodic._model_round_count = 120
        periodic._warning_count = 4
        msg = periodic._create_periodic_warning()
        assert "120 model rounds" in msg.content
        assert "Critical" in msg.content or "final answer" in msg.content

    def test_warning_count_beyond_messages_uses_last(self, periodic):
        """When warning_count exceeds message templates, the last template is used."""
        periodic._model_round_count = 150
        periodic._warning_count = len(_PERIODIC_MESSAGES) + 5
        msg = periodic._create_periodic_warning()
        assert "150 model rounds" in msg.content


# =============================================================================
# Hook: abefore_agent (lifecycle reset)
# =============================================================================


class TestAbeforeAgent:
    async def test_resets_round_count(self, middleware):
        middleware._model_round_count = 42
        result = await middleware.abefore_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 0

    async def test_resets_warning_count(self, middleware):
        middleware._warning_count = 1
        await middleware.abefore_agent(_make_state(), runtime={})
        assert middleware._warning_count == 0

    async def test_resets_pending_advisory(self, middleware):
        middleware._pending_advisory = SystemMessage(content="stale advisory")
        await middleware.abefore_agent(_make_state(), runtime={})
        assert middleware._pending_advisory is None

    async def test_idempotent_on_fresh_instance(self, middleware):
        assert middleware._model_round_count == 0
        assert middleware._warning_count == 0
        assert middleware._pending_advisory is None
        result = await middleware.abefore_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 0
        assert middleware._warning_count == 0
        assert middleware._pending_advisory is None

    async def test_periodic_resets_next_warning_round(self, periodic):
        """Periodic mode resets _next_warning_round to the interval."""
        periodic._next_warning_round = 999
        periodic._warning_count = 3
        await periodic.abefore_agent(_make_state(), runtime={})
        assert periodic._next_warning_round == 30
        assert periodic._warning_count == 0


# =============================================================================
# Hook: awrap_model_call — threshold mode
# =============================================================================


class TestAwrapModelCallThreshold:
    async def test_increments_round_count(self, middleware):
        await middleware.awrap_model_call(_make_request(), _mock_handler)
        assert middleware._model_round_count == 1

    async def test_no_advisory_below_threshold(self, middleware):
        for _ in range(10):
            await middleware.awrap_model_call(_make_request(), _mock_handler)
        assert middleware._model_round_count == 10
        assert middleware._warning_count == 0
        assert middleware._pending_advisory is None

    async def test_advisory_queued_at_threshold_round(self, middleware):
        """After reaching the warning round, advisory is queued for the NEXT call."""
        await _simulate_rounds(middleware, middleware._next_warning_round)
        assert middleware._warning_count == 1
        assert middleware._pending_advisory is not None
        assert isinstance(middleware._pending_advisory, SystemMessage)

    async def test_advisory_prepended_to_next_call_input(self, middleware):
        """The queued advisory is prepended to the next model call's messages."""
        await _simulate_rounds(middleware, middleware._next_warning_round)

        captured_request = None

        async def capturing_handler(request):
            nonlocal captured_request
            captured_request = request
            return _make_response()

        await middleware.awrap_model_call(_make_request(), capturing_handler)

        assert captured_request is not None
        last_msg = captured_request.messages[-1]
        assert isinstance(last_msg, SystemMessage)
        assert "step limit" in last_msg.content

    async def test_advisory_consumed_after_delivery(self, middleware):
        """After delivering the advisory, _pending_advisory is cleared."""
        await _simulate_rounds(middleware, middleware._next_warning_round)
        assert middleware._pending_advisory is not None

        await middleware.awrap_model_call(_make_request(), _mock_handler)
        assert middleware._pending_advisory is None

    async def test_handler_called_exactly_once_per_wrap(self, middleware):
        call_count = 0

        async def counting_handler(request):
            nonlocal call_count
            call_count += 1
            return _make_response()

        await middleware.awrap_model_call(_make_request(), counting_handler)
        assert call_count == 1

    async def test_advisory_fires_exactly_once(self, middleware):
        """Threshold mode produces exactly one advisory."""
        await _simulate_rounds(middleware, middleware._next_warning_round)
        assert middleware._warning_count == 1

        for _ in range(10):
            await middleware.awrap_model_call(_make_request(), _mock_handler)

        assert middleware._warning_count == 1

    async def test_no_state_mutation_on_handler_output(self, middleware):
        """awrap_model_call returns the handler's response unchanged."""
        response = await middleware.awrap_model_call(_make_request(), _mock_handler)
        assert isinstance(response, _FakeModelResponse)
        assert len(response.result) == 1
        assert isinstance(response.result[0], AIMessage)

    async def test_default_warning_at_round_800(self, middleware):
        assert middleware._next_warning_round == 800

        await _simulate_rounds(middleware, 799)
        assert middleware._warning_count == 0
        assert middleware._pending_advisory is None

        await middleware.awrap_model_call(_make_request(), _mock_handler)
        assert middleware._model_round_count == 800
        assert middleware._warning_count == 1
        assert middleware._pending_advisory is not None

    async def test_small_budget_warning(self, small_budget):
        assert small_budget._next_warning_round == 8

        await _simulate_rounds(small_budget, 7)
        assert small_budget._pending_advisory is None

        await small_budget.awrap_model_call(_make_request(), _mock_handler)
        assert small_budget._model_round_count == 8
        assert small_budget._pending_advisory is not None

    async def test_high_threshold_warning(self, high_threshold):
        assert high_threshold._next_warning_round == 900

        await _simulate_rounds(high_threshold, 899)
        assert high_threshold._pending_advisory is None

        await high_threshold.awrap_model_call(_make_request(), _mock_handler)
        assert high_threshold._model_round_count == 900
        assert high_threshold._pending_advisory is not None


# =============================================================================
# Hook: awrap_model_call — periodic mode
# =============================================================================


class TestAwrapModelCallPeriodic:
    async def test_first_advisory_at_interval(self, periodic_small):
        """First advisory queued at exactly warning_interval rounds."""
        await _simulate_rounds(periodic_small, 4)
        assert periodic_small._pending_advisory is None

        await periodic_small.awrap_model_call(_make_request(), _mock_handler)
        assert periodic_small._warning_count == 1
        assert periodic_small._pending_advisory is not None

    async def test_second_advisory_at_double_interval(self, periodic_small):
        """Second advisory queued at 2 * interval."""
        await _simulate_rounds(periodic_small, 10)
        assert periodic_small._warning_count == 2
        assert periodic_small._model_round_count == 10

    async def test_three_advisories_at_three_intervals(self, periodic_small):
        """All three allowed advisories queue at 5, 10, 15."""
        advisory_rounds = []
        for i in range(15):
            old_count = periodic_small._warning_count
            await periodic_small.awrap_model_call(_make_request(), _mock_handler)
            if periodic_small._warning_count > old_count:
                advisory_rounds.append(periodic_small._model_round_count)
        assert advisory_rounds == [5, 10, 15]
        assert periodic_small._warning_count == 3

    async def test_stops_after_max_warnings(self, periodic_small):
        """No more advisories after max_warnings is reached."""
        await _simulate_rounds(periodic_small, 15)
        assert periodic_small._warning_count == 3

        for _ in range(20):
            periodic_small._pending_advisory = None
            await periodic_small.awrap_model_call(_make_request(), _mock_handler)
            assert periodic_small._pending_advisory is None

    async def test_escalating_messages_delivered_to_handler(self, periodic_small):
        """Each successive advisory uses a different (escalating) message template."""
        delivered = []
        for i in range(16):
            captured = None

            async def capturing_handler(request, _captured=captured):
                for msg in request.messages:
                    if isinstance(msg, SystemMessage):
                        delivered.append(msg.content)
                return _make_response()

            await periodic_small.awrap_model_call(_make_request(), capturing_handler)

        assert len(delivered) == 3
        assert delivered[0] != delivered[1]
        assert delivered[1] != delivered[2]

    async def test_periodic_with_30_interval(self, periodic):
        """Standard sub-agent config: interval=30, max=4 fires at 30,60,90,120."""
        advisory_rounds = []
        for _ in range(150):
            old_count = periodic._warning_count
            await periodic.awrap_model_call(_make_request(), _mock_handler)
            if periodic._warning_count > old_count:
                advisory_rounds.append(periodic._model_round_count)
        assert advisory_rounds == [30, 60, 90, 120]


# =============================================================================
# Message ordering safety (the core bug fix)
# =============================================================================


class TestMessageOrderingSafety:
    async def test_no_messages_injected_into_handler_output(self, periodic_small):
        """awrap_model_call never injects messages into the ModelResponse.

        The old aafter_model hook returned {"messages": [SystemMessage(...)]}
        which LangGraph merged into the model node output, breaking the
        AIMessage(tool_use) -> ToolMessage(tool_result) ordering.

        The new awrap_model_call ONLY modifies the handler's INPUT request.
        """
        for _ in range(15):
            response = await periodic_small.awrap_model_call(
                _make_request(), _mock_handler,
            )
            assert isinstance(response, _FakeModelResponse)
            assert response.result == [AIMessage(content="I did it")]

    async def test_advisory_appears_in_input_not_output(self, periodic_small):
        """Advisory is prepended to request.messages, not appended to response."""
        await _simulate_rounds(periodic_small, 5)
        assert periodic_small._pending_advisory is not None

        input_had_advisory = False
        output_had_advisory = False

        async def inspecting_handler(request):
            nonlocal input_had_advisory
            for msg in request.messages:
                if isinstance(msg, SystemMessage):
                    input_had_advisory = True
            return _make_response()

        response = await periodic_small.awrap_model_call(
            _make_request(), inspecting_handler,
        )

        for msg in response.result:
            if isinstance(msg, SystemMessage):
                output_had_advisory = True

        assert input_had_advisory is True
        assert output_had_advisory is False

    async def test_original_request_messages_preserved(self, periodic_small):
        """The advisory is appended alongside original messages, not replacing."""
        await _simulate_rounds(periodic_small, 5)

        original_messages = [HumanMessage(content="hello")]

        async def inspecting_handler(request):
            assert request.messages[0].content == "hello"
            assert len(request.messages) == 2
            assert isinstance(request.messages[1], SystemMessage)
            return _make_response()

        await periodic_small.awrap_model_call(
            _make_request(messages=original_messages), inspecting_handler,
        )


# =============================================================================
# Hook: aafter_agent (budget stats)
# =============================================================================


class TestAafterAgent:
    async def test_returns_none_threshold(self, middleware):
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None

    async def test_returns_none_periodic(self, periodic):
        result = await periodic.aafter_agent(_make_state(), runtime={})
        assert result is None

    async def test_logs_after_partial_usage(self, middleware):
        await _simulate_rounds(middleware, 15)
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 15
        assert middleware._warning_count == 0

    async def test_logs_after_warning_fired(self, middleware):
        await _simulate_rounds(middleware, middleware._next_warning_round)
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._warning_count == 1


# =============================================================================
# Multi-invocation lifecycle
# =============================================================================


class TestMultiInvocationLifecycle:
    async def test_reset_between_invocations_threshold(self, middleware):
        await _simulate_rounds(middleware, middleware._next_warning_round)
        assert middleware._warning_count == 1
        assert middleware._model_round_count == middleware._next_warning_round

        await middleware.abefore_agent(_make_state(), runtime={})

        assert middleware._model_round_count == 0
        assert middleware._warning_count == 0
        assert middleware._pending_advisory is None

        await middleware.awrap_model_call(_make_request(), _mock_handler)
        assert middleware._model_round_count == 1

    async def test_warning_fires_again_after_reset_threshold(self, middleware):
        await _simulate_rounds(middleware, middleware._next_warning_round)
        assert middleware._warning_count == 1

        await middleware.abefore_agent(_make_state(), runtime={})
        await _simulate_rounds(middleware, middleware._next_warning_round)

        assert middleware._warning_count == 1
        assert middleware._pending_advisory is not None

    async def test_reset_between_invocations_periodic(self, periodic_small):
        """Periodic mode resets fully between invocations."""
        await _simulate_rounds(periodic_small, 15)
        assert periodic_small._warning_count == 3

        await periodic_small.abefore_agent(_make_state(), runtime={})

        assert periodic_small._model_round_count == 0
        assert periodic_small._warning_count == 0
        assert periodic_small._next_warning_round == 5
        assert periodic_small._pending_advisory is None

    async def test_periodic_warnings_fire_again_after_reset(self, periodic_small):
        """All periodic advisories fire again in a new invocation."""
        await _simulate_rounds(periodic_small, 15)
        assert periodic_small._warning_count == 3

        await periodic_small.abefore_agent(_make_state(), runtime={})

        advisory_count = 0
        for _ in range(15):
            old = periodic_small._warning_count
            await periodic_small.awrap_model_call(_make_request(), _mock_handler)
            if periodic_small._warning_count > old:
                advisory_count += 1
        assert advisory_count == 3


# =============================================================================
# Edge cases
# =============================================================================


class TestEdgeCases:
    async def test_minimum_recursion_limit(self):
        mw = ExecutionBudgetMiddleware(recursion_limit=1, warning_pct=80)
        assert mw._next_warning_round == _MIN_ROUNDS_BEFORE_WARNING

    async def test_very_large_recursion_limit(self):
        mw = ExecutionBudgetMiddleware(recursion_limit=30000, warning_pct=80)
        assert mw._next_warning_round == 4000

    async def test_remaining_rounds_never_negative(self, middleware):
        middleware._model_round_count = 9999
        msg = middleware._create_threshold_warning()
        assert "~0 rounds remaining" in msg.content

    async def test_periodic_with_max_warnings_1(self):
        """Single-shot periodic mode."""
        mw = ExecutionBudgetMiddleware(warning_interval=10, max_warnings=1)
        await _simulate_rounds(mw, 10)
        assert mw._warning_count == 1
        assert mw._pending_advisory is not None

        mw._pending_advisory = None
        for _ in range(30):
            await mw.awrap_model_call(_make_request(), _mock_handler)
            assert mw._pending_advisory is None

    async def test_handler_exception_does_not_increment_round(self, middleware):
        """If the handler raises, the round counter should NOT be incremented."""
        async def failing_handler(request):
            raise RuntimeError("model exploded")

        with pytest.raises(RuntimeError, match="model exploded"):
            await middleware.awrap_model_call(_make_request(), failing_handler)

        assert middleware._model_round_count == 0
