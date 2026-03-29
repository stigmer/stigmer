"""Comprehensive tests for ExecutionBudgetMiddleware.

Covers both operating modes:

**Threshold mode** (default):
- Constructor validation and defaults
- Internal helpers: _compute_warning_round, _create_threshold_warning
- abefore_agent hook: per-invocation state reset
- aafter_model hook: round counting, warning injection, single-fire guarantee
- aafter_agent hook: budget stats logging
- Edge cases: tiny recursion limits, custom warning_pct, boundary conditions

**Periodic mode** (warning_interval set):
- Constructor validation for periodic parameters
- Periodic warning injection at every N rounds
- Escalating message urgency
- max_warnings cap
- State reset between invocations
"""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage, SystemMessage

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


def _make_state(messages: list | None = None) -> dict:
    """Build a minimal agent state dict."""
    return {"messages": messages or [HumanMessage(content="do something")]}


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

    async def test_idempotent_on_fresh_instance(self, middleware):
        assert middleware._model_round_count == 0
        assert middleware._warning_count == 0
        result = await middleware.abefore_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 0
        assert middleware._warning_count == 0

    async def test_periodic_resets_next_warning_round(self, periodic):
        """Periodic mode resets _next_warning_round to the interval."""
        periodic._next_warning_round = 999
        periodic._warning_count = 3
        await periodic.abefore_agent(_make_state(), runtime={})
        assert periodic._next_warning_round == 30
        assert periodic._warning_count == 0


# =============================================================================
# Hook: aafter_model — threshold mode
# =============================================================================


class TestAafterModelThreshold:
    async def test_increments_round_count(self, middleware):
        await middleware.aafter_model(_make_state(), runtime={})
        assert middleware._model_round_count == 1

    async def test_no_warning_below_threshold(self, middleware):
        for _ in range(10):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None
        assert middleware._model_round_count == 10
        assert middleware._warning_count == 0

    async def test_warning_at_threshold(self, middleware):
        for i in range(middleware._next_warning_round - 1):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None, f"Unexpected warning at round {i + 1}"

        result = await middleware.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert "messages" in result
        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], SystemMessage)
        assert middleware._warning_count == 1

    async def test_warning_fires_exactly_once(self, middleware):
        for _ in range(middleware._next_warning_round):
            await middleware.aafter_model(_make_state(), runtime={})

        assert middleware._warning_count == 1

        for _ in range(10):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None

    async def test_warning_content_is_system_message(self, middleware):
        for _ in range(middleware._next_warning_round):
            result = await middleware.aafter_model(_make_state(), runtime={})

        msg = result["messages"][0]
        assert "step limit" in msg.content
        assert "Summarize results" in msg.content

    async def test_default_warning_at_round_800(self, middleware):
        assert middleware._next_warning_round == 800

        for i in range(799):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None, f"Early warning at round {i + 1}"

        result = await middleware.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert middleware._model_round_count == 800

    async def test_small_budget_warning(self, small_budget):
        assert small_budget._next_warning_round == 8

        for _ in range(7):
            result = await small_budget.aafter_model(_make_state(), runtime={})
            assert result is None

        result = await small_budget.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert small_budget._model_round_count == 8

    async def test_high_threshold_warning(self, high_threshold):
        assert high_threshold._next_warning_round == 900

        for _ in range(899):
            result = await high_threshold.aafter_model(_make_state(), runtime={})
            assert result is None

        result = await high_threshold.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert high_threshold._model_round_count == 900


# =============================================================================
# Hook: aafter_model — periodic mode
# =============================================================================


class TestAafterModelPeriodic:
    async def test_first_warning_at_interval(self, periodic_small):
        """First warning fires at exactly warning_interval rounds."""
        for _ in range(4):
            result = await periodic_small.aafter_model(_make_state(), runtime={})
            assert result is None

        result = await periodic_small.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert isinstance(result["messages"][0], SystemMessage)
        assert periodic_small._warning_count == 1

    async def test_second_warning_at_double_interval(self, periodic_small):
        """Second warning fires at 2 * interval."""
        for i in range(10):
            result = await periodic_small.aafter_model(_make_state(), runtime={})
        assert periodic_small._warning_count == 2
        assert periodic_small._model_round_count == 10

    async def test_three_warnings_at_three_intervals(self, periodic_small):
        """All three allowed warnings fire at 5, 10, 15."""
        warnings_fired = 0
        for i in range(15):
            result = await periodic_small.aafter_model(_make_state(), runtime={})
            if result is not None:
                warnings_fired += 1
        assert warnings_fired == 3
        assert periodic_small._warning_count == 3

    async def test_stops_after_max_warnings(self, periodic_small):
        """No more warnings after max_warnings is reached."""
        for _ in range(15):
            await periodic_small.aafter_model(_make_state(), runtime={})
        assert periodic_small._warning_count == 3

        for _ in range(20):
            result = await periodic_small.aafter_model(_make_state(), runtime={})
            assert result is None

    async def test_escalating_messages(self, periodic_small):
        """Each successive warning uses a different (escalating) message template."""
        messages = []
        for _ in range(15):
            result = await periodic_small.aafter_model(_make_state(), runtime={})
            if result is not None:
                messages.append(result["messages"][0].content)

        assert len(messages) == 3
        assert messages[0] != messages[1]
        assert messages[1] != messages[2]

    async def test_periodic_with_30_interval(self, periodic):
        """Standard sub-agent config: interval=30, max=4 fires at 30,60,90,120."""
        warning_rounds = []
        for i in range(150):
            result = await periodic.aafter_model(_make_state(), runtime={})
            if result is not None:
                warning_rounds.append(periodic._model_round_count)
        assert warning_rounds == [30, 60, 90, 120]


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
        for _ in range(15):
            await middleware.aafter_model(_make_state(), runtime={})
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 15
        assert middleware._warning_count == 0

    async def test_logs_after_warning_fired(self, middleware):
        for _ in range(middleware._next_warning_round):
            await middleware.aafter_model(_make_state(), runtime={})
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._warning_count == 1


# =============================================================================
# Multi-invocation lifecycle
# =============================================================================


class TestMultiInvocationLifecycle:
    async def test_reset_between_invocations_threshold(self, middleware):
        for _ in range(middleware._next_warning_round):
            await middleware.aafter_model(_make_state(), runtime={})
        assert middleware._warning_count == 1
        assert middleware._model_round_count == middleware._next_warning_round

        await middleware.abefore_agent(_make_state(), runtime={})

        assert middleware._model_round_count == 0
        assert middleware._warning_count == 0

        result = await middleware.aafter_model(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 1

    async def test_warning_fires_again_after_reset_threshold(self, middleware):
        for _ in range(middleware._next_warning_round):
            await middleware.aafter_model(_make_state(), runtime={})
        assert middleware._warning_count == 1

        await middleware.abefore_agent(_make_state(), runtime={})

        for _ in range(middleware._next_warning_round):
            result = await middleware.aafter_model(_make_state(), runtime={})

        assert result is not None
        assert middleware._warning_count == 1

    async def test_reset_between_invocations_periodic(self, periodic_small):
        """Periodic mode resets fully between invocations."""
        for _ in range(15):
            await periodic_small.aafter_model(_make_state(), runtime={})
        assert periodic_small._warning_count == 3

        await periodic_small.abefore_agent(_make_state(), runtime={})

        assert periodic_small._model_round_count == 0
        assert periodic_small._warning_count == 0
        assert periodic_small._next_warning_round == 5

    async def test_periodic_warnings_fire_again_after_reset(self, periodic_small):
        """All periodic warnings fire again in a new invocation."""
        for _ in range(15):
            await periodic_small.aafter_model(_make_state(), runtime={})
        assert periodic_small._warning_count == 3

        await periodic_small.abefore_agent(_make_state(), runtime={})

        warning_count = 0
        for _ in range(15):
            result = await periodic_small.aafter_model(_make_state(), runtime={})
            if result is not None:
                warning_count += 1
        assert warning_count == 3


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
        for _ in range(10):
            result = await mw.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert mw._warning_count == 1

        for _ in range(30):
            result = await mw.aafter_model(_make_state(), runtime={})
            assert result is None
