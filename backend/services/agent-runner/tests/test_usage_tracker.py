"""Unit tests for UsageTracker.

Tests cover:
- _compute_call_cost: pure cost computation with disjoint token buckets
- record_llm_call: LlmCallMetrics construction, total_tokens, sequencing
- get_estimated_cost / get_llm_call_count: running aggregates
- Sub-agent scoping: main vs sub-agent metrics isolation
- Unknown model: falls back to defaults, zero pricing = zero cost
"""

from __future__ import annotations

import pytest

from stigmer_runner.worker.activities.graphton.usage_tracker import (
    MAIN_SCOPE,
    UsageTracker,
    _compute_call_cost,
    _resolve_metadata,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tracker() -> UsageTracker:
    return UsageTracker(execution_id="test-exec-001")


# ---------------------------------------------------------------------------
# _compute_call_cost
# ---------------------------------------------------------------------------


class TestComputeCallCost:
    """Tests for the pure cost computation function."""

    def test_all_zero_tokens(self):
        metadata = _resolve_metadata("claude-sonnet-4.6")
        cost = _compute_call_cost(
            input_tokens=0,
            output_tokens=0,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            metadata=metadata,
        )
        assert cost == 0.0

    def test_input_only(self):
        metadata = _resolve_metadata("claude-sonnet-4.6")
        cost = _compute_call_cost(
            input_tokens=1_000_000,
            output_tokens=0,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            metadata=metadata,
        )
        assert cost == pytest.approx(metadata.input_price_per_million)

    def test_four_buckets(self):
        metadata = _resolve_metadata("claude-sonnet-4.6")
        cost = _compute_call_cost(
            input_tokens=100_000,
            output_tokens=50_000,
            cache_creation_tokens=20_000,
            cache_read_tokens=80_000,
            metadata=metadata,
        )
        expected = (
            100_000 * metadata.input_price_per_million
            + 50_000 * metadata.output_price_per_million
            + 20_000 * metadata.cache_creation_price_per_million
            + 80_000 * metadata.cache_read_price_per_million
        ) / 1_000_000
        assert cost == pytest.approx(expected)


# ---------------------------------------------------------------------------
# Single LLM call
# ---------------------------------------------------------------------------


class TestSingleLlmCall:
    """Tests for recording a single LLM call."""

    def test_returns_llm_call_metrics(self, tracker: UsageTracker):
        metrics = tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1200,
            timestamp="2026-03-13T10:00:00Z",
        )
        assert metrics.sequence == 1
        assert metrics.model == "claude-sonnet-4.6"
        assert metrics.input_tokens == 500
        assert metrics.output_tokens == 100
        assert metrics.duration_ms == 1200
        assert metrics.total_tokens == 600
        assert metrics.estimated_cost_usd > 0

    def test_call_count_incremented(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=None,
            timestamp="2026-03-13T10:00:00Z",
        )
        assert tracker.get_llm_call_count() == 1

    def test_total_tokens_with_cache(self, tracker: UsageTracker):
        metrics = tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=100,
            output_tokens=50,
            cache_creation_tokens=200,
            cache_read_tokens=300,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        assert metrics.total_tokens == 100 + 50 + 200 + 300


# ---------------------------------------------------------------------------
# Multiple calls same model
# ---------------------------------------------------------------------------


class TestMultipleCallsSameModel:
    """Accumulation across calls for a single model."""

    def test_sequence_numbers_increment(self, tracker: UsageTracker):
        m1 = tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=100,
            output_tokens=10,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=None,
            timestamp="2026-03-13T10:00:00Z",
        )
        m2 = tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=200,
            output_tokens=20,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=None,
            timestamp="2026-03-13T10:00:01Z",
        )
        assert m1.sequence == 1
        assert m2.sequence == 2


# ---------------------------------------------------------------------------
# get_estimated_cost
# ---------------------------------------------------------------------------


class TestGetEstimatedCost:
    """Running cost aggregation via get_estimated_cost."""

    def test_sums_across_calls(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        cost_after_one = tracker.get_estimated_cost()
        assert cost_after_one > 0

        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=300,
            output_tokens=50,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=800,
            timestamp="2026-03-13T10:00:01Z",
        )
        cost_after_two = tracker.get_estimated_cost()
        assert cost_after_two > cost_after_one

    def test_cache_cost_uses_correct_rates(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=0,
            output_tokens=0,
            cache_creation_tokens=1_000_000,
            cache_read_tokens=0,
            duration_ms=None,
            timestamp="2026-03-13T10:00:00Z",
        )
        metadata = _resolve_metadata("claude-sonnet-4.6")
        expected_cost = metadata.cache_creation_price_per_million
        assert tracker.get_estimated_cost() == pytest.approx(expected_cost)


# ---------------------------------------------------------------------------
# Sub-agent scoping
# ---------------------------------------------------------------------------


class TestSubAgentScoping:
    """Main vs sub-agent metrics are isolated."""

    def test_isolated_call_counts(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
            scope=MAIN_SCOPE,
        )
        tracker.record_llm_call(
            model_name="gpt-4o",
            input_tokens=300,
            output_tokens=50,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=800,
            timestamp="2026-03-13T10:00:01Z",
            scope="sub-agent-001",
        )
        assert tracker.get_llm_call_count(MAIN_SCOPE) == 1
        assert tracker.get_llm_call_count("sub-agent-001") == 1

    def test_isolated_costs(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
            scope=MAIN_SCOPE,
        )
        tracker.record_llm_call(
            model_name="gpt-4o",
            input_tokens=300,
            output_tokens=50,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=800,
            timestamp="2026-03-13T10:00:01Z",
            scope="sub-agent-001",
        )
        main_cost = tracker.get_estimated_cost(MAIN_SCOPE)
        sub_cost = tracker.get_estimated_cost("sub-agent-001")
        assert main_cost > 0
        assert sub_cost > 0
        assert main_cost != sub_cost


# ---------------------------------------------------------------------------
# Unknown model
# ---------------------------------------------------------------------------


class TestUnknownModel:
    """Unknown models get zero pricing, so zero cost."""

    def test_unknown_model_zero_cost(self, tracker: UsageTracker):
        metrics = tracker.record_llm_call(
            model_name="my-custom-model-xyz",
            input_tokens=10000,
            output_tokens=5000,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=2000,
            timestamp="2026-03-13T10:00:00Z",
        )
        assert metrics.estimated_cost_usd == 0.0
        assert metrics.total_tokens == 15000
        assert tracker.get_estimated_cost() == 0.0


