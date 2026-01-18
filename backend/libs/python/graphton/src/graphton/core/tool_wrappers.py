"""Tool wrapper generator for MCP tools.

This module dynamically creates @tool decorated wrapper functions for MCP tools.
The wrappers delegate to actual MCP tools loaded by the middleware, eliminating
the need for manual wrapper code in each agent.

For dynamic MCP configurations (with template variables), this module provides
lazy tool wrappers that defer tool loading until first invocation, allowing
graphs to be created at module import time without requiring user credentials.
"""

import logging
from collections.abc import Callable
from typing import Any

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def create_tool_wrapper(
    tool_name: str,
    middleware_instance: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create a wrapper function for an MCP tool.
    
    The generated wrapper:
    1. Gets the actual MCP tool from middleware cache
    2. Invokes the tool with provided arguments
    3. Returns the tool result
    
    This eliminates the need to manually write wrapper functions for each MCP tool.
    
    Args:
        tool_name: Name of the MCP tool to wrap
        middleware_instance: McpToolsLoader instance with cached tools
        
    Returns:
        A @tool decorated function that delegates to the MCP tool
        
    Raises:
        RuntimeError: If tool metadata cannot be copied from original
        
    Example:
        >>> from graphton.core.middleware import McpToolsLoader
        >>> from graphton.core.tool_wrappers import create_tool_wrapper
        >>> 
        >>> # Assume middleware is initialized and tools are loaded
        >>> wrapper = create_tool_wrapper("list_organizations", middleware)
        >>> result = wrapper()  # Invokes actual MCP tool

    """
    # Pre-validate that tool exists in middleware cache
    # This will raise clear error if tool not found
    try:
        actual_tool = middleware_instance.get_tool(tool_name)
    except (RuntimeError, ValueError) as e:
        logger.error(f"Failed to create wrapper for '{tool_name}': {e}")
        raise RuntimeError(
            f"Cannot create wrapper for tool '{tool_name}': {e}"
        ) from e
    
    # Create the wrapper function
    @tool
    async def wrapper(**kwargs: Any) -> Any:  # noqa: ANN401
        """Auto-generated wrapper for MCP tool.
        
        This wrapper:
        - Gets the actual MCP tool from middleware
        - Invokes the tool with arguments
        - Returns the result
        """
        logger.debug(f"Invoking MCP tool '{tool_name}'")
        
        # Get actual MCP tool from middleware cache
        try:
            mcp_tool = middleware_instance.get_tool(tool_name)
        except (RuntimeError, ValueError) as e:
            logger.error(f"Failed to get tool '{tool_name}' from cache: {e}")
            raise RuntimeError(
                f"Tool '{tool_name}' not available. "
                "Ensure middleware loaded tools successfully."
            ) from e
        
        # Invoke the actual MCP tool with provided arguments
        try:
            # Phase 1 Diagnostic Logging: Capture exact argument structure
            logger.info(f"=== MCP Tool Invocation Diagnostics for '{tool_name}' ===")
            logger.info(f"kwargs type: {type(kwargs)}")
            logger.info(f"kwargs value: {kwargs}")
            logger.info(f"kwargs keys: {list(kwargs.keys()) if isinstance(kwargs, dict) else 'N/A - not a dict'}")
            
            # Inspect the MCP tool's expected schema
            if hasattr(mcp_tool, 'args_schema'):
                logger.info(f"Tool args_schema: {mcp_tool.args_schema}")
            if hasattr(mcp_tool, 'name'):
                logger.info(f"Tool name from object: {mcp_tool.name}")
            
            # Check for double-nesting and unwrap if needed (FIX for argument marshalling)
            actual_args = kwargs
            if isinstance(kwargs, dict):
                if len(kwargs) == 1 and 'input' in kwargs:
                    logger.warning("⚠️  Double-nesting detected: unwrapping 'input' key")
                    logger.info(f"Value inside 'input': {kwargs.get('input')}")
                    actual_args = kwargs['input']
                elif len(kwargs) == 1 and 'kwargs' in kwargs:
                    logger.warning("⚠️  Double-nesting detected: unwrapping 'kwargs' key")
                    logger.info(f"Value inside 'kwargs': {kwargs.get('kwargs')}")
                    actual_args = kwargs['kwargs']
            
            logger.info(f"Calling mcp_tool.ainvoke() with (after unwrapping): {actual_args}")
            result = await mcp_tool.ainvoke(actual_args)
            logger.info(f"✅ MCP tool '{tool_name}' returned successfully")
            logger.info(f"Result type: {type(result)}")
            logger.info(f"=== End Diagnostics for '{tool_name}' ===")
            return result
        except Exception as e:
            logger.error(
                f"MCP tool '{tool_name}' invocation failed: {e}",
                exc_info=True
            )
            raise RuntimeError(
                f"MCP tool '{tool_name}' invocation failed: {e}"
            ) from e
    
    # Copy metadata from original tool for better LangChain integration
    try:
        # Set the tool name
        wrapper.name = tool_name  # type: ignore[attr-defined]
        wrapper.description = actual_tool.description  # type: ignore[attr-defined]
        
        # If the tool has additional metadata, preserve it
        if hasattr(actual_tool, 'args_schema'):
            wrapper.args_schema = actual_tool.args_schema  # type: ignore[attr-defined]
        
        logger.debug(
            f"Created wrapper for MCP tool '{tool_name}' with "
            f"description: {actual_tool.description[:100] if actual_tool.description else 'None'}..."
        )
        
    except Exception as e:
        logger.warning(
            f"Failed to copy metadata from tool '{tool_name}': {e}. "
            "Wrapper will work but may have incomplete metadata."
        )
    
    return wrapper  # type: ignore[return-value]


def create_lazy_tool_wrapper(
    tool_name: str,
    middleware_instance: Any,  # noqa: ANN401
) -> Callable[..., Any]:
    """Create a lazy wrapper for an MCP tool in dynamic mode.
    
    Unlike create_tool_wrapper, this function does NOT attempt to access the
    tool during wrapper creation. Instead, it creates a placeholder that resolves
    the actual tool on first invocation. This allows graphs to be created at module
    import time even when MCP tools aren't loaded yet (dynamic authentication).
    
    The generated wrapper:
    1. On first invocation: Gets the actual tool from middleware (now loaded)
    2. Invokes the tool with provided arguments
    3. Returns the tool result
    
    Args:
        tool_name: Name of the MCP tool to wrap
        middleware_instance: McpToolsLoader instance (tools loaded at runtime)
        
    Returns:
        A @tool decorated function that lazily resolves to the MCP tool
        
    Example:
        >>> from graphton.core.middleware import McpToolsLoader
        >>> from graphton.core.tool_wrappers import create_lazy_tool_wrapper
        >>> 
        >>> # Create wrapper before tools are loaded (OK in lazy mode)
        >>> middleware = McpToolsLoader(servers, tool_filter)
        >>> wrapper = create_lazy_tool_wrapper("list_organizations", middleware)
        >>> 
        >>> # Later, when agent is invoked with config:
        >>> # middleware.before_agent() loads tools
        >>> # wrapper() now works because tools are loaded
        >>> result = wrapper()
    
    """
    # Create the lazy wrapper function
    # Note: We do NOT access middleware_instance.get_tool() here
    # That would fail in dynamic mode since tools aren't loaded yet
    @tool
    async def lazy_wrapper(**kwargs: Any) -> Any:  # noqa: ANN401
        """Auto-generated lazy wrapper for MCP tool (dynamic mode).
        
        This wrapper:
        - Resolves the actual tool on first invocation (after middleware loads it)
        - Invokes the tool with arguments
        - Returns the result
        """
        logger.debug(f"Invoking MCP tool '{tool_name}' (lazy mode)")
        
        # NOW get the actual MCP tool from middleware cache
        # At this point, middleware.before_agent() has run and loaded tools
        try:
            mcp_tool = middleware_instance.get_tool(tool_name)
        except (RuntimeError, ValueError) as e:
            logger.error(
                f"Failed to get tool '{tool_name}' from cache in lazy mode: {e}. "
                f"This likely means middleware.before_agent() hasn't been called yet."
            )
            raise RuntimeError(
                f"Tool '{tool_name}' not available. "
                "Ensure middleware loaded tools successfully before invoking."
            ) from e
        
        # Invoke the actual MCP tool with provided arguments
        try:
            # Phase 1 Diagnostic Logging: Capture exact argument structure (lazy mode)
            logger.info(f"=== MCP Tool Invocation Diagnostics for '{tool_name}' (LAZY MODE) ===")
            logger.info(f"kwargs type: {type(kwargs)}")
            logger.info(f"kwargs value: {kwargs}")
            logger.info(f"kwargs keys: {list(kwargs.keys()) if isinstance(kwargs, dict) else 'N/A - not a dict'}")
            
            # Inspect the MCP tool's expected schema
            if hasattr(mcp_tool, 'args_schema'):
                logger.info(f"Tool args_schema: {mcp_tool.args_schema}")
            if hasattr(mcp_tool, 'name'):
                logger.info(f"Tool name from object: {mcp_tool.name}")
            
            # Check for double-nesting and unwrap if needed (FIX for argument marshalling)
            actual_args = kwargs
            if isinstance(kwargs, dict):
                if len(kwargs) == 1 and 'input' in kwargs:
                    logger.warning("⚠️  Double-nesting detected: unwrapping 'input' key")
                    logger.info(f"Value inside 'input': {kwargs.get('input')}")
                    actual_args = kwargs['input']
                elif len(kwargs) == 1 and 'kwargs' in kwargs:
                    logger.warning("⚠️  Double-nesting detected: unwrapping 'kwargs' key")
                    logger.info(f"Value inside 'kwargs': {kwargs.get('kwargs')}")
                    actual_args = kwargs['kwargs']
            
            logger.info(f"Calling mcp_tool.ainvoke() with (after unwrapping): {actual_args}")
            result = await mcp_tool.ainvoke(actual_args)
            logger.info(f"✅ MCP tool '{tool_name}' returned successfully (lazy mode)")
            logger.info(f"Result type: {type(result)}")
            logger.info(f"=== End Diagnostics for '{tool_name}' (LAZY MODE) ===")
            return result
        except Exception as e:
            logger.error(
                f"MCP tool '{tool_name}' invocation failed (lazy mode): {e}",
                exc_info=True
            )
            raise RuntimeError(
                f"MCP tool '{tool_name}' invocation failed: {e}"
            ) from e
    
    # Set basic metadata for the lazy wrapper
    # We can't copy from actual tool yet (not loaded), so use minimal metadata
    try:
        lazy_wrapper.name = tool_name  # type: ignore[attr-defined]
        lazy_wrapper.description = (  # type: ignore[attr-defined]
            f"MCP tool '{tool_name}' (loaded dynamically at invocation)"
        )
        
        logger.debug(
            f"Created lazy wrapper for MCP tool '{tool_name}' (dynamic mode). "
            "Tool will be resolved on first invocation."
        )
        
    except Exception as e:
        logger.warning(
            f"Failed to set metadata on lazy wrapper for '{tool_name}': {e}. "
            "Wrapper will still work."
        )
    
    return lazy_wrapper  # type: ignore[return-value]


def create_tool_wrappers_for_server(
    server_name: str,
    tool_names: list[str],
    middleware_instance: Any,  # noqa: ANN401
) -> list[Callable[..., Any]]:
    """Create wrapper functions for all tools from an MCP server.
    
    Convenience function to create multiple wrappers at once.
    
    Args:
        server_name: Name of the MCP server (for logging)
        tool_names: List of tool names to create wrappers for
        middleware_instance: McpToolsLoader instance with cached tools
        
    Returns:
        List of wrapper functions
        
    Raises:
        RuntimeError: If any wrapper fails to be created
        
    Example:
        >>> wrappers = create_tool_wrappers_for_server(
        ...     "planton-cloud",
        ...     ["list_organizations", "create_cloud_resource"],
        ...     middleware
        ... )
        >>> len(wrappers)
        2

    """
    wrappers = []
    
    for tool_name in tool_names:
        try:
            wrapper = create_tool_wrapper(tool_name, middleware_instance)
            wrappers.append(wrapper)
        except Exception as e:
            logger.error(
                f"Failed to create wrapper for '{tool_name}' from server '{server_name}': {e}"
            )
            raise RuntimeError(
                f"Failed to create tool wrappers for server '{server_name}': {e}"
            ) from e
    
    logger.info(
        f"Created {len(wrappers)} tool wrapper(s) for server '{server_name}': "
        f"{tool_names}"
    )
    
    return wrappers

