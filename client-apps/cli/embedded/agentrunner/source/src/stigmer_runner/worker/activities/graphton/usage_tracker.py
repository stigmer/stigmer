"""Usage tracking and cost calculation for agent executions.

Encapsulates token accounting, pricing lookup, per-call metrics construction,
and cost logging.  Owned by ``StatusBuilder`` which delegates usage concerns
here so that event-routing logic and financial math stay in separate modules.

The per-call ``LlmCallMetrics`` proto returned by ``record_llm_call`` is
stamped directly onto the corresponding ``AgentMessage.llm_metrics`` field —
the single source of truth for usage data.  This module does NOT build
aggregate ``UsageMetrics``; aggregation is a computed projection done by
the server (for reports) and the frontend (for the real-time widget).

Design Principles:
    1. Scope-based isolation — one tracker serves all scopes (main agent
       and every sub-agent) keyed by a ``scope`` string.  "main" is the
       default scope; sub-agent scopes use the sub-agent run_id.
    2. Pricing stamped at call time — ``record_llm_call`` looks up the
       model's pricing and computes cost immediately.
    3. Proto-aligned — field semantics follow ``usage.proto`` exactly.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from ai.stigmer.agentic.agentexecution.v1.usage_pb2 import LlmCallMetrics
from graphton.core.model_registry import ModelMetadata, ModelRegistry

logger = logging.getLogger(__name__)

MAIN_SCOPE = "main"


@dataclass
class _ScopeState:
    """All tracked state for a single scope (main agent or one sub-agent)."""

    llm_calls: list[LlmCallMetrics] = field(default_factory=list)
    primary_model: str = ""
    primary_provider: str = ""
    llm_duration_ms: int = 0


def _resolve_metadata(model_name: str) -> ModelMetadata:
    """Resolve a model identifier (platform ID or API ID) to registry metadata.

    Lookup chain:
        1. Platform ID via ``ModelRegistry.get()``
        2. API model ID via ``ModelRegistry.get_by_api_model_id()``
        3. Conservative defaults via ``ModelRegistry.get_or_default()``
    """
    if ModelRegistry.is_registered(model_name):
        return ModelRegistry.get(model_name)

    metadata = ModelRegistry.get_by_api_model_id(model_name)
    if metadata is not None:
        return metadata

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
    """Records LLM calls, computes per-call cost, and logs usage data.

    One ``UsageTracker`` instance serves both the main agent and all its
    sub-agents.  Each is isolated via a ``scope`` parameter: ``"main"``
    for the parent and the sub-agent's ``run_id`` for children.

    The returned ``LlmCallMetrics`` is stamped onto ``AgentMessage.llm_metrics``
    by the caller — the per-message data is the single source of truth.

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
        ai_message.llm_metrics.CopyFrom(call_metrics)
    """

    def __init__(self, execution_id: str) -> None:
        self._execution_id = execution_id
        self._scopes: dict[str, _ScopeState] = {}

    def _scope(self, scope: str) -> _ScopeState:
        if scope not in self._scopes:
            self._scopes[scope] = _ScopeState()
        return self._scopes[scope]

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
        ``LlmCallMetrics``, and returns the proto so the caller can stamp
        it onto the corresponding ``AgentMessage.llm_metrics``.

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
            total_tokens=input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens,
        )
        state.llm_calls.append(call_metrics)

        if not state.primary_model and model_name:
            state.primary_model = model_name
            state.primary_provider = metadata.provider

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

    def get_estimated_cost(self, scope: str = MAIN_SCOPE) -> float:
        """Return the running estimated cost for a scope."""
        return sum(c.estimated_cost_usd for c in self._scope(scope).llm_calls)

    def get_llm_call_count(self, scope: str = MAIN_SCOPE) -> int:
        """Return the number of LLM calls recorded for a scope."""
        return len(self._scope(scope).llm_calls)
