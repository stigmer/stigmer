"""MCP server configuration and transport module.

This module provides:

-  **Config transformation** — converts Stigmer MCP server specs into
   LangGraph's ``MultiServerMCPClient`` format.
-  **Placeholder resolution** — ``${VAR}`` substitution in server args
   and HTTP headers.
-  **Package installation** — pre-installs npm/pip packages required by
   stdio MCP servers so ``npx -y`` / ``uvx`` find them locally.

Stdio MCP servers run as local subprocesses via ``MultiServerMCPClient``.
In cloud mode the runner is inside a Daytona sandbox (provisioned by
stigmer-service), so "local" subprocess means "inside the sandbox."
"""

from stigmer_runner.worker.mcp.config_transformer import (
    McpConfigResult,
    transform_all_mcp_configs,
    transform_mcp_config,
)
from stigmer_runner.worker.mcp.package_installer import (
    InstallResult,
    install_mcp_packages,
)
from stigmer_runner.worker.mcp.placeholder_resolver import (
    PlaceholderResolutionError,
    PlaceholderResolver,
    resolve_placeholders,
)

__all__ = [
    # Config transformation
    "transform_mcp_config",
    "transform_all_mcp_configs",
    "McpConfigResult",
    # Package installation
    "install_mcp_packages",
    "InstallResult",
    # Placeholder resolution
    "PlaceholderResolver",
    "PlaceholderResolutionError",
    "resolve_placeholders",
]
