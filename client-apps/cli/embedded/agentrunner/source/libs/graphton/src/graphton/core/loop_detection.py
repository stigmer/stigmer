"""Loop detection middleware for autonomous agents.

Detects and prevents infinite loops by tracking tool invocations across two
complementary hooks:

    aafter_model  -- Runs after every model call. Inspects the AIMessage's
                     tool_calls, tracks signatures (tool name + param hash)
                     in a sliding window, and injects SystemMessage
                     interventions when repetitive patterns are detected.

    awrap_tool_call -- Wraps every tool execution. When the total-repetition
                       threshold has been exceeded and ``_stopped`` is True,
                       short-circuits tool execution by returning a ToolMessage
                       without calling the handler, preventing wasted
                       computation on tools the agent no longer needs.

The original implementation placed all detection logic in ``aafter_step``,
which is not a valid AgentMiddleware hook and was never invoked by the
LangGraph agent loop. This module replaces that dead code with the hooks
above.

Key features:
- Tracks last N tool invocations with parameter hashing
- Detects consecutive repetitions (same tool, similar params)
- Injects intervention messages to guide agent toward completion
- Enforces hard stop by blocking tool execution at total threshold
- Per-invocation state tracking (cleared between agent runs)
- Configurable thresholds and intervention strategies
"""

import hashlib
import json
import logging
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

logger = logging.getLogger(__name__)


class LoopDetectionMiddleware(AgentMiddleware):
    """Middleware to detect and prevent infinite loops in agent execution.

    Uses a two-hook architecture:

    ``aafter_model`` (detection + intervention)
        After each model call, inspects the AIMessage's tool_calls and
        tracks them in a fixed-size sliding window.  When the consecutive
        threshold is reached, a warning SystemMessage is injected into
        state.  When the total threshold is reached, a final stop
        SystemMessage is injected and the ``_stopped`` flag is set.

    ``awrap_tool_call`` (enforcement)
        Wraps every tool call.  When ``_stopped`` is True, returns a
        ToolMessage explaining that tool execution has been halted,
        without invoking the actual tool.  This prevents wasted
        computation after the total threshold is exceeded.

    Detection Algorithm:
        1. Track last N tool calls (tool name + parameter hash)
        2. Detect consecutive_threshold+ identical calls -> inject warning
        3. Detect total_threshold+ repetitions -> inject stop + block tools
        4. Configurable thresholds per use case

    Example::

        >>> middleware = LoopDetectionMiddleware(
        ...     history_size=10,
        ...     consecutive_threshold=3,
        ...     total_threshold=5,
        ... )
        >>> # Auto-injected in create_deep_agent() by default

    Args:
        history_size: Number of recent tool calls to track (default: 10)
        consecutive_threshold: Consecutive repeats before warning (default: 3)
        total_threshold: Total repetitions before hard stop (default: 5)
        enabled: Whether loop detection is active (default: True)
    """

    def __init__(
        self,
        history_size: int = 10,
        consecutive_threshold: int = 3,
        total_threshold: int = 5,
        enabled: bool = True,
    ) -> None:
        self.history_size = history_size
        self.consecutive_threshold = consecutive_threshold
        self.total_threshold = total_threshold
        self.enabled = enabled

        self._tool_history: deque[tuple[str, str]] = deque(maxlen=history_size)
        self._intervention_count = 0
        self._stopped = False

        logger.info(
            "Loop detection middleware initialized: "
            "history_size=%d, consecutive_threshold=%d, "
            "total_threshold=%d, enabled=%s",
            history_size,
            consecutive_threshold,
            total_threshold,
            enabled,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _hash_params(self, params: dict[str, Any]) -> str:
        """Create a stable hash of tool parameters for comparison.

        Args:
            params: Tool parameters dictionary

        Returns:
            First 16 hex characters of the SHA-256 digest.
        """
        try:
            normalized = json.dumps(params, sort_keys=True, default=str)
            return hashlib.sha256(normalized.encode()).hexdigest()[:16]
        except Exception:
            logger.warning("Failed to hash tool parameters, using fallback", exc_info=True)
            return "error"

    def _detect_consecutive_loops(self) -> tuple[bool, str, int]:
        """Detect if the same tool+params is being called repeatedly.

        Returns:
            ``(is_loop, tool_name, consecutive_count)``
        """
        if not self._tool_history:
            return False, "", 0

        recent_tool, recent_hash = self._tool_history[-1]

        consecutive_count = 1
        for tool_name, param_hash in reversed(list(self._tool_history)[:-1]):
            if tool_name == recent_tool and param_hash == recent_hash:
                consecutive_count += 1
            else:
                break

        is_loop = consecutive_count >= self.consecutive_threshold
        return is_loop, recent_tool, consecutive_count

    def _detect_total_repetitions(self) -> tuple[bool, str, int]:
        """Detect if a tool+params combination has been called too many times.

        Returns:
            ``(is_excessive, tool_name, total_count)``
        """
        if not self._tool_history:
            return False, "", 0

        recent_signature = self._tool_history[-1]

        total_count = sum(1 for sig in self._tool_history if sig == recent_signature)

        is_excessive = total_count >= self.total_threshold
        return is_excessive, recent_signature[0], total_count

    def _create_intervention_message(
        self,
        tool_name: str,
        consecutive_count: int,
        total_count: int,
        *,
        is_final: bool,
    ) -> SystemMessage:
        """Create an intervention message to guide the agent.

        Args:
            tool_name: Name of the repeated tool
            consecutive_count: Number of consecutive repetitions
            total_count: Total number of repetitions
            is_final: Whether this is the final intervention (force stop)

        Returns:
            SystemMessage with intervention guidance
        """
        if is_final:
            content = (
                f"\u26a0\ufe0f LOOP DETECTED: Critical repetition limit reached.\n\n"
                f"You have called '{tool_name}' {total_count} times with similar parameters. "
                f"This indicates you are stuck in a loop and unable to make progress.\n\n"
                f"**You MUST conclude your work now:**\n"
                f"1. Summarize what you have learned so far\n"
                f"2. Explain the obstacle preventing progress\n"
                f"3. Provide your best assessment based on available information\n"
                f"4. Do NOT call '{tool_name}' again\n\n"
                f"Conclude gracefully with the information you have gathered."
            )
        else:
            content = (
                f"\u26a0\ufe0f LOOP WARNING: Repetitive pattern detected.\n\n"
                f"You have called '{tool_name}' {consecutive_count} times in a row. "
                f"This suggests you may be stuck or approaching the problem incorrectly.\n\n"
                f"**Recommended actions:**\n"
                f"1. Try a completely different approach or tool\n"
                f"2. Re-examine your assumptions about the problem\n"
                f"3. Consider if you have enough information to conclude\n"
                f"4. Avoid calling '{tool_name}' again unless absolutely necessary\n\n"
                f"Adapt your strategy to make progress."
            )

        return SystemMessage(content=content)

    # ------------------------------------------------------------------
    # AgentMiddleware hooks
    # ------------------------------------------------------------------

    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Clear tracking state at the start of each agent execution."""
        if not self.enabled:
            return None

        self._tool_history.clear()
        self._intervention_count = 0
        self._stopped = False

        logger.debug("Loop detection state initialized for new execution")
        return None

    async def aafter_model(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Track tool calls and detect loops after each model response.

        Inspects the latest AIMessage's ``tool_calls``, records each
        signature in the sliding window, and checks for repetitive
        patterns.  Returns a state update containing an intervention
        SystemMessage when a threshold is breached, or ``None`` when
        everything looks normal.
        """
        if not self.enabled or self._stopped:
            return None

        messages = state.get("messages", [])
        if not messages:
            return None

        # Find the most recent AIMessage (guaranteed to be present since
        # this hook fires immediately after the model call).
        last_ai_message: AIMessage | None = None
        for msg in reversed(messages):
            if isinstance(msg, AIMessage):
                last_ai_message = msg
                break

        if last_ai_message is None:
            return None

        tool_calls = last_ai_message.tool_calls or []
        if not tool_calls:
            return None

        for tool_call in tool_calls:
            tool_name = tool_call.get("name", "unknown")
            tool_args = tool_call.get("args", {})
            param_hash = self._hash_params(tool_args)

            self._tool_history.append((tool_name, param_hash))

            logger.debug(
                "Tracked tool call: %s (hash: %s), history size: %d",
                tool_name,
                param_hash,
                len(self._tool_history),
            )

            consecutive_loop, cons_tool, cons_count = self._detect_consecutive_loops()
            total_loop, total_tool, total_count = self._detect_total_repetitions()

            if total_loop:
                logger.warning(
                    "LOOP DETECTED - Total threshold exceeded: "
                    "%s called %d times (threshold: %d)",
                    total_tool,
                    total_count,
                    self.total_threshold,
                )

                intervention = self._create_intervention_message(
                    total_tool, cons_count, total_count, is_final=True,
                )
                self._intervention_count += 1
                self._stopped = True

                logger.info(
                    "Loop detection: Final intervention injected, "
                    "tool execution will be blocked via awrap_tool_call"
                )
                return {"messages": [intervention]}

            if consecutive_loop and self._intervention_count == 0:
                logger.warning(
                    "LOOP WARNING - Consecutive threshold reached: "
                    "%s called %d times in a row (threshold: %d)",
                    cons_tool,
                    cons_count,
                    self.consecutive_threshold,
                )

                intervention = self._create_intervention_message(
                    cons_tool, cons_count, total_count, is_final=False,
                )
                self._intervention_count += 1

                logger.info(
                    "Loop detection: Warning intervention injected "
                    "(intervention #%d)",
                    self._intervention_count,
                )
                return {"messages": [intervention]}

        return None

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Enforce hard stop by blocking tool execution after total threshold.

        When ``_stopped`` is True, returns a ToolMessage explaining the
        halt without invoking the actual tool.  This prevents wasted
        computation on tools the agent no longer needs.

        When ``_stopped`` is False, passes through to the real handler
        with zero overhead.
        """
        if self._stopped:
            tool_call = request.tool_call
            logger.info(
                "Loop detection: Blocking execution of '%s' (id=%s) — agent is stopped",
                tool_call.get("name", "unknown"),
                tool_call.get("id", "?"),
            )
            return ToolMessage(
                content=(
                    "[Loop detected: tool execution halted by loop detection middleware. "
                    "Conclude your work with the information you have gathered.]"
                ),
                tool_call_id=tool_call["id"],
                name=tool_call.get("name", "unknown"),
            )

        return await handler(request)

    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Log final loop detection statistics at the end of agent execution."""
        if not self.enabled:
            return None

        if self._tool_history:
            unique_signatures = len(set(self._tool_history))
            logger.info(
                "Loop detection summary: "
                "%d tool calls tracked, %d unique signatures, "
                "%d interventions, stopped=%s",
                len(self._tool_history),
                unique_signatures,
                self._intervention_count,
                self._stopped,
            )

        return None
