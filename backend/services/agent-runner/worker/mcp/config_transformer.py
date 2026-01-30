"""Configuration transformer for MCP servers.

Transforms Stigmer McpServerSpec proto messages into LangGraph's 
MultiServerMCPClient format. This module handles:
- Stdio transport configuration (subprocess-based MCP servers)
- HTTP transport configuration (remote MCP servers)
- Placeholder resolution for environment variables (${VAR_NAME})
- Tool filtering from McpServerUsage.enabled_tools

LangGraph expects server configurations in specific formats:

Stdio transport:
    {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "transport": "stdio",
        "env": {"GITHUB_TOKEN": "..."}
    }

HTTP transport (Streamable HTTP):
    {
        "url": "https://mcp.example.com/v1",
        "transport": "streamable_http",
        "headers": {"Authorization": "Bearer ..."}
    }
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from ai.stigmer.agentic.mcpserver.v1.api_pb2 import McpServer
from ai.stigmer.agentic.mcpserver.v1.spec_pb2 import McpServerSpec

logger = logging.getLogger(__name__)

# Regex pattern for ${VAR_NAME} placeholders
_PLACEHOLDER_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


@dataclass
class McpConfigResult:
    """Result of transforming MCP server configurations.
    
    Contains both the server configurations and tool filters needed
    for LangGraph's MultiServerMCPClient.
    
    Attributes:
        servers: Dictionary mapping server slugs to LangGraph-compatible
            server configurations.
        tools: Dictionary mapping server slugs to lists of enabled tool names.
            Empty list means all tools from the server are enabled.
    """
    
    servers: dict[str, dict[str, Any]]
    tools: dict[str, list[str]]


def resolve_placeholders(value: str, env_vars: dict[str, str]) -> str:
    """Resolve ${VAR_NAME} placeholders in a string.
    
    Substitutes placeholders with values from the provided environment
    variables dictionary. Unresolved placeholders are logged as warnings
    but left unchanged to allow debugging.
    
    Args:
        value: String potentially containing ${VAR_NAME} placeholders.
        env_vars: Dictionary mapping variable names to their values.
        
    Returns:
        String with placeholders resolved where possible.
        
    Examples:
        >>> resolve_placeholders("Bearer ${TOKEN}", {"TOKEN": "abc123"})
        'Bearer abc123'
        
        >>> resolve_placeholders("Hello ${MISSING}", {})
        'Hello ${MISSING}'
    """
    if not value or "${" not in value:
        return value
    
    def replace_match(match: re.Match[str]) -> str:
        var_name = match.group(1)
        if var_name in env_vars:
            return env_vars[var_name]
        else:
            logger.warning(
                f"Unresolved placeholder ${{{var_name}}} - "
                "ensure this variable is provided in the environment"
            )
            return match.group(0)  # Return original placeholder
    
    return _PLACEHOLDER_PATTERN.sub(replace_match, value)


def transform_mcp_config(
    server_slug: str,
    spec: McpServerSpec,
    env_vars: dict[str, str],
    enabled_tools: list[str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Transform a single MCP server spec to LangGraph format.
    
    Converts a Stigmer McpServerSpec proto message into the dictionary
    format expected by LangGraph's MultiServerMCPClient.
    
    Args:
        server_slug: Unique identifier for this server (used as key in config).
        spec: McpServerSpec proto message containing server configuration.
        env_vars: Environment variables for placeholder resolution and
            subprocess environment.
        enabled_tools: List of tool names to enable. If None or empty,
            uses spec.default_enabled_tools (or all tools if that's also empty).
            
    Returns:
        Tuple of (server_config, tool_list) where:
        - server_config: Dictionary compatible with MultiServerMCPClient
        - tool_list: List of enabled tool names (empty means all tools)
        
    Raises:
        ValueError: If the spec doesn't have a valid server type configured.
        
    Examples:
        >>> spec = McpServerSpec()
        >>> spec.stdio.command = "npx"
        >>> spec.stdio.args.extend(["-y", "@modelcontextprotocol/server-github"])
        >>> config, tools = transform_mcp_config("github", spec, {"GITHUB_TOKEN": "..."})
        >>> config["transport"]
        'stdio'
    """
    # Determine which tools to enable
    # Priority: explicit enabled_tools > spec.default_enabled_tools > all tools
    if enabled_tools:
        tools = list(enabled_tools)
    elif spec.default_enabled_tools:
        tools = list(spec.default_enabled_tools)
    else:
        tools = []  # Empty means all tools
    
    # Transform based on server type
    if spec.HasField("stdio"):
        config = _transform_stdio_config(spec.stdio, env_vars)
    elif spec.HasField("http"):
        config = _transform_http_config(spec.http, env_vars)
    else:
        raise ValueError(
            f"MCP server '{server_slug}' has no valid server type configured. "
            "Must specify either 'stdio' or 'http' in the spec."
        )
    
    logger.info(
        f"Transformed MCP server '{server_slug}': "
        f"transport={config.get('transport')}, "
        f"tools={len(tools) if tools else 'all'}"
    )
    
    return config, tools


def _transform_stdio_config(
    stdio: "StdioServerConfig",  # noqa: F821 - forward reference
    env_vars: dict[str, str],
) -> dict[str, Any]:
    """Transform StdioServerConfig to LangGraph stdio format.
    
    Args:
        stdio: StdioServerConfig proto message.
        env_vars: Environment variables to pass to the subprocess.
        
    Returns:
        Dictionary with stdio transport configuration.
    """
    config: dict[str, Any] = {
        "transport": "stdio",
        "command": stdio.command,
        "args": list(stdio.args) if stdio.args else [],
    }
    
    # Include environment variables for the subprocess
    if env_vars:
        config["env"] = dict(env_vars)
    
    # Include working directory if specified
    if stdio.working_dir:
        config["cwd"] = stdio.working_dir
    
    return config


def _transform_http_config(
    http: "HttpServerConfig",  # noqa: F821 - forward reference
    env_vars: dict[str, str],
) -> dict[str, Any]:
    """Transform HttpServerConfig to LangGraph HTTP format.
    
    Args:
        http: HttpServerConfig proto message.
        env_vars: Environment variables for placeholder resolution.
        
    Returns:
        Dictionary with HTTP transport configuration.
    """
    # Resolve placeholders in headers
    resolved_headers: dict[str, str] = {}
    for key, value in http.headers.items():
        resolved_headers[key] = resolve_placeholders(value, env_vars)
    
    # Resolve placeholders in query params and build URL
    url = http.url
    if http.query_params:
        resolved_params = {
            k: resolve_placeholders(v, env_vars)
            for k, v in http.query_params.items()
        }
        # URL-encode query parameters
        from urllib.parse import urlencode
        query_string = urlencode(resolved_params)
        url = f"{url}?{query_string}" if "?" not in url else f"{url}&{query_string}"
    
    config: dict[str, Any] = {
        "transport": "streamable_http",
        "url": url,
    }
    
    # Include headers if any
    if resolved_headers:
        config["headers"] = resolved_headers
    
    # Include timeout if specified
    if http.timeout_seconds > 0:
        config["timeout"] = http.timeout_seconds
    
    return config


def transform_all_mcp_configs(
    mcp_servers: list[McpServer],
    mcp_server_usages: list["McpServerUsage"],  # noqa: F821
    env_vars: dict[str, str],
) -> McpConfigResult:
    """Transform multiple MCP servers to LangGraph format.
    
    Processes a list of McpServer resources and their corresponding
    McpServerUsage configurations, producing the complete configuration
    needed for LangGraph's MultiServerMCPClient.
    
    Args:
        mcp_servers: List of McpServer proto messages fetched from backend.
        mcp_server_usages: List of McpServerUsage from Agent.spec defining
            which servers are used and their tool restrictions.
        env_vars: Environment variables for placeholder resolution.
        
    Returns:
        McpConfigResult containing servers and tools dictionaries.
        
    Example:
        >>> result = transform_all_mcp_configs(servers, usages, env)
        >>> # Use with Graphton:
        >>> create_deep_agent(
        ...     mcp_servers=result.servers,
        ...     mcp_tools=result.tools,
        ...     ...
        ... )
    """
    if not mcp_servers:
        logger.info("No MCP servers to transform")
        return McpConfigResult(servers={}, tools={})
    
    # Build lookup of MCP servers by their reference slug
    # The slug in mcp_server_ref matches the server's metadata.slug
    servers_by_slug: dict[str, McpServer] = {}
    for server in mcp_servers:
        slug = server.metadata.slug
        if slug:
            servers_by_slug[slug] = server
        else:
            logger.warning(
                f"MCP server {server.metadata.id} has no slug, skipping"
            )
    
    # Build lookup of enabled tools per server from usages
    tools_by_slug: dict[str, list[str]] = {}
    for usage in mcp_server_usages:
        slug = usage.mcp_server_ref.slug
        if slug and usage.enabled_tools:
            tools_by_slug[slug] = list(usage.enabled_tools)
    
    # Transform each server
    result_servers: dict[str, dict[str, Any]] = {}
    result_tools: dict[str, list[str]] = {}
    
    for usage in mcp_server_usages:
        slug = usage.mcp_server_ref.slug
        if not slug:
            logger.warning("McpServerUsage has no slug in mcp_server_ref, skipping")
            continue
        
        server = servers_by_slug.get(slug)
        if not server:
            logger.error(
                f"MCP server '{slug}' referenced in agent but not found in fetched servers"
            )
            continue
        
        try:
            enabled_tools = tools_by_slug.get(slug)
            config, tools = transform_mcp_config(
                server_slug=slug,
                spec=server.spec,
                env_vars=env_vars,
                enabled_tools=enabled_tools,
            )
            result_servers[slug] = config
            result_tools[slug] = tools
            
        except ValueError as e:
            logger.error(f"Failed to transform MCP server '{slug}': {e}")
            continue
    
    logger.info(
        f"Transformed {len(result_servers)} MCP server(s): "
        f"{list(result_servers.keys())}"
    )
    
    return McpConfigResult(servers=result_servers, tools=result_tools)
