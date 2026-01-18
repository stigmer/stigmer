"""Middleware for loading MCP tools at agent creation time.

This middleware loads MCP tools when the agent is created, assuming that
the MCP server configuration is complete and ready to use (authentication
already resolved by the caller).
"""

import asyncio
import logging
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langgraph.runtime import Runtime

from graphton.core.mcp_manager import load_mcp_tools

logger = logging.getLogger(__name__)


class McpToolsLoader(AgentMiddleware):
    """Middleware to load MCP tools at agent creation time.
    
    This middleware loads MCP tools immediately when the agent is created,
    assuming that all MCP server configurations are complete and ready to use
    (i.e., authentication tokens have already been resolved by the caller).
    
    Example:
        >>> servers = {
        ...     "planton-cloud": {
        ...         "transport": "streamable_http",
        ...         "url": "https://mcp.planton.ai/",
        ...         "headers": {
        ...             "Authorization": "Bearer pck_abc123..."
        ...         }
        ...     }
        ... }
        >>> tool_filter = {"planton-cloud": ["list_organizations"]}
        >>> middleware = McpToolsLoader(servers, tool_filter)
        >>> # Tools are loaded immediately (or deferred if in async context)

    """
    
    def __init__(
        self,
        servers: dict[str, dict[str, Any]],
        tool_filter: dict[str, list[str]],
    ) -> None:
        """Initialize MCP tools loader middleware.
        
        Args:
            servers: Dictionary of server_name -> complete MCP server config
                with authentication already resolved.
            tool_filter: Dictionary of server_name -> list of tool names to load.

        """
        self.servers = servers
        self.tool_filter = tool_filter
        
        # Track whether tools have been loaded
        self._tools_loaded = False
        self._tools_cache: dict[str, Any] = {}
        self._deferred_loading = False
        
        # Load tools immediately at agent creation
        logger.info("Loading MCP tools at agent creation time...")
        self._load_tools_sync()
    
    def _load_tools_sync(self) -> None:
        """Load tools synchronously at initialization.
        
        If called from an async context (event loop already running), defers
        tool loading until the first middleware invocation to avoid event loop
        nesting issues.
        """
        try:
            # Get or create event loop for async tool loading
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # We're in an async context (e.g., Temporal activity)
                    # Defer loading until first middleware call to avoid nesting
                    logger.info(
                        "Async context detected (event loop running). "
                        "Deferring tool loading to first invocation."
                    )
                    self._deferred_loading = True
                    return
            except RuntimeError:
                # No event loop in current thread, create one
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # Load tools synchronously (sync context only)
            tools = loop.run_until_complete(
                load_mcp_tools(self.servers, self.tool_filter)
            )
            
            if not tools:
                raise RuntimeError(
                    "No MCP tools were loaded. "
                    "Check server accessibility and tool filter."
                )
            
            # Cache tools by name
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
    
    async def _load_tools_async(self) -> None:
        """Load tools asynchronously.
        
        Called from abefore_agent() when tool loading was deferred due to
        async context at initialization time.
        """
        try:
            logger.info("Loading MCP tools (deferred from initialization)...")
            
            # Load tools asynchronously
            tools = await load_mcp_tools(self.servers, self.tool_filter)
            
            if not tools:
                raise RuntimeError(
                    "No MCP tools were loaded. "
                    "Check server accessibility and tool filter."
                )
            
            # Cache tools by name
            self._tools_cache = {tool.name: tool for tool in tools}
            self._tools_loaded = True
            
            logger.info(
                f"Successfully loaded {len(tools)} MCP tool(s) (deferred): "
                f"{list(self._tools_cache.keys())}"
            )
            
        except Exception as e:
            logger.error(f"Failed to load MCP tools (deferred): {e}", exc_info=True)
            raise RuntimeError(
                f"MCP tool loading failed during deferred initialization: {e}. "
                "Check MCP server connectivity and configuration."
            ) from e
    
    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Load MCP tools if deferred from initialization.
        
        If tool loading was deferred during initialization (due to being in an
        async context), load the tools now.
        
        Args:
            state: Current agent state (unused but required by middleware protocol)
            runtime: Runtime object (unused)
            
        Returns:
            None (tools are cached in instance for wrapper access)
            
        Raises:
            RuntimeError: If MCP tools fail to load

        """
        # If loading was deferred (async context at init), load now
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
        """Cleanup after agent execution (async).
        
        Tools remain cached for the lifetime of the agent.
        
        Args:
            state: Current agent state (unused)
            runtime: Runtime object (production) or dict (tests) - unused
            
        Returns:
            None

        """
        # Keep tools cached permanently
        return None
    
    def get_tool(self, tool_name: str) -> Any:  # noqa: ANN401
        """Get a cached MCP tool by name.
        
        Called by tool wrappers to get the actual MCP tool instance.
        
        Args:
            tool_name: Name of the tool to retrieve
            
        Returns:
            The MCP tool instance
            
        Raises:
            RuntimeError: If tools haven't been loaded yet
            ValueError: If tool name not found in cache
            
        Example:
            >>> tool = middleware.get_tool("list_organizations")

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
