"""Execution budget middleware for autonomous agents.

Supports two operating modes:

**Threshold mode** (default, used when ``warning_interval`` is ``None``):
    Fires a single SystemMessage at a computed percentage of the
    LangGraph recursion limit.  Designed for agents with an explicit
    recursion_limit — gives the model a chance to wrap up before
    ``GraphRecursionError``.

**Periodic mode** (used when ``warning_interval`` is set):
    Fires a SystemMessage every *N* model rounds with escalating
    urgency.  Designed for agents running with effectively unlimited
    recursion where a hard ceiling is not the safety mechanism — loop
    detection and cost caps handle that.  Periodic nudges keep the model
    aware of elapsed work and encourage efficient task completion.

Hooks
-----
    awrap_model_call -- Wraps every model call.  Increments the round
                        counter after the call returns and, when the
                        threshold is reached, appends the advisory to
                        the *next* model call's input messages.  This
                        avoids injecting a message between AIMessage
                        (tool_use) and ToolMessage (tool_result) in the
                        LangGraph state, which violates Anthropic's
                        message ordering constraint.

    abefore_agent   -- Resets per-invocation state at the start of each
                       graph invocation.

    aafter_agent    -- Logs budget usage stats at the end of execution.
"""

import dataclasses
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware.types import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)
from langchain_core.messages import SystemMessage
from langgraph.runtime import Runtime

logger = logging.getLogger(__name__)

_DEFAULT_RECURSION_LIMIT = 6000
_DEFAULT_WARNING_PCT = 80
_MIN_WARNING_PCT = 50
_MAX_WARNING_PCT = 95
_MIN_ROUNDS_BEFORE_WARNING = 3

_PERIODIC_MESSAGES: tuple[str, ...] = (
    "You have been working for {rounds} model rounds. "
    "If your task is nearing completion, start wrapping up. "
    "Summarize progress so far and outline any remaining steps.",

    "Extended execution: {rounds} model rounds. "
    "Prioritize completing your current task now. "
    "Summarize results and any remaining work so the user can "
    "continue in the next message.",

    "Long-running execution: {rounds} model rounds. "
    "Wrap up your work — provide your findings and conclude. "
    "If you cannot finish, summarize what you accomplished and "
    "what remains.",

    "Critical: {rounds} model rounds reached. "
    "Provide your final answer immediately with whatever "
    "information you have gathered. Do not start new tool calls "
    "unless absolutely essential to your conclusion.",
)


class ExecutionBudgetMiddleware(AgentMiddleware):
    """Middleware that nudges the model when execution is running long.

    **Threshold mode** (``warning_interval=None``, the default):
        Injects a single SystemMessage at ~``warning_pct``% of the
        estimated model-round budget derived from ``recursion_limit``.
        Matches the original single-shot design.

    **Periodic mode** (``warning_interval=N``):
        Injects a SystemMessage every *N* model rounds with escalating
        urgency, up to ``max_warnings`` times.  No dependency on
        ``recursion_limit`` for timing — the interval is absolute.

    Examples::

        # Threshold mode (main agent with explicit recursion_limit)
        ExecutionBudgetMiddleware(recursion_limit=600, warning_pct=80)

        # Periodic mode (sub-agent, unlimited recursion)
        ExecutionBudgetMiddleware(warning_interval=30, max_warnings=4)

        # Periodic mode (main agent, unlimited recursion)
        ExecutionBudgetMiddleware(warning_interval=50, max_warnings=4)

    Args:
        recursion_limit: Used in threshold mode to compute the warning
            round.  Ignored in periodic mode.  Default: 6000.
        warning_pct: Percentage of the budget at which to inject the
            warning in threshold mode.  Default: 80.
        warning_interval: Model rounds between periodic warnings.
            ``None`` (default) selects threshold mode.
        max_warnings: Maximum number of periodic warnings to inject.
            After this many, the middleware goes silent.  Default: 4.
    """

    def __init__(
        self,
        recursion_limit: int = _DEFAULT_RECURSION_LIMIT,
        warning_pct: int = _DEFAULT_WARNING_PCT,
        *,
        warning_interval: int | None = None,
        max_warnings: int = 4,
    ) -> None:
        if warning_interval is not None:
            if warning_interval <= 0:
                raise ValueError(
                    f"warning_interval must be positive, got {warning_interval}.",
                )
            if max_warnings <= 0:
                raise ValueError(
                    f"max_warnings must be positive, got {max_warnings}.",
                )
        else:
            if not (_MIN_WARNING_PCT <= warning_pct <= _MAX_WARNING_PCT):
                raise ValueError(
                    f"warning_pct must be between {_MIN_WARNING_PCT} and "
                    f"{_MAX_WARNING_PCT}, got {warning_pct}.",
                )
            if recursion_limit <= 0:
                raise ValueError(
                    f"recursion_limit must be positive, got {recursion_limit}.",
                )

        self.recursion_limit = recursion_limit
        self.warning_pct = warning_pct
        self.warning_interval = warning_interval
        self.max_warnings = max_warnings

        self._periodic = warning_interval is not None

        if self._periodic:
            self._next_warning_round = warning_interval
        else:
            self._next_warning_round = self._compute_warning_round(
                recursion_limit, warning_pct,
            )

        self._model_round_count = 0
        self._warning_count = 0
        self._pending_advisory: SystemMessage | None = None

        if self._periodic:
            logger.info(
                "Execution budget middleware initialized (periodic): "
                "interval=%d, max_warnings=%d",
                warning_interval,
                max_warnings,
            )
        else:
            logger.info(
                "Execution budget middleware initialized (threshold): "
                "recursion_limit=%d, warning_pct=%d%%, warning_round=%d",
                recursion_limit,
                warning_pct,
                self._next_warning_round,
            )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_warning_round(recursion_limit: int, warning_pct: int) -> int:
        """Derive the model-round at which to fire the budget warning.

        Each model-tool cycle consumes ~6 LangGraph super-steps (due to
        middleware nodes: before_model, model, 3x after_model, tools), so
        the estimated total model rounds is ``recursion_limit // 6``.  The
        warning fires at ``warning_pct`` percent of that estimate.

        Returns at least ``_MIN_ROUNDS_BEFORE_WARNING`` to avoid warning on
        trivially small limits where the agent barely has room to start.
        """
        estimated_total_rounds = recursion_limit // 6
        threshold = estimated_total_rounds * warning_pct // 100
        return max(threshold, _MIN_ROUNDS_BEFORE_WARNING)

    def _create_threshold_warning(self) -> SystemMessage:
        """Build the SystemMessage for threshold (single-shot) mode."""
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

    def _create_periodic_warning(self) -> SystemMessage:
        """Build the SystemMessage for periodic mode with escalating tone."""
        idx = min(self._warning_count, len(_PERIODIC_MESSAGES)) - 1
        template = _PERIODIC_MESSAGES[max(idx, 0)]
        return SystemMessage(
            content=template.format(rounds=self._model_round_count),
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
        self._warning_count = 0
        self._pending_advisory = None

        if self._periodic:
            self._next_warning_round = self.warning_interval  # type: ignore[assignment]
        else:
            self._next_warning_round = self._compute_warning_round(
                self.recursion_limit, self.warning_pct,
            )

        logger.debug("Execution budget state reset for new invocation")
        return None

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        """Track model rounds and inject budget advisories safely.

        Advisory messages are prepended to the model's *input* rather
        than appended to its *output*.  This ensures the advisory never
        lands between an ``AIMessage(tool_use)`` and its corresponding
        ``ToolMessage(tool_result)`` in the LangGraph state — which
        would violate Anthropic's strict message-ordering constraint and
        cause a ``BadRequestError``.

        Flow:
        1. If a previous round queued a ``_pending_advisory``, prepend
           it to ``request.messages`` so the model sees it as context.
        2. Call the underlying model via ``handler``.
        3. Increment the round counter and evaluate whether the *next*
           round should receive an advisory (stored in
           ``_pending_advisory`` for step 1 of the next call).
        """
        if self._pending_advisory is not None:
            advisory = self._pending_advisory
            self._pending_advisory = None
            messages = list(request.messages)
            messages.append(advisory)
            request = dataclasses.replace(request, messages=messages)

        response = await handler(request)

        self._model_round_count += 1
        self._evaluate_budget()

        return response

    def _evaluate_budget(self) -> None:
        """Check if the current round triggers an advisory for the next call."""
        if self._periodic:
            if self._warning_count >= self.max_warnings:
                return

            if self._model_round_count >= self._next_warning_round:
                self._warning_count += 1
                self._next_warning_round += self.warning_interval  # type: ignore[operator]

                logger.warning(
                    "EXECUTION BUDGET ADVISORY (%d/%d): "
                    "model round %d (interval=%d). "
                    "Queuing periodic guidance for next model call.",
                    self._warning_count,
                    self.max_warnings,
                    self._model_round_count,
                    self.warning_interval,
                )

                self._pending_advisory = self._create_periodic_warning()

        else:
            if self._warning_count > 0:
                return

            if self._model_round_count >= self._next_warning_round:
                self._warning_count = 1

                estimated_total = self.recursion_limit // 6
                logger.warning(
                    "EXECUTION BUDGET WARNING: model round %d of ~%d "
                    "(~%d%% of recursion_limit=%d used). "
                    "Queuing wrap-up guidance for next model call.",
                    self._model_round_count,
                    estimated_total,
                    self.warning_pct,
                    self.recursion_limit,
                )

                self._pending_advisory = self._create_threshold_warning()

    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Log budget usage stats at the end of execution."""
        if self._periodic:
            logger.info(
                "Execution budget summary (periodic): %d model rounds, "
                "%d/%d advisories issued (interval=%d)",
                self._model_round_count,
                self._warning_count,
                self.max_warnings,
                self.warning_interval,
            )
        else:
            estimated_total = self.recursion_limit // 6
            pct_used = (
                (self._model_round_count * 100 // estimated_total)
                if estimated_total > 0
                else 0
            )
            logger.info(
                "Execution budget summary (threshold): %d model rounds "
                "of ~%d estimated (~%d%% used), warnings=%d",
                self._model_round_count,
                estimated_total,
                pct_used,
                self._warning_count,
            )
        return None
