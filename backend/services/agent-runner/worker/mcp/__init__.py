"""MCP server configuration module.

This module provides utilities for transforming Stigmer MCP server
configurations into LangGraph's MultiServerMCPClient format.
"""

from worker.mcp.config_transformer import (
    transform_mcp_config,
    transform_all_mcp_configs,
    McpConfigResult,
)
from worker.mcp.placeholder_resolver import (
    PlaceholderResolver,
    PlaceholderResolutionError,
    PlaceholderResolutionResult,
    resolve_placeholders,
    resolve_placeholders_strict,
)

__all__ = [
    # Config transformation
    "transform_mcp_config",
    "transform_all_mcp_configs",
    "McpConfigResult",
    # Placeholder resolution
    "PlaceholderResolver",
    "PlaceholderResolutionError",
    "PlaceholderResolutionResult",
    "resolve_placeholders",
    "resolve_placeholders_strict",
]
