"""Middleware for loading MCP tools with persistent client connections.

Manages the lifecycle of ``MultiServerMCPClient`` so that stdio-transport
MCP server subprocesses stay alive for the entire agent execution instead
of being spawned and torn down per tool call.

Lifecycle:

1. ``__init__`` -- if a synchronous event loop is available, tools are
   loaded immediately via ``connect_mcp_client`` (persistent).  If an
   async loop is already running (e.g. inside a Temporal activity),
   loading is deferred.
2. ``abefore_agent`` -- completes deferred loading if needed.
3. Agent runs, tool wrappers invoke ``get_tool()`` to reach cached tools.
4. ``aafter_agent`` -- closes the ``AsyncExitStack``, shutting down all
   MCP server connections / subprocesses.
"""

import asyncio
import logging
from contextlib import AsyncExitStack
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langgraph.runtime import Runtime

from graphton.core.mcp_manager import connect_mcp_client

logger = logging.getLogger(__name__)


class McpToolsLoader(AgentMiddleware):
    """Middleware that loads MCP tools via a persistent client connection.

    The persistent ``MultiServerMCPClient`` is held open by an internal
    ``AsyncExitStack``.  This keeps stdio subprocesses alive so tool
    invocations reuse the same connection instead of spawning new
    processes (which causes ``BrokenResourceError`` on teardown races).

    Example::

        >>> middleware = McpToolsLoader(servers, tool_filter)
        >>> # Tools are loaded immediately (or deferred if in async context)
        >>> tool = middleware.get_tool("search")

    """

    def __init__(
        self,
        servers: dict[str, dict[str, Any]],
        tool_filter: dict[str, list[str]],
        client: Any | None = None,
    ) -> None:
        self.servers = servers
        self.tool_filter = tool_filter
        self._client = client

        self._tools_loaded = False
        self._tools_cache: dict[str, Any] = {}
        self._deferred_loading = False

        self._exit_stack = AsyncExitStack()

        logger.info("Loading MCP tools at agent creation time...")
        self._load_tools_sync()

    # ------------------------------------------------------------------
    # Sync loading (called from __init__)
    # ------------------------------------------------------------------

    def _load_tools_sync(self) -> None:
        """Attempt to load tools synchronously at init time.

        If called from an async context (event loop already running),
        defers loading to ``abefore_agent``.
        """
        try:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    logger.info(
                        "Async context detected (event loop running). "
                        "Deferring tool loading to first invocation."
                    )
                    self._deferred_loading = True
                    return
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            tools = loop.run_until_complete(
                connect_mcp_client(
                    self.servers, self.tool_filter, self._exit_stack,
                    client=self._client,
                )
            )

            if not tools:
                raise RuntimeError(
                    "No MCP tools were loaded. "
                    "Check server accessibility and tool filter."
                )

            self._tools_cache = {tool.name: tool for tool in tools}
            self._tools_loaded = True

            logger.info(
                f"Successfully loaded {len(tools)} MCP tool(s) at creation time: "
                f"{list(self._tools_cache.keys())}"
            )

        except Exception as e:
            logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
            raise RuntimeError(
                f"MCP tool loading failed during initialization: {e}. "
                "Check MCP server connectivity and configuration."
            ) from e

    # ------------------------------------------------------------------
    # Async loading (deferred path)
    # ------------------------------------------------------------------

    async def _load_tools_async(self) -> None:
        """Load tools asynchronously with a persistent client.

        Called from ``abefore_agent()`` when loading was deferred.
        """
        try:
            logger.info("Loading MCP tools (deferred from initialization)...")

            tools = await connect_mcp_client(
                self.servers, self.tool_filter, self._exit_stack,
                client=self._client,
            )

            if not tools:
                raise RuntimeError(
                    "No MCP tools were loaded. "
                    "Check server accessibility and tool filter."
                )

            self._tools_cache = {tool.name: tool for tool in tools}
            self._tools_loaded = True

            logger.info(
                f"Successfully loaded {len(tools)} MCP tool(s) (deferred): "
                f"{list(self._tools_cache.keys())}"
            )

        except Exception as e:
            logger.error(
                f"Failed to load MCP tools (deferred): {e}", exc_info=True,
            )
            raise RuntimeError(
                f"MCP tool loading failed during deferred initialization: {e}. "
                "Check MCP server connectivity and configuration."
            ) from e

    # ------------------------------------------------------------------
    # Middleware lifecycle hooks
    # ------------------------------------------------------------------

    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Complete deferred tool loading if needed."""
        if self._deferred_loading and not self._tools_loaded:
            await self._load_tools_async()
            self._deferred_loading = False
        else:
            logger.debug("MCP tools already loaded, skipping")

        return None

    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Shut down persistent MCP client connections."""
        try:
            await self._exit_stack.aclose()
            logger.info("Closed MCP client connections")
        except Exception as e:
            logger.warning(f"Error closing MCP client connections: {e}")
        return None

    # ------------------------------------------------------------------
    # Tool access
    # ------------------------------------------------------------------

    def get_tool(self, tool_name: str) -> Any:  # noqa: ANN401
        """Get a cached MCP tool by name.

        Raises:
            RuntimeError: If tools haven't been loaded yet.
            ValueError: If tool name not found in cache.
        """
        if not self._tools_loaded:
            raise RuntimeError(
                "MCP tools not loaded yet. This indicates initialization failure "
                "or that middleware.before_agent() hasn't been called yet."
            )

        if tool_name not in self._tools_cache:
            available = list(self._tools_cache.keys())
            raise ValueError(
                f"Tool '{tool_name}' not found in cache. "
                f"Available tools: {available}"
            )

        return self._tools_cache[tool_name]
