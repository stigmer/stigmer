"""Tool result truncation middleware for context budget enforcement.

Prevents any single tool result from consuming an excessive share of the
LLM's context window.  Applied uniformly to ALL tools (platform tools,
MCP tools, resource tools) via a single ``awrap_tool_call`` hook.

    awrap_tool_call -- Wraps every tool execution.  After the tool handler
                       returns, checks ``len(result.content)`` against the
                       configured character limit.  When exceeded, the
                       content is prefix-truncated and a marker is appended
                       telling the LLM to request specific sections.

Architecture note
-----------------
This middleware is the **context budget** layer.  It sits above the
per-tool ``truncate_tool_output()`` in ``tool_wrappers.py``, which acts as
a **smart formatting** layer at 120 K chars with head+tail truncation for
platform tools only.

The two layers serve different purposes:

    tool_wrappers.py  (120 K, head+tail)  — preserves useful head/tail
                                            content for shell output, but
                                            only covers platform tools.
    ToolTruncationMiddleware  (30 K default, prefix-only) — enforces a
                                            configurable token ceiling per
                                            tool result across ALL tools.

This middleware is always injected by ``create_deep_agent`` with a
sensible default (30 000 chars ≈ 7 500 tokens).  The limit is
configurable via ``ExecutionConfig.max_tool_result_chars``.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langchain_core.messages import ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

logger = logging.getLogger(__name__)

_DEFAULT_MAX_CHARS = 30_000
"""Platform default: 30 000 chars ≈ 7 500 tokens.

Generous enough for most useful tool outputs while preventing the
50–100 K character context spikes from ``cat`` on large files or verbose
shell/MCP output.
"""


class ToolTruncationMiddleware(AgentMiddleware):
    """Middleware that truncates oversized tool results before they enter state.

    Wraps every tool call via ``awrap_tool_call``.  When the tool result
    content exceeds ``max_chars``, the content is prefix-truncated and a
    marker is appended instructing the LLM to request specific sections.

    An optional ``on_truncation`` callback is invoked whenever truncation
    occurs, enabling the caller to track cumulative truncated characters
    in usage metrics.

    Example::

        >>> middleware = ToolTruncationMiddleware(
        ...     max_chars=30_000,
        ...     on_truncation=lambda name, chars: print(f"{name}: {chars} chars cut"),
        ... )
        >>> # Auto-injected in create_deep_agent() by default

    Args:
        max_chars: Maximum characters per tool result.  Results exceeding
            this limit are prefix-truncated with a marker appended.
            Default: 30 000.
        on_truncation: Optional callback invoked on each truncation event.
            Receives ``(tool_name: str, chars_truncated: int)``.  Useful
            for accumulating ``UsageMetrics.tool_result_chars_truncated``.
    """

    def __init__(
        self,
        max_chars: int = _DEFAULT_MAX_CHARS,
        on_truncation: Callable[[str, int], None] | None = None,
    ) -> None:
        if max_chars <= 0:
            raise ValueError(f"max_chars must be positive, got {max_chars}.")

        self._max_chars = max_chars
        self._on_truncation = on_truncation
        self._truncation_count = 0
        self._total_chars_truncated = 0

        logger.info(
            "Tool truncation middleware initialized: max_chars=%d",
            max_chars,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def truncation_count(self) -> int:
        """Number of tool results that were truncated."""
        return self._truncation_count

    @property
    def total_chars_truncated(self) -> int:
        """Cumulative characters removed across all truncations."""
        return self._total_chars_truncated

    def _build_truncation_marker(self, original_chars: int) -> str:
        """Build the marker appended to truncated results."""
        return (
            f"\n\n[truncated — result was {original_chars:,} chars, "
            f"exceeded {self._max_chars:,} char limit. "
            f"Ask for specific sections or narrow your query.]"
        )

    # ------------------------------------------------------------------
    # AgentMiddleware hooks
    # ------------------------------------------------------------------

    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Reset per-invocation counters."""
        self._truncation_count = 0
        self._total_chars_truncated = 0
        logger.debug("Tool truncation state reset for new invocation")
        return None

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Run the tool, then truncate the result if it exceeds the limit.

        Only truncates ``ToolMessage`` results with string content.
        ``Command`` results and non-string content (e.g. multimodal
        content blocks) pass through unchanged.
        """
        result = await handler(request)

        if not isinstance(result, ToolMessage):
            return result

        content = result.content
        if not isinstance(content, str):
            return result

        if len(content) <= self._max_chars:
            return result

        original_chars = len(content)
        chars_truncated = original_chars - self._max_chars
        marker = self._build_truncation_marker(original_chars)
        truncated_content = content[: self._max_chars] + marker

        self._truncation_count += 1
        self._total_chars_truncated += chars_truncated

        tool_call = request.tool_call
        tool_name = tool_call.get("name", "unknown")

        logger.warning(
            "[TRUNCATED] tool=%s original_chars=%d limit=%d chars_truncated=%d",
            tool_name,
            original_chars,
            self._max_chars,
            chars_truncated,
        )

        if self._on_truncation:
            self._on_truncation(tool_name, chars_truncated)

        return ToolMessage(
            content=truncated_content,
            tool_call_id=tool_call["id"],
            name=tool_name,
        )

    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Log truncation summary at the end of execution."""
        if self._truncation_count > 0:
            logger.info(
                "Tool truncation summary: %d results truncated, "
                "%d total chars removed (limit=%d)",
                self._truncation_count,
                self._total_chars_truncated,
                self._max_chars,
            )
        return None
