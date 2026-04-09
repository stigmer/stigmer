"""MCP server configuration and transport module.

This module provides:

-  **Config transformation** — converts Stigmer MCP server specs into
   LangGraph's ``MultiServerMCPClient`` format.
-  **Placeholder resolution** — ``${VAR}`` substitution in server args
   and HTTP headers.
-  **Daytona transport** — runs stdio MCP servers inside a Daytona
   sandbox for security isolation (cloud mode only).

``DaytonaMCPClient`` and ``daytona_stdio_client`` are intentionally
**not** re-exported here.  They transitively import
``langchain_mcp_adapters`` → ``requests`` → ``urllib3`` which accesses
``http.client`` internals that Temporal's workflow sandbox restricts.
Import them directly from their submodules inside activity functions::

    from worker.mcp.daytona_mcp_client import DaytonaMCPClient
    from worker.mcp.daytona_transport import daytona_stdio_client
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
