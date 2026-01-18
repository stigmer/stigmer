"""MCP client manager for loading tools from configured servers.

This module handles MCP client initialization, tool loading, and filtering.
It accepts pre-configured server configurations (with auth already injected)
and creates MCP clients accordingly.
"""

import logging
from collections.abc import Sequence
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)


async def load_mcp_tools(
    servers: dict[str, dict[str, Any]],
    tool_filter: dict[str, list[str]],
) -> Sequence[BaseTool]:
    """Load MCP tools from configured servers.
    
    This function:
    1. Accepts pre-configured server dictionaries (with auth already injected)
    2. Initializes MultiServerMCPClient with the provided configurations
    3. Loads all available tools from the servers
    4. Filters tools based on the provided tool_filter
    5. Returns the filtered list of LangChain-compatible tools
    
    Args:
        servers: Dictionary mapping server names to raw MCP server configs.
            These configs should be complete and ready to pass to the MCP client,
            including any authentication headers or other required fields.
            Example: {
                "planton-cloud": {
                    "transport": "streamable_http",
                    "url": "https://mcp.planton.ai/",
                    "headers": {
                        "Authorization": "Bearer token123"
                    }
                }
            }
        tool_filter: Dictionary mapping server names to lists of tool names to load.
            Only tools whose names appear in this filter will be returned.
            Example: {
                "planton-cloud": ["list_organizations", "create_cloud_resource"]
            }
        
    Returns:
        Sequence of LangChain BaseTool instances ready for use
        
    Raises:
        ValueError: If no tools match the filter
        RuntimeError: If MCP client fails to connect or load tools
        
    Example:
        >>> servers = {
        ...     "planton-cloud": {
        ...         "transport": "streamable_http",
        ...         "url": "https://mcp.planton.ai/",
        ...         "headers": {
        ...             "Authorization": "Bearer token123"
        ...         }
        ...     }
        ... }
        >>> tool_filter = {
        ...     "planton-cloud": ["list_organizations", "create_cloud_resource"]
        ... }
        >>> tools = await load_mcp_tools(servers, tool_filter)
        >>> len(tools)
        2

    """
    # Validate inputs
    if not servers:
        raise ValueError("servers cannot be empty. Provide at least one MCP server configuration.")
    
    if not tool_filter:
        raise ValueError("tool_filter cannot be empty. Specify which tools to load.")
    
    logger.info(
        f"Connecting to {len(servers)} MCP server(s): {list(servers.keys())}"
    )
    
    try:
        # Initialize MCP client with the provided server configurations
        # No modification needed - configs are already complete with auth
        mcp_client = MultiServerMCPClient(servers)
        
        # Get all tools from all servers
        all_tools = await mcp_client.get_tools()
        
        logger.info(
            f"Retrieved {len(all_tools)} total tool(s) from MCP server(s): "
            f"{[t.name for t in all_tools]}"
        )
        
        # Filter tools based on configuration
        # Build a set of all requested tool names for fast lookup
        requested_tools: set[str] = set()
        for tool_names in tool_filter.values():
            requested_tools.update(tool_names)
        
        # Filter tools
        filtered_tools = [
            tool for tool in all_tools
            if tool.name in requested_tools
        ]
        
        # Validate we found tools
        if not filtered_tools:
            available_names = [t.name for t in all_tools]
            raise ValueError(
                f"No tools found matching filter. "
                f"Available tools: {available_names}, "
                f"Requested tools: {sorted(requested_tools)}"
            )
        
        # Log what we're returning
        loaded_names = [t.name for t in filtered_tools]
        logger.info(
            f"Loaded {len(filtered_tools)} MCP tool(s): {loaded_names}"
        )
        
        # Check if any requested tools were not found
        found_names = set(loaded_names)
        missing_tools = requested_tools - found_names
        if missing_tools:
            logger.warning(
                f"Some requested tools were not found: {sorted(missing_tools)}"
            )
        
        return filtered_tools
        
    except ValueError:
        # Re-raise validation errors as-is
        raise
    except Exception as e:
        logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
        raise RuntimeError(
            f"MCP tool loading failed: {e}. "
            "Check MCP server connectivity and configuration."
        ) from e
