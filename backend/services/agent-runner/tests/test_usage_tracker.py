"""Unit tests for UsageTracker.

Tests cover:
- Single LLM call: correct LlmCallMetrics, correct cost
- Multiple calls same model: ModelUsage aggregation
- Multiple models: separate ModelUsage entries
- Cache tokens: cost calculation uses correct pricing tiers
- Duration aggregation: LLM + tool + approval + total
- Sub-agent scoping: main vs sub-agent metrics isolation
- Unknown model: falls back to defaults, zero pricing = zero cost
- Summarization: cost included in total
- build_usage_metrics idempotency (pure read, no side effects)
- Tool result truncation: record_tool_truncation accumulation + proto field
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from worker.activities.graphton.usage_tracker import (
    MAIN_SCOPE,
    UsageTracker,
    _compute_call_cost,
    _resolve_metadata,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

ANTHROPIC_PRICING = {
    "input_price_per_million": 3.0,
    "output_price_per_million": 15.0,
    "cache_creation_price_per_million": 3.75,
    "cache_read_price_per_million": 0.30,
}


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

    def test_usage_metrics_populated(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1200,
            timestamp="2026-03-13T10:00:00Z",
        )
        usage = tracker.build_usage_metrics()
        assert usage.prompt_tokens == 500
        assert usage.completion_tokens == 100
        assert usage.total_tokens == 600
        assert usage.llm_call_count == 1
        assert usage.primary_model == "claude-sonnet-4.6"
        assert usage.estimated_cost_usd > 0
        assert usage.llm_duration_ms == 1200


# ---------------------------------------------------------------------------
# Multiple calls same model
# ---------------------------------------------------------------------------


class TestMultipleCallsSameModel:
    """Accumulation across calls for a single model."""

    def test_tokens_aggregated(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=300,
            output_tokens=50,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=800,
            timestamp="2026-03-13T10:00:01Z",
        )
        usage = tracker.build_usage_metrics()
        # prompt_tokens = total_input = input + cache_creation + cache_read
        # = 500 + 300 = 800  (no cache tokens)
        assert usage.prompt_tokens == 800
        assert usage.completion_tokens == 150
        assert usage.llm_call_count == 2
        assert usage.llm_duration_ms == 1800
        assert len(usage.model_breakdown) == 1
        assert usage.model_breakdown[0].call_count == 2

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
# Multiple models
# ---------------------------------------------------------------------------


class TestMultipleModels:
    """Different models produce separate ModelUsage entries."""

    def test_separate_model_breakdown(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        tracker.record_llm_call(
            model_name="gpt-4o",
            input_tokens=300,
            output_tokens=50,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=800,
            timestamp="2026-03-13T10:00:01Z",
        )
        usage = tracker.build_usage_metrics()
        assert len(usage.model_breakdown) == 2
        models = {m.model for m in usage.model_breakdown}
        assert models == {"claude-sonnet-4.6", "gpt-4o"}
        assert usage.primary_model == "claude-sonnet-4.6"


# ---------------------------------------------------------------------------
# Cache tokens
# ---------------------------------------------------------------------------


class TestCacheTokens:
    """Cache token cost uses distinct pricing tiers."""

    def test_cache_tokens_in_aggregates(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=100,
            output_tokens=50,
            cache_creation_tokens=200,
            cache_read_tokens=300,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        usage = tracker.build_usage_metrics()
        assert usage.cache_creation_tokens == 200
        assert usage.cache_read_tokens == 300
        # prompt_tokens = total_input = input + cache_creation + cache_read
        assert usage.prompt_tokens == 100 + 200 + 300

    def test_model_breakdown_disjoint_buckets(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=100,
            output_tokens=50,
            cache_creation_tokens=200,
            cache_read_tokens=300,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        usage = tracker.build_usage_metrics()
        m = usage.model_breakdown[0]
        assert m.input_tokens == 100
        assert m.cache_creation_tokens == 200
        assert m.cache_read_tokens == 300

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
        usage = tracker.build_usage_metrics()
        metadata = _resolve_metadata("claude-sonnet-4.6")
        expected_cost = metadata.cache_creation_price_per_million
        assert usage.estimated_cost_usd == pytest.approx(expected_cost)


# ---------------------------------------------------------------------------
# Duration aggregation
# ---------------------------------------------------------------------------


class TestDurationAggregation:
    """Duration breakdown tracking."""

    def test_tool_duration(self, tracker: UsageTracker):
        tracker.record_tool_duration(500)
        tracker.record_tool_duration(300)
        usage = tracker.build_usage_metrics()
        assert usage.tool_duration_ms == 800

    def test_approval_wait(self, tracker: UsageTracker):
        tracker.record_approval_wait(5000)
        usage = tracker.build_usage_metrics()
        assert usage.approval_wait_duration_ms == 5000

    def test_total_duration(self, tracker: UsageTracker):
        tracker.set_total_duration(MAIN_SCOPE, 30000)
        usage = tracker.build_usage_metrics()
        assert usage.total_duration_ms == 30000

    def test_llm_duration_from_calls(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="gpt-4o",
            input_tokens=100,
            output_tokens=10,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        tracker.record_llm_call(
            model_name="gpt-4o",
            input_tokens=200,
            output_tokens=20,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=2000,
            timestamp="2026-03-13T10:00:01Z",
        )
        usage = tracker.build_usage_metrics()
        assert usage.llm_duration_ms == 3000


# ---------------------------------------------------------------------------
# Sub-agent scoping
# ---------------------------------------------------------------------------


class TestSubAgentScoping:
    """Main vs sub-agent metrics are isolated."""

    def test_isolated_metrics(self, tracker: UsageTracker):
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
        main_usage = tracker.build_usage_metrics(MAIN_SCOPE)
        sub_usage = tracker.build_usage_metrics("sub-agent-001")

        assert main_usage.prompt_tokens == 500
        assert main_usage.llm_call_count == 1
        assert main_usage.primary_model == "claude-sonnet-4.6"

        assert sub_usage.prompt_tokens == 300
        assert sub_usage.llm_call_count == 1
        assert sub_usage.primary_model == "gpt-4o"

    def test_tool_duration_isolated(self, tracker: UsageTracker):
        tracker.record_tool_duration(500, scope=MAIN_SCOPE)
        tracker.record_tool_duration(300, scope="sub-agent-001")

        assert tracker.build_usage_metrics(MAIN_SCOPE).tool_duration_ms == 500
        assert tracker.build_usage_metrics("sub-agent-001").tool_duration_ms == 300


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
        usage = tracker.build_usage_metrics()
        assert usage.estimated_cost_usd == 0.0
        assert usage.prompt_tokens == 10000


# ---------------------------------------------------------------------------
# Summarization cost
# ---------------------------------------------------------------------------


class TestSummarizationCost:
    """Summarization cost flows into the total."""

    def test_summarization_adds_to_total(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        llm_cost = tracker.get_estimated_cost()

        from graphton.core.summarization_callback import SummarizationEventData

        event = SummarizationEventData(
            tokens_before=150000,
            tokens_after=60000,
            compression_ratio=0.6,
            duration_ms=2500,
            summarization_model="claude-haiku-4.5",
            messages_before=45,
            messages_after=8,
            source="mid_execution",
            summarization_cost_usd=0.005,
        )
        tracker.record_summarization(event)
        assert tracker.get_estimated_cost() == pytest.approx(llm_cost + 0.005)
        usage = tracker.build_usage_metrics()
        assert usage.estimated_cost_usd == pytest.approx(llm_cost + 0.005)


# ---------------------------------------------------------------------------
# build_usage_metrics idempotency
# ---------------------------------------------------------------------------


class TestBuildIdempotency:
    """build_usage_metrics is a pure read — multiple calls return same result."""

    def test_multiple_builds_identical(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=500,
            output_tokens=100,
            cache_creation_tokens=10,
            cache_read_tokens=20,
            duration_ms=1000,
            timestamp="2026-03-13T10:00:00Z",
        )
        u1 = tracker.build_usage_metrics()
        u2 = tracker.build_usage_metrics()
        assert u1.prompt_tokens == u2.prompt_tokens
        assert u1.completion_tokens == u2.completion_tokens
        assert u1.estimated_cost_usd == u2.estimated_cost_usd
        assert u1.llm_call_count == u2.llm_call_count


# ---------------------------------------------------------------------------
# LLM calls list in usage proto
# ---------------------------------------------------------------------------


class TestLlmCallsList:
    """Per-call detail is present in the proto."""

    def test_llm_calls_in_proto(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=100,
            output_tokens=10,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=500,
            timestamp="2026-03-13T10:00:00Z",
        )
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=200,
            output_tokens=20,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=600,
            timestamp="2026-03-13T10:00:01Z",
        )
        usage = tracker.build_usage_metrics()
        assert len(usage.llm_calls) == 2
        assert usage.llm_calls[0].sequence == 1
        assert usage.llm_calls[1].sequence == 2
        assert usage.llm_calls[0].input_tokens == 100
        assert usage.llm_calls[1].input_tokens == 200


# ---------------------------------------------------------------------------
# Pricing stamped on ModelUsage
# ---------------------------------------------------------------------------


class TestPricingStamped:
    """ModelUsage carries the pricing rates used at call time."""

    def test_pricing_fields_populated(self, tracker: UsageTracker):
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=100,
            output_tokens=10,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=None,
            timestamp="2026-03-13T10:00:00Z",
        )
        usage = tracker.build_usage_metrics()
        m = usage.model_breakdown[0]
        assert m.input_price_per_million > 0
        assert m.output_price_per_million > 0
        assert m.cache_creation_price_per_million >= 0
        assert m.cache_read_price_per_million >= 0


# ---------------------------------------------------------------------------
# Tool result truncation (Phase 3B)
# ---------------------------------------------------------------------------


class TestToolTruncation:
    """Tests for record_tool_truncation and proto field population."""

    def test_single_truncation(self, tracker: UsageTracker):
        tracker.record_tool_truncation(5_000)
        usage = tracker.build_usage_metrics()
        assert usage.tool_result_chars_truncated == 5_000

    def test_multiple_truncations_accumulate(self, tracker: UsageTracker):
        tracker.record_tool_truncation(3_000)
        tracker.record_tool_truncation(7_000)
        tracker.record_tool_truncation(500)
        usage = tracker.build_usage_metrics()
        assert usage.tool_result_chars_truncated == 10_500

    def test_no_truncation_defaults_to_zero(self, tracker: UsageTracker):
        usage = tracker.build_usage_metrics()
        assert usage.tool_result_chars_truncated == 0

    def test_truncation_scoped_to_main(self, tracker: UsageTracker):
        tracker.record_tool_truncation(1_000, scope=MAIN_SCOPE)
        tracker.record_tool_truncation(2_000, scope="sub-agent-1")

        main_usage = tracker.build_usage_metrics(scope=MAIN_SCOPE)
        sub_usage = tracker.build_usage_metrics(scope="sub-agent-1")

        assert main_usage.tool_result_chars_truncated == 1_000
        assert sub_usage.tool_result_chars_truncated == 2_000

    def test_truncation_alongside_llm_calls(self, tracker: UsageTracker):
        """Truncation tracking doesn't interfere with cost tracking."""
        tracker.record_llm_call(
            model_name="claude-sonnet-4.6",
            input_tokens=100,
            output_tokens=10,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            duration_ms=500,
            timestamp="2026-03-13T10:00:00Z",
        )
        tracker.record_tool_truncation(8_000)

        usage = tracker.build_usage_metrics()
        assert usage.tool_result_chars_truncated == 8_000
        assert usage.llm_call_count == 1
        assert usage.estimated_cost_usd > 0
