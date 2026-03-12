"""Execution budget middleware for autonomous agents.

Provides proactive awareness of the LangGraph recursion limit so the model
can wrap up gracefully instead of being hard-killed by GraphRecursionError.

    aafter_model  -- Runs after every model call.  Increments a round counter
                     and, when approximately 80 % of the budget has been used,
                     injects a single SystemMessage asking the model to
                     prioritise completing its current work.

    abefore_agent -- Resets per-invocation state at the start of each graph
                     invocation (important for multi-turn sessions where the
                     same middleware instance is reused).

    aafter_agent  -- Logs budget usage stats at the end of execution.

Budget estimation
-----------------
LangGraph's ``recursion_limit`` counts *super-steps* (individual node
executions).  Each model→tools cycle consumes ~6 super-steps due to
middleware graph nodes (before_model, model, 3× after_model, tools).
The middleware counts ``aafter_model`` invocations, which correspond to
model rounds.  The warning threshold is derived as::

    warning_round = recursion_limit * warning_pct // 600

For the platform default (``recursion_limit=1000``, ``warning_pct=80``) this
fires at model round 133 (~798 super-steps).  The mapping is approximate —
startup/shutdown overhead consumes ~9 additional steps — but the 80 %
threshold is deliberately soft so ±a few steps is acceptable.
"""

import logging
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langchain_core.messages import SystemMessage
from langgraph.runtime import Runtime

logger = logging.getLogger(__name__)

_DEFAULT_RECURSION_LIMIT = 1000
_DEFAULT_WARNING_PCT = 80
_MIN_WARNING_PCT = 50
_MAX_WARNING_PCT = 95
_MIN_ROUNDS_BEFORE_WARNING = 3


class ExecutionBudgetMiddleware(AgentMiddleware):
    """Middleware that warns the model when it is approaching the step limit.

    Tracks model rounds via ``aafter_model`` and injects a single
    SystemMessage at ~80 % of the estimated budget.  This gives the model
    a chance to wrap up, summarise results, and communicate remaining work
    to the user — turning a hard ``GraphRecursionError`` crash into graceful
    degradation.

    The hard stop at 100 % remains LangGraph's responsibility; this
    middleware only provides the advance warning.

    Example::

        >>> middleware = ExecutionBudgetMiddleware(
        ...     recursion_limit=1000,
        ...     warning_pct=80,
        ... )
        >>> # Auto-injected in create_deep_agent() by default

    Args:
        recursion_limit: The LangGraph recursion_limit applied to the graph.
            Used to compute the warning threshold.  Default: 1000.
        warning_pct: Percentage of the budget at which to inject the warning
            SystemMessage.  Must be between 50 and 95.  Default: 80.
    """

    def __init__(
        self,
        recursion_limit: int = _DEFAULT_RECURSION_LIMIT,
        warning_pct: int = _DEFAULT_WARNING_PCT,
    ) -> None:
        if not (_MIN_WARNING_PCT <= warning_pct <= _MAX_WARNING_PCT):
            raise ValueError(
                f"warning_pct must be between {_MIN_WARNING_PCT} and "
                f"{_MAX_WARNING_PCT}, got {warning_pct}."
            )
        if recursion_limit <= 0:
            raise ValueError(
                f"recursion_limit must be positive, got {recursion_limit}."
            )

        self.recursion_limit = recursion_limit
        self.warning_pct = warning_pct

        self._warning_round = self._compute_warning_round(
            recursion_limit, warning_pct,
        )

        self._model_round_count = 0
        self._warned = False

        logger.info(
            "Execution budget middleware initialized: "
            "recursion_limit=%d, warning_pct=%d%%, warning_round=%d",
            recursion_limit,
            warning_pct,
            self._warning_round,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_warning_round(recursion_limit: int, warning_pct: int) -> int:
        """Derive the model-round at which to fire the budget warning.

        Each model-tool cycle consumes ~6 LangGraph super-steps (due to
        middleware nodes: before_model, model, 3× after_model, tools), so
        the estimated total model rounds is ``recursion_limit // 6``.  The
        warning fires at ``warning_pct`` percent of that estimate.

        Returns at least ``_MIN_ROUNDS_BEFORE_WARNING`` to avoid warning on
        trivially small limits where the agent barely has room to start.
        """
        estimated_total_rounds = recursion_limit // 6
        threshold = estimated_total_rounds * warning_pct // 100
        return max(threshold, _MIN_ROUNDS_BEFORE_WARNING)

    def _create_budget_warning_message(self) -> SystemMessage:
        """Build the SystemMessage injected at the warning threshold."""
        estimated_total = self.recursion_limit // 6
        remaining = max(estimated_total - self._model_round_count, 0)
        return SystemMessage(
            content=(
                "You are approaching the step limit for this message "
                f"(approximately {self.warning_pct}% used, "
                f"~{remaining} rounds remaining). "
                "Prioritize completing your current task. Summarize results "
                "and any remaining work so the user can continue in the "
                "next message."
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
        self._model_round_count = 0
        self._warned = False
        logger.debug("Execution budget state reset for new invocation")
        return None

    async def aafter_model(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Track model rounds and inject a warning when the budget is low.

        Increments the round counter after every model call.  When the
        counter reaches ``_warning_round``, injects a single SystemMessage
        and sets ``_warned`` to prevent repeat warnings.
        """
        self._model_round_count += 1

        if self._warned:
            return None

        if self._model_round_count >= self._warning_round:
            self._warned = True

            estimated_total = self.recursion_limit // 6
            logger.warning(
                "EXECUTION BUDGET WARNING: model round %d of ~%d "
                "(~%d%% of recursion_limit=%d used). "
                "Injecting wrap-up guidance.",
                self._model_round_count,
                estimated_total,
                self.warning_pct,
                self.recursion_limit,
            )

            warning = self._create_budget_warning_message()
            return {"messages": [warning]}

        return None

    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Log budget usage stats at the end of execution."""
        estimated_total = self.recursion_limit // 6
        pct_used = (
            (self._model_round_count * 100 // estimated_total)
            if estimated_total > 0
            else 0
        )
        logger.info(
            "Execution budget summary: %d model rounds of ~%d "
            "estimated (~%d%% used), warned=%s",
            self._model_round_count,
            estimated_total,
            pct_used,
            self._warned,
        )
        return None
