"""Platform-level graceful stop middleware.

Activated externally when the platform signals the runner to stop (e.g. via
the ``ExecutionControlSignal.STOP`` returned by the ``updateStatus`` RPC).
Once activated, this middleware blocks all tool execution and gives the model
one final tool-free round to produce a summary — identical behaviour to
CostCapMiddleware when the budget is exceeded.

This middleware is always injected into the agent graph. It is inert until
``activate()`` is called. Unlike CostCapMiddleware (which is optional and
user-configured), this enforces platform-level directives that apply to all
executions.

Separation from CostCapMiddleware is intentional:
    - CostCapMiddleware = user-configured per-execution budget (optional)
    - GracefulStopMiddleware = platform enforcement (always present)
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

_DEFAULT_STOP_MESSAGE = (
    "The platform has requested this execution to stop. All tool calls are "
    "now blocked. Respond with a concise summary of what you accomplished "
    "and what work remains so the user can continue in their next session."
)


class GracefulStopMiddleware(AgentMiddleware):
    """Middleware that enforces a platform-requested graceful stop.

    Remains inert until ``activate()`` is called. Once activated:

    - ``aafter_model``: Injects a SystemMessage informing the model that
      execution must stop (fires once).
    - ``awrap_tool_call``: Blocks all tool execution with a synthetic
      ToolMessage instructing the model to summarise.

    The model then responds with no tool calls and the graph terminates
    naturally.
    """

    def __init__(self) -> None:
        self._activated = False
        self._message_injected = False
        self._reason: str = ""

    @property
    def activated(self) -> bool:
        """Whether the graceful stop has been triggered."""
        return self._activated

    def activate(self, reason: str = "") -> None:
        """Trigger the graceful stop."""
        if not self._activated:
            self._activated = True
            self._reason = reason
            logger.warning(
                "[PLATFORM_STOP] GracefulStopMiddleware activated — "
                "tools will be blocked (reason=%s)",
                reason or "unspecified",
            )

    def for_sub_agent(self) -> _GracefulStopSubAgentView:
        """Create a sub-agent view sharing the same activation state."""
        return _GracefulStopSubAgentView(self)

    async def aafter_model(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Inject stop message on first model call after activation."""
        if not self._activated or self._message_injected:
            return None

        self._message_injected = True
        msg = self._reason if self._reason else _DEFAULT_STOP_MESSAGE
        return {"messages": [SystemMessage(content=msg)]}

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Block tool execution when graceful stop is active."""
        if not self._activated:
            return await handler(request)

        tool_call = request.tool_call
        tool_name = tool_call.get("name", "unknown")
        logger.info(
            "[PLATFORM_STOP] Blocking tool '%s' (id=%s) — execution stopping",
            tool_name, tool_call.get("id", "?"),
        )
        return ToolMessage(
            content=(
                "[Execution stopped by platform: tool execution blocked. "
                "Summarize your progress for the user.]"
            ),
            tool_call_id=tool_call["id"],
            name=tool_name,
        )


class _GracefulStopSubAgentView(AgentMiddleware):
    """Sub-agent view that delegates to the parent GracefulStopMiddleware."""

    __slots__ = ("_parent",)

    def __init__(self, parent: GracefulStopMiddleware) -> None:
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
