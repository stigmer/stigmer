"""Callback protocol for summarization event reporting.

This module defines the protocol for reporting summarization events from
the SummarizationMiddleware to external consumers (e.g., StatusBuilder).

The callback pattern enables loose coupling between the middleware
(in graphton library) and the status tracking (in agent-runner service).

Design Principles:
    1. Protocol-based - Uses Python Protocol for structural typing
    2. Immutable Data - Events are frozen dataclasses
    3. Optional Callbacks - Middleware works without callbacks
    4. Observable - All summarization activity can be tracked

Example:
    >>> from graphton.core.summarization_callback import (
    ...     SummarizationCallback,
    ...     SummarizationEventData,
    ... )
    >>>
    >>> class MyCallback:
    ...     def on_summarization_complete(self, event: SummarizationEventData) -> None:
    ...         print(f"Summarized: {event.tokens_before} -> {event.tokens_after}")
    ...
    ...     def on_token_count_updated(self, token_count: int) -> None:
    ...         print(f"Token count: {token_count}")

"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class SummarizationEventData:
    """Data for a single summarization event.

    This is a value object containing all information about a summarization
    event. It's frozen (immutable) to ensure event data isn't modified after
    creation.

    Attributes:
        tokens_before: Token count before summarization was triggered.
        tokens_after: Token count after summarization completed.
        compression_ratio: Ratio of tokens reduced (0.0 to 1.0).
            Example: 0.6 means 60% reduction.
        duration_ms: Time taken to perform summarization in milliseconds.
        summarization_model: Model used for summarization (e.g., "claude-haiku-4.5").
        messages_before: Number of messages before summarization.
        messages_after: Number of messages after summarization.
        source: What triggered this summarization.
            "graph_start" for compaction at the beginning of a graph invocation,
            "mid_execution" for compaction triggered by accumulated context
            mid-execution.

    Example:
        >>> event = SummarizationEventData(
        ...     tokens_before=150000,
        ...     tokens_after=60000,
        ...     compression_ratio=0.6,
        ...     duration_ms=2500,
        ...     summarization_model="claude-haiku-4.5",
        ...     messages_before=45,
        ...     messages_after=8,
        ...     source="mid_execution",
        ... )
        >>> print(f"Reduced {event.tokens_before} to {event.tokens_after}")
        Reduced 150000 to 60000

    """

    tokens_before: int
    tokens_after: int
    compression_ratio: float
    duration_ms: int
    summarization_model: str
    messages_before: int
    messages_after: int
    source: str

    summarization_input_tokens: int = 0
    summarization_output_tokens: int = 0
    summarization_cost_usd: float = 0.0


@runtime_checkable
class SummarizationCallback(Protocol):
    """Protocol for reporting summarization events.

    This protocol defines the interface for callbacks that receive
    summarization events. It uses structural typing (Protocol) rather
    than inheritance, allowing any class with matching methods to be
    used as a callback.

    The @runtime_checkable decorator enables isinstance() checks,
    useful for validation in debug/test scenarios.

    Methods:
        on_summarization_complete: Called when summarization finishes.
        on_token_count_updated: Called when token count changes.

    Example:
        >>> class StatusBuilder:
        ...     def on_summarization_complete(
        ...         self, event: SummarizationEventData
        ...     ) -> None:
        ...         # Record event in execution status
        ...         self._summarization_events.append(event)
        ...
        ...     def on_token_count_updated(self, token_count: int) -> None:
        ...         # Update context info with current token count
        ...         self._context_info.current_token_count = token_count
        >>>
        >>> # StatusBuilder satisfies SummarizationCallback protocol
        >>> builder = StatusBuilder()
        >>> assert isinstance(builder, SummarizationCallback)

    """

    def on_summarization_complete(self, event: SummarizationEventData) -> None:
        """Called when a summarization operation completes.

        This callback is invoked after successful summarization, with
        complete metrics about the operation.

        Args:
            event: Immutable data object containing summarization metrics.

        Note:
            This is called synchronously after summarization completes.
            Keep the implementation fast to avoid blocking the agent.

        """
        ...

    def on_token_count_updated(self, token_count: int) -> None:
        """Called when the token count is recalculated.

        This callback is invoked whenever the middleware recalculates
        the current token count, which happens:
        - Before each agent invocation (in abefore_agent)
        - After summarization (with the new, reduced count)

        Args:
            token_count: Current token count in the context window.

        Note:
            This may be called multiple times during an execution.
            Use for real-time context utilization tracking.

        """
        ...


# Source constants — mirror the proto SummarizationSource enum value names.
# Used by SummarizationMiddleware to set SummarizationEventData.source
# without depending on proto stubs.
SOURCE_GRAPH_START: str = "graph_start"
SOURCE_MID_EXECUTION: str = "mid_execution"

# Module-level exports
__all__ = [
    "SOURCE_GRAPH_START",
    "SOURCE_MID_EXECUTION",
    "SummarizationCallback",
    "SummarizationEventData",
]
