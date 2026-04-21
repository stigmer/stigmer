"""MCP server configuration and transport module.

This module provides:

-  **Config transformation** — converts Stigmer MCP server specs into
   LangGraph's ``MultiServerMCPClient`` format.
-  **Placeholder resolution** — ``${VAR}`` substitution in server args
   and HTTP headers.

Stdio MCP servers run as local subprocesses via ``MultiServerMCPClient``.
In cloud mode the runner is inside a Daytona sandbox (provisioned by
stigmer-service), so "local" subprocess means "inside the sandbox."
"""

from worker.mcp.config_transformer import (
    McpConfigResult,
    transform_all_mcp_configs,
    transform_mcp_config,
)
from worker.mcp.placeholder_resolver import (
    PlaceholderResolutionError,
    PlaceholderResolver,
    resolve_placeholders,
)

__all__ = [
    # Config transformation
    "transform_mcp_config",
    "transform_all_mcp_configs",
    "McpConfigResult",
    # Placeholder resolution
    "PlaceholderResolver",
    "PlaceholderResolutionError",
    "resolve_placeholders",
]
