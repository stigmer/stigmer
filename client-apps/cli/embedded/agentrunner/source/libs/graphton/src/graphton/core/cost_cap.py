"""Cost cap middleware for agent execution budget enforcement.

Prevents runaway agents from draining API credits by tracking the running
estimated cost of LLM calls and enforcing a configurable cost ceiling.

    abefore_agent  -- Resets per-invocation cost state (important for
                      multi-turn sessions where the middleware instance
                      is reused across graph invocations).

    aafter_model   -- Runs after every model call.  Extracts usage_metadata
                      from the latest AIMessage, computes incremental cost
                      using the pricing rates provided at construction time,
                      and accumulates a running total.  Injects a warning
                      SystemMessage at ~80 % of the budget and a termination
                      SystemMessage at 100 %.

    awrap_tool_call -- Wraps every tool execution.  When the budget has
                       been exceeded (``_exceeded`` is True), short-circuits
                       tool execution by returning a ToolMessage instructing
                       the model to summarise.  This gives the model one
                       final tool-free round to produce a summary response
                       before the execution naturally terminates.

    aafter_agent   -- Logs cost cap usage stats at the end of execution.

Cost estimation
---------------
The middleware tracks its own running cost total, independent of the
detailed per-model accounting in ``UsageTracker``.  This is intentional:

1. Timing — the middleware fires before the event stream reaches
   StatusBuilder / UsageTracker, so it cannot read from UsageTracker.
2. Coupling — this middleware lives in graphton (library), while
   UsageTracker lives in agent-runner (service).
3. Precision — the cap is a safety mechanism.  Using the primary model's
   pricing rates for all calls is accurate enough for threshold checks.
   UsageTracker handles the precise per-model accounting for reports.

The middleware uses the formula::

    cost += (regular_input × input_price
             + cache_creation × cache_creation_price
             + cache_read × cache_read_price
             + output × output_price) / 1 000 000

where regular_input = total_input − cache_creation − cache_read.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

logger = logging.getLogger(__name__)

_DEFAULT_WARNING_PCT = 80
_MIN_WARNING_PCT = 50
_MAX_WARNING_PCT = 95


class CostCapMiddleware(AgentMiddleware):
    """Middleware that enforces a cost ceiling on agent execution.

    Tracks running LLM cost via ``aafter_model`` and takes action at two
    thresholds:

    - **Warning (default 80 %)**: Injects a SystemMessage asking the model
      to wrap up its current task.  Fires once.
    - **Exceeded (100 %)**: Injects a final SystemMessage instructing the
      model to summarise what it accomplished.  All subsequent tool calls
      are blocked via ``awrap_tool_call``, giving the model one last
      tool-free round to produce a summary before the execution naturally
      terminates (the model responds with no tool calls → graph ends).

    This middleware is only injected when ``max_cost_usd > 0`` is explicitly
    configured in ``ExecutionConfig``.

    Example::

        >>> middleware = CostCapMiddleware(
        ...     max_cost_usd=5.00,
        ...     input_price_per_million=3.00,
        ...     output_price_per_million=15.00,
        ...     cache_creation_price_per_million=3.75,
        ...     cache_read_price_per_million=0.30,
        ... )
        >>> # Auto-injected in create_deep_agent() when max_cost_usd > 0

    Args:
        max_cost_usd: Maximum estimated cost in USD for this execution.
            Must be positive.
        input_price_per_million: Price per million regular input tokens
            (USD).  Used for non-cached input token cost.
        output_price_per_million: Price per million output tokens (USD).
        cache_creation_price_per_million: Price per million cache-write
            input tokens (USD).  Anthropic charges 1.25x the input rate
            for cache writes.  Defaults to 0, which falls back to the
            regular input rate (underestimate for Anthropic).
        cache_read_price_per_million: Price per million cache-read input
            tokens (USD).  Defaults to 0, which means cache reads are
            charged at the full input rate (conservative overestimate).
        warning_pct: Percentage of the budget at which to inject the
            warning SystemMessage.  Must be between 50 and 95.
            Default: 80.
    """

    def __init__(
        self,
        max_cost_usd: float,
        input_price_per_million: float,
        output_price_per_million: float,
        cache_creation_price_per_million: float = 0.0,
        cache_read_price_per_million: float = 0.0,
        warning_pct: int = _DEFAULT_WARNING_PCT,
    ) -> None:
        if max_cost_usd <= 0:
            raise ValueError(
                f"max_cost_usd must be positive, got {max_cost_usd}."
            )
        if not (_MIN_WARNING_PCT <= warning_pct <= _MAX_WARNING_PCT):
            raise ValueError(
                f"warning_pct must be between {_MIN_WARNING_PCT} and "
                f"{_MAX_WARNING_PCT}, got {warning_pct}."
            )

        self._max_cost_usd = max_cost_usd
        self._input_price = input_price_per_million
        self._output_price = output_price_per_million
        self._cache_creation_price = cache_creation_price_per_million
        self._cache_read_price = cache_read_price_per_million
        self._warning_pct = warning_pct

        self._running_cost = 0.0
        self._warned = False
        self._exceeded = False
        self._model_call_count = 0

        logger.info(
            "Cost cap middleware initialized: max_cost=$%.2f, "
            "warning_pct=%d%%, input_price=$%.2f/MTok, "
            "output_price=$%.2f/MTok, cache_creation_price=$%.2f/MTok, "
            "cache_read_price=$%.2f/MTok",
            max_cost_usd,
            warning_pct,
            input_price_per_million,
            output_price_per_million,
            cache_creation_price_per_million,
            cache_read_price_per_million,
        )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def running_cost(self) -> float:
        """Current accumulated cost in USD."""
        return self._running_cost

    @property
    def exceeded(self) -> bool:
        """Whether the cost cap has been exceeded."""
        return self._exceeded

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_usage(self, ai_message: AIMessage) -> tuple[int, int, int, int]:
        """Extract token counts from an AIMessage's usage_metadata.

        Returns:
            (total_input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)
        """
        usage = getattr(ai_message, "usage_metadata", None)
        if not usage:
            return 0, 0, 0, 0

        if isinstance(usage, dict):
            total_input = usage.get("input_tokens", 0) or 0
            output = usage.get("output_tokens", 0) or 0
            details = usage.get("input_token_details") or {}
            if isinstance(details, dict):
                cache_creation = details.get("cache_creation", 0) or 0
                cache_read = details.get("cache_read", 0) or 0
            else:
                cache_creation = getattr(details, "cache_creation", 0) or 0
                cache_read = getattr(details, "cache_read", 0) or 0
        else:
            total_input = getattr(usage, "input_tokens", 0) or 0
            output = getattr(usage, "output_tokens", 0) or 0
            details = getattr(usage, "input_token_details", None)
            if details is not None:
                if isinstance(details, dict):
                    cache_creation = details.get("cache_creation", 0) or 0
                    cache_read = details.get("cache_read", 0) or 0
                else:
                    cache_creation = getattr(details, "cache_creation", 0) or 0
                    cache_read = getattr(details, "cache_read", 0) or 0
            else:
                cache_creation = 0
                cache_read = 0

        return total_input, output, cache_creation, cache_read

    def _compute_call_cost(
        self,
        total_input_tokens: int,
        output_tokens: int,
        cache_creation_tokens: int,
        cache_read_tokens: int,
    ) -> float:
        """Compute estimated cost for a single LLM call.

        Splits total input into regular, cache-creation, and cache-read
        buckets and applies the respective rates.

        When ``cache_creation_price`` is 0, cache-creation tokens are
        charged at the full input rate.  When ``cache_read_price`` is 0,
        cache-read tokens are charged at the full input rate.
        """
        regular_input = max(
            total_input_tokens - cache_creation_tokens - cache_read_tokens, 0,
        )
        input_cost = regular_input * self._input_price

        if self._cache_creation_price > 0 and cache_creation_tokens > 0:
            creation_cost = cache_creation_tokens * self._cache_creation_price
        else:
            creation_cost = cache_creation_tokens * self._input_price

        if self._cache_read_price > 0 and cache_read_tokens > 0:
            read_cost = cache_read_tokens * self._cache_read_price
        else:
            read_cost = cache_read_tokens * self._input_price

        output_cost = output_tokens * self._output_price
        return (input_cost + creation_cost + read_cost + output_cost) / 1_000_000

    def _create_warning_message(self) -> SystemMessage:
        """Build the SystemMessage injected at the warning threshold."""
        pct = (self._running_cost / self._max_cost_usd * 100) if self._max_cost_usd else 0
        remaining = max(self._max_cost_usd - self._running_cost, 0)
        return SystemMessage(
            content=(
                f"Budget warning: This execution has consumed "
                f"${self._running_cost:.4f} of the ${self._max_cost_usd:.2f} "
                f"budget ({pct:.0f}%). "
                f"Approximately ${remaining:.4f} remaining. "
                f"Prioritize completing your current task. Summarize results "
                f"and any remaining work so the user can continue in the "
                f"next message."
            ),
        )

    def _create_exceeded_message(self) -> SystemMessage:
        """Build the SystemMessage injected when the budget is exhausted."""
        return SystemMessage(
            content=(
                f"Budget exceeded: This execution has consumed "
                f"${self._running_cost:.4f}, exceeding the "
                f"${self._max_cost_usd:.2f} budget. "
                f"All tool calls are now blocked. "
                f"Respond with a summary of what you accomplished and "
                f"what work remains so the user can continue."
            ),
        )

    # ------------------------------------------------------------------
    # AgentMiddleware hooks
    # ------------------------------------------------------------------

    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Reset per-invocation state at the start of each execution."""
        self._running_cost = 0.0
        self._warned = False
        self._exceeded = False
        self._model_call_count = 0
        logger.debug("Cost cap state reset for new invocation")
        return None

    async def aafter_model(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Track cost after each model call and enforce thresholds.

        Extracts usage from the latest AIMessage, computes incremental
        cost, and checks against the budget.  Returns a state update
        containing a SystemMessage at the warning or exceeded threshold.
        """
        if self._exceeded:
            return None

        messages = state.get("messages", [])
        if not messages:
            return None

        last_ai: AIMessage | None = None
        for msg in reversed(messages):
            if isinstance(msg, AIMessage):
                last_ai = msg
                break

        if last_ai is None:
            return None

        total_input, output, cache_creation, cache_read = self._extract_usage(last_ai)
        if total_input == 0 and output == 0:
            return None

        call_cost = self._compute_call_cost(total_input, output, cache_creation, cache_read)
        self._running_cost += call_cost
        self._model_call_count += 1

        logger.debug(
            "Cost cap: call #%d cost=$%.6f, running_total=$%.4f, "
            "cap=$%.2f (input=%d, output=%d, cache_creation=%d, cache_read=%d)",
            self._model_call_count,
            call_cost,
            self._running_cost,
            self._max_cost_usd,
            total_input,
            output,
            cache_creation,
            cache_read,
        )

        warning_threshold = self._max_cost_usd * self._warning_pct / 100

        if self._running_cost >= self._max_cost_usd:
            self._exceeded = True
            logger.warning(
                "COST CAP EXCEEDED: $%.4f >= $%.2f cap after %d calls. "
                "Tool execution will be blocked.",
                self._running_cost,
                self._max_cost_usd,
                self._model_call_count,
            )
            return {"messages": [self._create_exceeded_message()]}

        if not self._warned and self._running_cost >= warning_threshold:
            self._warned = True
            logger.warning(
                "COST CAP WARNING: $%.4f >= $%.4f threshold "
                "(%d%% of $%.2f cap) after %d calls.",
                self._running_cost,
                warning_threshold,
                self._warning_pct,
                self._max_cost_usd,
                self._model_call_count,
            )
            return {"messages": [self._create_warning_message()]}

        return None

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Block tool execution when the budget is exhausted.

        When ``_exceeded`` is True, returns a synthetic ToolMessage
        instructing the model to summarise instead of running the tool.
        The model then produces a final response with no tool calls,
        and the graph terminates naturally.
        """
        if self._exceeded:
            tool_call = request.tool_call
            tool_name = tool_call.get("name", "unknown")
            logger.info(
                "Cost cap: Blocking execution of '%s' (id=%s) — "
                "budget exceeded ($%.4f >= $%.2f)",
                tool_name,
                tool_call.get("id", "?"),
                self._running_cost,
                self._max_cost_usd,
            )
            return ToolMessage(
                content=(
                    "[Budget exceeded: tool execution blocked. "
                    "Summarize your progress for the user.]"
                ),
                tool_call_id=tool_call["id"],
                name=tool_name,
            )

        return await handler(request)

    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Log cost cap usage stats at the end of execution."""
        pct_used = (
            (self._running_cost / self._max_cost_usd * 100)
            if self._max_cost_usd > 0
            else 0
        )
        logger.info(
            "Cost cap summary: $%.4f of $%.2f used (~%.0f%%) "
            "across %d model calls, warned=%s, exceeded=%s",
            self._running_cost,
            self._max_cost_usd,
            pct_used,
            self._model_call_count,
            self._warned,
            self._exceeded,
        )
        return None

    def for_sub_agent(self) -> "_CostCapSubAgentView":
        """Create a sub-agent view that shares this instance's cost state.

        The view delegates ``aafter_model`` and ``awrap_tool_call`` to this
        instance so sub-agent model calls accumulate against the same budget.
        ``abefore_agent`` is a no-op on the view — the parent instance owns
        the lifecycle reset.

        Returns a lightweight ``AgentMiddleware`` suitable for inclusion in
        a sub-agent's middleware list via ``compile_subagent``.
        """
        return _CostCapSubAgentView(self)


class _CostCapSubAgentView(AgentMiddleware):
    """Read-through view of a parent ``CostCapMiddleware`` for sub-agents.

    All cost accounting is delegated to the parent instance.  The only
    behavioural difference: ``abefore_agent`` does **not** reset cost
    state — the parent graph's ``abefore_agent`` is the single owner of
    the lifecycle reset.
    """

    __slots__ = ("_parent",)

    def __init__(self, parent: CostCapMiddleware) -> None:
        self._parent = parent

    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        return None

    async def aafter_model(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        return await self._parent.aafter_model(state, runtime)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        return await self._parent.awrap_tool_call(request, handler)

    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        return None
