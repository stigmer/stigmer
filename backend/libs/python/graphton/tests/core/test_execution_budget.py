"""Comprehensive tests for ExecutionBudgetMiddleware.

Covers:
- Constructor validation and defaults
- Internal helpers: _compute_warning_round, _create_budget_warning_message
- abefore_agent hook: per-invocation state reset
- aafter_model hook: round counting, warning injection, single-fire guarantee
- aafter_agent hook: budget stats logging
- Edge cases: tiny recursion limits, custom warning_pct, boundary conditions
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
    ExecutionBudgetMiddleware,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def middleware():
    """Default middleware with platform defaults (limit=1000, warning=80%)."""
    return ExecutionBudgetMiddleware(recursion_limit=1000, warning_pct=80)


@pytest.fixture
def small_budget():
    """Middleware with a very small recursion limit for fast threshold tests."""
    return ExecutionBudgetMiddleware(recursion_limit=60, warning_pct=80)


@pytest.fixture
def high_threshold():
    """Middleware with 90% warning for late-warning tests."""
    return ExecutionBudgetMiddleware(recursion_limit=1000, warning_pct=90)


def _make_state(messages: list | None = None) -> dict:
    """Build a minimal agent state dict."""
    return {"messages": messages or [HumanMessage(content="do something")]}


# =============================================================================
# Constructor validation
# =============================================================================


class TestConstructor:
    def test_defaults(self):
        mw = ExecutionBudgetMiddleware()
        assert mw.recursion_limit == _DEFAULT_RECURSION_LIMIT
        assert mw.warning_pct == _DEFAULT_WARNING_PCT

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
# _compute_warning_round
# =============================================================================


class TestComputeWarningRound:
    def test_default_1000_at_80pct(self):
        # 1000 // 6 = 166 estimated rounds, 166 * 80 // 100 = 132
        result = ExecutionBudgetMiddleware._compute_warning_round(1000, 80)
        assert result == 132

    def test_small_limit_respects_minimum(self):
        """Very small limits should still have a minimum warning round."""
        result = ExecutionBudgetMiddleware._compute_warning_round(4, 80)
        assert result == _MIN_ROUNDS_BEFORE_WARNING

    def test_limit_200_at_80pct(self):
        # 200 // 6 = 33 estimated rounds, 33 * 80 // 100 = 26
        result = ExecutionBudgetMiddleware._compute_warning_round(200, 80)
        assert result == 26

    def test_limit_100_at_90pct(self):
        # 100 // 6 = 16 estimated rounds, 16 * 90 // 100 = 14
        result = ExecutionBudgetMiddleware._compute_warning_round(100, 90)
        assert result == 14

    def test_limit_100_at_50pct(self):
        # 100 // 6 = 16 estimated rounds, 16 * 50 // 100 = 8
        result = ExecutionBudgetMiddleware._compute_warning_round(100, 50)
        assert result == 8

    def test_limit_10_at_80pct(self):
        # 10 // 6 = 1 estimated round, 1 * 80 // 100 = 0, clamped to minimum
        result = ExecutionBudgetMiddleware._compute_warning_round(10, 80)
        assert result == _MIN_ROUNDS_BEFORE_WARNING

    def test_always_at_least_minimum(self):
        """Even with limit=1 and low pct, the floor is respected."""
        result = ExecutionBudgetMiddleware._compute_warning_round(1, 50)
        assert result >= _MIN_ROUNDS_BEFORE_WARNING


# =============================================================================
# _create_budget_warning_message
# =============================================================================


class TestCreateBudgetWarningMessage:
    def test_returns_system_message(self, middleware):
        msg = middleware._create_budget_warning_message()
        assert isinstance(msg, SystemMessage)

    def test_contains_percentage(self, middleware):
        msg = middleware._create_budget_warning_message()
        assert "80%" in msg.content

    def test_contains_remaining_rounds(self, middleware):
        # estimated_total = 1000 // 6 = 166, remaining = 166 - 132 = 34
        middleware._model_round_count = 132
        msg = middleware._create_budget_warning_message()
        assert "~34 rounds remaining" in msg.content

    def test_contains_wrap_up_guidance(self, middleware):
        msg = middleware._create_budget_warning_message()
        assert "Prioritize completing" in msg.content
        assert "Summarize results" in msg.content

    def test_custom_pct_reflected(self, high_threshold):
        msg = high_threshold._create_budget_warning_message()
        assert "90%" in msg.content


# =============================================================================
# Hook: abefore_agent (lifecycle reset)
# =============================================================================


class TestAbeforeAgent:
    async def test_resets_round_count(self, middleware):
        middleware._model_round_count = 42
        result = await middleware.abefore_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 0

    async def test_resets_warned_flag(self, middleware):
        middleware._warned = True
        await middleware.abefore_agent(_make_state(), runtime={})
        assert middleware._warned is False

    async def test_idempotent_on_fresh_instance(self, middleware):
        """Calling abefore_agent on a fresh instance is a no-op."""
        assert middleware._model_round_count == 0
        assert middleware._warned is False
        result = await middleware.abefore_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 0
        assert middleware._warned is False


# =============================================================================
# Hook: aafter_model (round counting + warning injection)
# =============================================================================


class TestAafterModel:
    async def test_increments_round_count(self, middleware):
        await middleware.aafter_model(_make_state(), runtime={})
        assert middleware._model_round_count == 1

    async def test_no_warning_below_threshold(self, middleware):
        """No warning injected when well under budget."""
        for _ in range(10):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None
        assert middleware._model_round_count == 10
        assert middleware._warned is False

    async def test_warning_at_threshold(self, middleware):
        """Warning fires exactly at the warning round."""
        for i in range(middleware._warning_round - 1):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None, f"Unexpected warning at round {i + 1}"

        result = await middleware.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert "messages" in result
        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], SystemMessage)
        assert middleware._warned is True

    async def test_warning_fires_exactly_once(self, middleware):
        """After the first warning, subsequent rounds return None."""
        for _ in range(middleware._warning_round):
            await middleware.aafter_model(_make_state(), runtime={})

        assert middleware._warned is True

        for _ in range(10):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None

    async def test_warning_content_is_system_message(self, middleware):
        """The injected message is a SystemMessage with budget guidance."""
        for _ in range(middleware._warning_round):
            result = await middleware.aafter_model(_make_state(), runtime={})

        msg = result["messages"][0]
        assert "step limit" in msg.content
        assert "Summarize results" in msg.content

    async def test_default_warning_at_round_132(self, middleware):
        """With limit=1000 and pct=80, warning fires at round 132."""
        assert middleware._warning_round == 132

        for i in range(131):
            result = await middleware.aafter_model(_make_state(), runtime={})
            assert result is None, f"Early warning at round {i + 1}"

        result = await middleware.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert middleware._model_round_count == 132

    async def test_small_budget_warning(self, small_budget):
        """With limit=60, warning fires at round 8 (60//6 * 80//100 = 8)."""
        assert small_budget._warning_round == 8

        for _ in range(7):
            result = await small_budget.aafter_model(_make_state(), runtime={})
            assert result is None

        result = await small_budget.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert small_budget._model_round_count == 8

    async def test_high_threshold_warning(self, high_threshold):
        """With limit=1000 and pct=90, warning fires at round 149."""
        assert high_threshold._warning_round == 149

        for _ in range(148):
            result = await high_threshold.aafter_model(_make_state(), runtime={})
            assert result is None

        result = await high_threshold.aafter_model(_make_state(), runtime={})
        assert result is not None
        assert high_threshold._model_round_count == 149


# =============================================================================
# Hook: aafter_agent (budget stats)
# =============================================================================


class TestAafterAgent:
    async def test_returns_none(self, middleware):
        """aafter_agent only logs — never modifies state."""
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None

    async def test_logs_after_partial_usage(self, middleware):
        """Stats reflect actual usage when execution finishes under budget."""
        for _ in range(15):
            await middleware.aafter_model(_make_state(), runtime={})
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 15
        assert middleware._warned is False

    async def test_logs_after_warning_fired(self, middleware):
        for _ in range(middleware._warning_round):
            await middleware.aafter_model(_make_state(), runtime={})
        result = await middleware.aafter_agent(_make_state(), runtime={})
        assert result is None
        assert middleware._warned is True


# =============================================================================
# Multi-invocation lifecycle
# =============================================================================


class TestMultiInvocationLifecycle:
    async def test_reset_between_invocations(self, middleware):
        """abefore_agent resets state so each invocation starts fresh."""
        for _ in range(middleware._warning_round):
            await middleware.aafter_model(_make_state(), runtime={})
        assert middleware._warned is True
        assert middleware._model_round_count == middleware._warning_round

        await middleware.abefore_agent(_make_state(), runtime={})

        assert middleware._model_round_count == 0
        assert middleware._warned is False

        result = await middleware.aafter_model(_make_state(), runtime={})
        assert result is None
        assert middleware._model_round_count == 1

    async def test_warning_fires_again_after_reset(self, middleware):
        """Warning can fire again in a subsequent invocation."""
        for _ in range(middleware._warning_round):
            await middleware.aafter_model(_make_state(), runtime={})
        assert middleware._warned is True

        await middleware.abefore_agent(_make_state(), runtime={})

        for _ in range(middleware._warning_round):
            result = await middleware.aafter_model(_make_state(), runtime={})

        assert result is not None
        assert middleware._warned is True


# =============================================================================
# Edge cases
# =============================================================================


class TestEdgeCases:
    async def test_minimum_recursion_limit(self):
        """With recursion_limit=1, warning_round is clamped to minimum."""
        mw = ExecutionBudgetMiddleware(recursion_limit=1, warning_pct=80)
        assert mw._warning_round == _MIN_ROUNDS_BEFORE_WARNING

    async def test_very_large_recursion_limit(self):
        """Large limits produce proportionally large warning rounds."""
        # 6000 // 6 = 1000 estimated rounds, 1000 * 80 // 100 = 800
        mw = ExecutionBudgetMiddleware(recursion_limit=6000, warning_pct=80)
        assert mw._warning_round == 800

    async def test_remaining_rounds_never_negative(self, middleware):
        """If model_round_count exceeds estimate, remaining is clamped to 0."""
        middleware._model_round_count = 999
        msg = middleware._create_budget_warning_message()
        assert "~0 rounds remaining" in msg.content
