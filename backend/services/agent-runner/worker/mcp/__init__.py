"""MCP server configuration module.

This module provides utilities for transforming Stigmer MCP server
configurations into LangGraph's MultiServerMCPClient format.
"""

from worker.mcp.config_transformer import (
    McpConfigResult,
    transform_all_mcp_configs,
    transform_mcp_config,
)
from worker.mcp.placeholder_resolver import (
    PlaceholderResolutionError,
    PlaceholderResolutionResult,
    PlaceholderResolver,
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
