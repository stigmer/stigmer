"""Usage tracking and cost calculation for agent executions.

Encapsulates all token accounting, pricing lookup, per-call metrics
construction, per-model aggregation, duration tracking, and proto
assembly for ``UsageMetrics``.  Owned by ``StatusBuilder`` which
delegates usage concerns here so that event-routing logic and
financial math stay in separate modules.

Design Principles:
    1. Scope-based isolation — one tracker serves all scopes (main agent
       and every sub-agent) keyed by a ``scope`` string.  "main" is the
       default scope; sub-agent scopes use the sub-agent run_id.
    2. Pricing stamped at call time — ``record_llm_call`` looks up the
       model's pricing and computes cost immediately so
       ``build_usage_metrics`` is a pure aggregation.
    3. Proto-aligned — field semantics follow ``usage.proto`` exactly.
       ``ModelUsage.input_tokens`` is the non-cached regular portion;
       ``UsageMetrics.prompt_tokens`` is the grand total including cache.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ai.stigmer.agentic.agentexecution.v1.usage_pb2 import (
    LlmCallMetrics,
    ModelUsage,
    UsageMetrics,
)
from graphton.core.model_registry import ModelMetadata, ModelRegistry

if TYPE_CHECKING:
    from graphton.core.summarization_callback import SummarizationEventData

logger = logging.getLogger(__name__)

MAIN_SCOPE = "main"


# ---------------------------------------------------------------------------
# Internal accumulator for per-model, per-scope running totals
# ---------------------------------------------------------------------------

@dataclass
class _ModelAccumulator:
    """Mutable running totals for a single (model, scope) pair."""

    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    call_count: int = 0
    input_price_per_million: float = 0.0
    output_price_per_million: float = 0.0
    cache_creation_price_per_million: float = 0.0
    cache_read_price_per_million: float = 0.0
    estimated_cost_usd: float = 0.0

    def to_proto(self) -> ModelUsage:
        return ModelUsage(
            model=self.model,
            provider=self.provider,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_creation_tokens=self.cache_creation_tokens,
            cache_read_tokens=self.cache_read_tokens,
            call_count=self.call_count,
            input_price_per_million=self.input_price_per_million,
            output_price_per_million=self.output_price_per_million,
            cache_creation_price_per_million=self.cache_creation_price_per_million,
            cache_read_price_per_million=self.cache_read_price_per_million,
            estimated_cost_usd=self.estimated_cost_usd,
        )


@dataclass
class _ScopeState:
    """All tracked state for a single scope (main agent or one sub-agent)."""

    llm_calls: list[LlmCallMetrics] = field(default_factory=list)
    model_accumulators: dict[str, _ModelAccumulator] = field(default_factory=dict)
    primary_model: str = ""
    primary_provider: str = ""

    # Duration breakdown (milliseconds)
    llm_duration_ms: int = 0
    tool_duration_ms: int = 0
    approval_wait_duration_ms: int = 0
    total_duration_ms: int = 0

    # Summarization cost attributed to this scope
    summarization_cost_usd: float = 0.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _resolve_metadata(model_name: str) -> ModelMetadata:
    """Resolve a model identifier (platform ID or API ID) to registry metadata.

    Lookup chain:
        1. Platform ID via ``ModelRegistry.get()``
        2. API model ID via ``ModelRegistry.get_by_api_model_id()``
        3. Conservative defaults via ``ModelRegistry.get_or_default()``
    """
    # Fast path: platform canonical ID
    if ModelRegistry.is_registered(model_name):
        return ModelRegistry.get(model_name)

    # Reverse lookup: provider API model ID
    metadata = ModelRegistry.get_by_api_model_id(model_name)
    if metadata is not None:
        return metadata

    # Fallback: unknown model with zero pricing
    return ModelRegistry.get_or_default(model_name)


def _compute_call_cost(
    *,
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int,
    cache_read_tokens: int,
    metadata: ModelMetadata,
) -> float:
    """Compute USD cost for a single LLM call using disjoint token buckets.

    ``input_tokens`` is the non-cached regular portion.  The four buckets
    are multiplied by their respective per-million rates.
    """
    return (
        input_tokens * (metadata.input_price_per_million or 0.0)
        + output_tokens * (metadata.output_price_per_million or 0.0)
        + cache_creation_tokens * (metadata.cache_creation_price_per_million or 0.0)
        + cache_read_tokens * (metadata.cache_read_price_per_million or 0.0)
    ) / 1_000_000


class UsageTracker:
    """Accumulates LLM usage, cost, and duration data for an execution.

    One ``UsageTracker`` instance serves both the main agent and all its
    sub-agents.  Each is isolated via a ``scope`` parameter: ``"main"``
    for the parent and the sub-agent's ``run_id`` for children.

    Typical lifecycle::

        tracker = UsageTracker(execution_id)

        # After each on_chat_model_end event
        call_metrics = tracker.record_llm_call(
            model_name=model_name,
            input_tokens=...,
            output_tokens=...,
            cache_creation_tokens=...,
            cache_read_tokens=...,
            duration_ms=...,
            timestamp=...,
            scope="main",
        )
        status.usage.CopyFrom(tracker.build_usage_metrics("main"))

        # After each tool completes
        tracker.record_tool_duration(ms, scope="main")

        # When execution finishes
        tracker.set_total_duration("main", total_ms)
    """

    def __init__(self, execution_id: str) -> None:
        self._execution_id = execution_id
        self._scopes: dict[str, _ScopeState] = {}

    # -- internal helpers ---------------------------------------------------

    def _scope(self, scope: str) -> _ScopeState:
        if scope not in self._scopes:
            self._scopes[scope] = _ScopeState()
        return self._scopes[scope]

    # -- LLM call recording -------------------------------------------------

    def record_llm_call(
        self,
        *,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        cache_creation_tokens: int,
        cache_read_tokens: int,
        duration_ms: int | None,
        timestamp: str,
        scope: str = MAIN_SCOPE,
    ) -> LlmCallMetrics:
        """Record a single LLM API call and return its per-call metrics proto.

        Performs model-registry lookup, computes cost, builds an
        ``LlmCallMetrics``, accumulates into the per-model aggregate,
        and returns the proto so the caller can stamp fields onto the
        corresponding ``AgentMessage``.

        Args:
            model_name: Model identifier from the provider response
                (API model ID like ``claude-sonnet-4-6``) or a platform
                canonical ID (``claude-sonnet-4.6``).
            input_tokens: Non-cached regular input tokens (disjoint from
                cache buckets).
            output_tokens: Tokens generated by the model.
            cache_creation_tokens: Tokens written to provider cache.
            cache_read_tokens: Tokens read from provider cache.
            duration_ms: Wall-clock LLM call duration, or ``None`` if
                unavailable.
            timestamp: ISO 8601 timestamp when the call started.
            scope: ``"main"`` for the parent agent, or the sub-agent
                run_id.

        Returns:
            Fully populated ``LlmCallMetrics`` proto for this call.
        """
        state = self._scope(scope)
        metadata = _resolve_metadata(model_name)

        cost = _compute_call_cost(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_tokens=cache_creation_tokens,
            cache_read_tokens=cache_read_tokens,
            metadata=metadata,
        )

        sequence = len(state.llm_calls) + 1
        call_metrics = LlmCallMetrics(
            sequence=sequence,
            model=model_name,
            provider=metadata.provider,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_tokens=cache_creation_tokens,
            cache_read_tokens=cache_read_tokens,
            estimated_cost_usd=cost,
            duration_ms=duration_ms or 0,
            timestamp=timestamp,
        )
        state.llm_calls.append(call_metrics)

        # Capture primary model / provider on first call
        if not state.primary_model and model_name:
            state.primary_model = model_name
            state.primary_provider = metadata.provider

        # Accumulate into per-model aggregate
        acc = state.model_accumulators.get(model_name)
        if acc is None:
            acc = _ModelAccumulator(
                model=model_name,
                provider=metadata.provider,
                input_price_per_million=metadata.input_price_per_million or 0.0,
                output_price_per_million=metadata.output_price_per_million or 0.0,
                cache_creation_price_per_million=metadata.cache_creation_price_per_million or 0.0,
                cache_read_price_per_million=metadata.cache_read_price_per_million or 0.0,
            )
            state.model_accumulators[model_name] = acc

        acc.input_tokens += input_tokens
        acc.output_tokens += output_tokens
        acc.cache_creation_tokens += cache_creation_tokens
        acc.cache_read_tokens += cache_read_tokens
        acc.call_count += 1
        acc.estimated_cost_usd += cost

        # Accumulate LLM duration
        if duration_ms is not None:
            state.llm_duration_ms += duration_ms

        logger.info(
            "[COST] execution=%s scope=%s seq=%d model=%s "
            "input=%d output=%d cache_create=%d cache_read=%d "
            "cost=$%.6f cumulative=$%.6f",
            self._execution_id,
            scope,
            sequence,
            model_name,
            input_tokens,
            output_tokens,
            cache_creation_tokens,
            cache_read_tokens,
            cost,
            self.get_estimated_cost(scope),
        )

        return call_metrics

    # -- Duration recording --------------------------------------------------

    def record_tool_duration(self, duration_ms: int, scope: str = MAIN_SCOPE) -> None:
        """Add tool execution time to the scope's tool duration total."""
        self._scope(scope).tool_duration_ms += duration_ms

    def record_approval_wait(self, duration_ms: int, scope: str = MAIN_SCOPE) -> None:
        """Add approval wait time to the scope's approval duration total."""
        self._scope(scope).approval_wait_duration_ms += duration_ms

    def set_total_duration(self, scope: str, duration_ms: int) -> None:
        """Set the scope's total wall-clock duration (computed externally)."""
        self._scope(scope).total_duration_ms = duration_ms

    # -- Summarization recording ---------------------------------------------

    def record_summarization(
        self,
        event: SummarizationEventData,
        scope: str = MAIN_SCOPE,
    ) -> None:
        """Attribute summarization cost to the scope's total."""
        self._scope(scope).summarization_cost_usd += getattr(
            event, "summarization_cost_usd", 0.0
        )

    # -- Queries --------------------------------------------------------------

    def get_estimated_cost(self, scope: str = MAIN_SCOPE) -> float:
        """Return the running estimated cost for a scope (LLM + summarization)."""
        state = self._scope(scope)
        llm_cost = sum(acc.estimated_cost_usd for acc in state.model_accumulators.values())
        return llm_cost + state.summarization_cost_usd

    def get_llm_call_count(self, scope: str = MAIN_SCOPE) -> int:
        """Return the number of LLM calls recorded for a scope."""
        return len(self._scope(scope).llm_calls)

    # -- Proto builders -------------------------------------------------------

    def build_usage_metrics(self, scope: str = MAIN_SCOPE) -> UsageMetrics:
        """Assemble a fully populated ``UsageMetrics`` proto from accumulated data.

        This is a pure read — it does not mutate internal state.  It can
        be called repeatedly (e.g. after each LLM call) to provide
        progressive usage updates.
        """
        state = self._scope(scope)

        # Aggregate across all models
        total_prompt_tokens = 0
        total_completion_tokens = 0
        total_cache_creation = 0
        total_cache_read = 0
        total_call_count = 0
        model_breakdown: list[ModelUsage] = []

        for acc in state.model_accumulators.values():
            total_input = acc.input_tokens + acc.cache_creation_tokens + acc.cache_read_tokens
            total_prompt_tokens += total_input
            total_completion_tokens += acc.output_tokens
            total_cache_creation += acc.cache_creation_tokens
            total_cache_read += acc.cache_read_tokens
            total_call_count += acc.call_count
            model_breakdown.append(acc.to_proto())

        total_cost = sum(acc.estimated_cost_usd for acc in state.model_accumulators.values())
        total_cost += state.summarization_cost_usd

        return UsageMetrics(
            prompt_tokens=total_prompt_tokens,
            completion_tokens=total_completion_tokens,
            total_tokens=total_prompt_tokens + total_completion_tokens,
            llm_call_count=total_call_count,
            primary_model=state.primary_model,
            cache_creation_tokens=total_cache_creation,
            cache_read_tokens=total_cache_read,
            model_breakdown=model_breakdown,
            estimated_cost_usd=total_cost,
            llm_calls=list(state.llm_calls),
            total_duration_ms=state.total_duration_ms,
            llm_duration_ms=state.llm_duration_ms,
            tool_duration_ms=state.tool_duration_ms,
            approval_wait_duration_ms=state.approval_wait_duration_ms,
            primary_provider=state.primary_provider,
        )
