"""Billing stop middleware for credit exhaustion enforcement.

Activated externally when the billing service returns a STOP signal. Once
activated, this middleware blocks all tool execution (giving the model one
final tool-free round to produce a summary) — identical behaviour to
CostCapMiddleware when the budget is exceeded.

This middleware is always injected into the agent graph. It is inert until
``activate()`` is called. Unlike CostCapMiddleware (which is optional and
user-configured), this enforces platform-level credit limits that apply to
all executions with an active billing reservation.

Separation from CostCapMiddleware is intentional:
    - CostCapMiddleware = user-configured per-execution budget (optional)
    - BillingStopMiddleware = platform credit enforcement (always present)
    They coexist without interference: whichever fires first wins.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langchain_core.messages import SystemMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

logger = logging.getLogger(__name__)

_STOP_MESSAGE = (
    "Your credit balance has been exhausted. All tool calls are now blocked. "
    "Respond with a concise summary of what you accomplished and what work "
    "remains so the user can continue in their next session."
)


class BillingStopMiddleware(AgentMiddleware):
    """Middleware that enforces billing credit exhaustion.

    Remains inert until ``activate()`` is called by the billing signal
    handler. Once activated:

    - ``aafter_model``: Injects a SystemMessage informing the model that
      credits are exhausted (fires once).
    - ``awrap_tool_call``: Blocks all tool execution with a synthetic
      ToolMessage instructing the model to summarise.

    The model then responds with no tool calls and the graph terminates
    naturally.
    """

    def __init__(self) -> None:
        self._activated = False
        self._message_injected = False

    @property
    def activated(self) -> bool:
        """Whether the billing stop has been triggered."""
        return self._activated

    def activate(self) -> None:
        """Trigger the billing stop. Called by the billing signal handler."""
        if not self._activated:
            self._activated = True
            logger.warning("[BILLING] BillingStopMiddleware activated — tools will be blocked")

    def for_sub_agent(self) -> _BillingStopSubAgentView:
        """Create a sub-agent view sharing the same activation state."""
        return _BillingStopSubAgentView(self)

    async def aafter_model(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Inject stop message on first model call after activation."""
        if not self._activated or self._message_injected:
            return None

        self._message_injected = True
        return {"messages": [SystemMessage(content=_STOP_MESSAGE)]}

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Block tool execution when billing stop is active."""
        if not self._activated:
            return await handler(request)

        tool_call = request.tool_call
        tool_name = tool_call.get("name", "unknown")
        logger.info(
            "[BILLING] Blocking tool '%s' (id=%s) — credits exhausted",
            tool_name, tool_call.get("id", "?"),
        )
        return ToolMessage(
            content=(
                "[Credits exhausted: tool execution blocked. "
                "Summarize your progress for the user.]"
            ),
            tool_call_id=tool_call["id"],
            name=tool_name,
        )


class _BillingStopSubAgentView(AgentMiddleware):
    """Sub-agent view that delegates to the parent BillingStopMiddleware."""

    __slots__ = ("_parent",)

    def __init__(self, parent: BillingStopMiddleware) -> None:
        self._parent = parent

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
