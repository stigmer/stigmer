"""Configuration transformer for MCP servers.

Transforms Stigmer McpServerSpec proto messages into LangGraph's
MultiServerMCPClient format. This module handles:
- Stdio transport configuration (subprocess-based MCP servers)
- HTTP transport configuration (remote MCP servers)
- ${VAR_NAME} placeholder resolution in stdio args and HTTP headers/query params
- Tool filtering from McpServerUsage.enabled_tools

Placeholder resolution:
    Stdio args use **strict** mode — a missing variable raises
    PlaceholderResolutionError to prevent confusing subprocess failures.
    HTTP headers/query params use **lenient** mode for backward
    compatibility (unresolved placeholders are preserved with a warning).

LangGraph expects server configurations in specific formats:

Stdio transport:
    {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "postgres://..."],
        "transport": "stdio",
        "env": {"POSTGRES_URL": "postgres://..."}
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
import os
from dataclasses import dataclass
from typing import Any

from ai.stigmer.agentic.agent.v1.spec_pb2 import McpServerUsage
from ai.stigmer.agentic.mcpserver.v1.api_pb2 import McpServer
from ai.stigmer.agentic.mcpserver.v1.spec_pb2 import (
    HttpServerConfig,
    McpServerSpec,
    StdioServerConfig,
)

# Import placeholder resolution from dedicated module
from worker.mcp.placeholder_resolver import (
    PlaceholderResolutionError,
    PlaceholderResolver,
)

logger = logging.getLogger(__name__)

# Module-level resolver instances.
# HTTP headers/query params use lenient mode for backward compatibility —
# unresolved placeholders are preserved with a warning.
# Stdio args use strict mode because an unresolved placeholder in a CLI
# argument would cause a confusing server startup failure.
_resolver = PlaceholderResolver(strict=False)
_strict_resolver = PlaceholderResolver(strict=True)

# Platform infrastructure env vars that the agent-runner auto-injects into MCP
# server subprocesses. Maps the *target* env var name (what the subprocess
# sees) to the *source* env var on the agent-runner pod.
#
# The source var may differ from the target because MCP subprocesses run in
# Daytona sandboxes (outside K8s) and need the public gRPC endpoint, whereas
# the agent-runner pod itself uses the internal kube-endpoint.
#
# STIGMER_API_KEY is intentionally excluded: it is a user credential that must
# flow through the ExecutionContext / Environment merge chain.
_PLATFORM_INJECTABLE_MAP: dict[str, str] = {
    "STIGMER_SERVER_ADDRESS": "STIGMER_MCP_PUBLIC_ENDPOINT",
}


def _inject_platform_env(
    spec: McpServerSpec,
    env_vars: dict[str, str],
) -> dict[str, str]:
    """Return env_vars with platform infrastructure env vars injected.

    For each entry in ``_PLATFORM_INJECTABLE_MAP`` whose target key is
    declared in the server's ``env`` and whose source var is set in
    the agent-runner's own environment, inject (or override) the value.

    Platform infrastructure vars are **authoritative** -- they override
    any value already present in ``env_vars`` (e.g., stale entries from
    the user's personal environment) because the platform is the single
    source of truth for deployment-topology addresses.

    Returns a new dict; the input is not mutated.
    """
    if not spec.env:
        return env_vars

    declared_keys = set(spec.env)
    injectable_targets = declared_keys & _PLATFORM_INJECTABLE_MAP.keys()

    if not injectable_targets:
        return env_vars

    result = dict(env_vars)
    for target_key in injectable_targets:
        source_key = _PLATFORM_INJECTABLE_MAP[target_key]
        value = os.environ.get(source_key)
        if not value:
            continue
        if target_key in result and result[target_key] != value:
            logger.info(
                "Platform env var '%s' overrides value from ExecutionContext "
                "(platform infra vars are authoritative)",
                target_key,
            )
        result[target_key] = value

    return result


def _filter_env_to_declared_keys(
    spec: McpServerSpec,
    env_vars: dict[str, str],
    server_slug: str,
) -> dict[str, str]:
    """Restrict env_vars to only the keys declared in the server's env.

    Prevents secret over-sharing: an MCP server subprocess receives only
    the environment variables it explicitly declares, not the entire
    merged environment (which may contain LLM keys, DB URIs, etc. that
    belong to other servers or the platform).

    Args:
        spec: The MCP server's spec containing env declarations.
        env_vars: The full (possibly platform-augmented) env dict.
        server_slug: Used for log messages only.

    Returns:
        A new dict containing only the intersection of env_vars keys
        with spec.env keys. Empty dict when no env is declared (the
        server needs no environment variables).
    """
    if not spec.env:
        if env_vars:
            logger.debug(
                "MCP server '%s' has no env declarations — dropping %d env var(s)",
                server_slug, len(env_vars),
            )
        return {}

    declared_keys = set(spec.env)
    filtered = {k: v for k, v in env_vars.items() if k in declared_keys}

    dropped = len(env_vars) - len(filtered)
    if dropped:
        logger.info(
            "MCP server '%s': passing %d declared env var(s), "
            "filtered out %d undeclared key(s)",
            server_slug, len(filtered), dropped,
        )

    missing = declared_keys - set(filtered)
    if missing:
        logger.warning(
            "MCP server '%s': env declares %s but they are not "
            "present in the resolved environment",
            server_slug, sorted(missing),
        )

    return filtered


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


def _resolve_stdio_args(
    args: list[str],
    env_vars: dict[str, str],
) -> list[str]:
    """Resolve ${VAR_NAME} placeholders in stdio arguments.

    MCP servers that take configuration as positional CLI arguments
    (e.g. PostgreSQL connection URL, Filesystem paths) need their args
    interpolated from the user's environment at runtime.

    Uses strict mode: a missing variable raises PlaceholderResolutionError
    rather than silently passing a literal ``${VAR}`` to the subprocess,
    which would produce a confusing server startup failure.

    Args:
        args: Raw argument list, potentially containing ${VAR_NAME} placeholders.
        env_vars: Resolved environment variables for substitution.

    Returns:
        New list with all placeholders resolved.

    Raises:
        PlaceholderResolutionError: If any placeholder references a variable
            not present in env_vars.
    """
    if not args:
        return []

    resolved: list[str] = []
    for i, arg in enumerate(args):
        resolved.append(
            _strict_resolver.resolve(arg, env_vars, context=f"stdio arg[{i}]")
        )
    return resolved


def _transform_stdio_config(
    stdio: StdioServerConfig,
    env_vars: dict[str, str],
) -> dict[str, Any]:
    """Transform StdioServerConfig to LangGraph stdio format.

    Arguments containing ${VAR_NAME} placeholders are resolved against
    env_vars before being placed in the config. This enables MCP servers
    that take core configuration as positional CLI arguments (e.g.
    database connection URLs, directory paths) to be parameterized
    per-user through env declarations — the same mechanism used for
    servers that read from process environment variables.

    Args:
        stdio: StdioServerConfig proto message.
        env_vars: Environment variables for placeholder resolution and
            subprocess environment.

    Returns:
        Dictionary with stdio transport configuration.

    Raises:
        PlaceholderResolutionError: If an arg contains a ${VAR_NAME}
            placeholder that cannot be resolved from env_vars.
    """
    config: dict[str, Any] = {
        "transport": "stdio",
        "command": stdio.command,
        "args": _resolve_stdio_args(list(stdio.args) if stdio.args else [], env_vars),
    }

    # Include environment variables for the subprocess
    if env_vars:
        config["env"] = dict(env_vars)

    # Include working directory if specified
    if stdio.working_dir:
        config["cwd"] = stdio.working_dir

    return config


def _transform_http_config(
    http: HttpServerConfig,
    env_vars: dict[str, str],
) -> dict[str, Any]:
    """Transform HttpServerConfig to LangGraph HTTP format.
    
    Args:
        http: HttpServerConfig proto message.
        env_vars: Environment variables for placeholder resolution.
        
    Returns:
        Dictionary with HTTP transport configuration.
    """
    # Resolve placeholders in headers and query params using the resolver
    resolved_headers, resolved_params = _resolver.resolve_http_config(
        headers=dict(http.headers) if http.headers else None,
        query_params=dict(http.query_params) if http.query_params else None,
        env_vars=env_vars,
    )
    
    # Build URL with resolved query params
    url = http.url
    if resolved_params:
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


def _get_discovered_tool_names(server: McpServer) -> list[str]:
    """Extract discovered tool names from server status.

    When neither ``enabled_tools`` nor ``default_enabled_tools`` is set,
    the "all tools" convention (empty list) must be resolved to explicit
    tool names before reaching Graphton — which requires a non-empty list
    for each server in ``mcp_tools``.

    Returns an empty list when the server has no discovered capabilities
    (e.g. never connected or status not populated).
    """
    try:
        tools = server.status.discovered_capabilities.tools
        return [t.name for t in tools if t.name]
    except AttributeError:
        return []


def transform_all_mcp_configs(
    mcp_servers: list[McpServer],
    mcp_server_usages: list[McpServerUsage],
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
        
        server = servers_by_slug.get(slug)  # type: ignore[assignment]  # .get() returns Optional, narrowed by guard below
        if not server:
            logger.error(
                f"MCP server '{slug}' referenced in agent but not found in fetched servers"
            )
            continue
        
        try:
            server_env = _inject_platform_env(server.spec, env_vars)
            server_env = _filter_env_to_declared_keys(server.spec, server_env, slug)
            enabled_tools = tools_by_slug.get(slug)
            config, tools = transform_mcp_config(
                server_slug=slug,
                spec=server.spec,
                env_vars=server_env,
                enabled_tools=enabled_tools,
            )
            result_servers[slug] = config
            result_tools[slug] = tools

            # Resolve "all tools" convention: an empty list from
            # transform_mcp_config means "enable every tool." Graphton
            # requires explicit tool names, so expand from the server's
            # discovered capabilities.
            if not tools:
                discovered = _get_discovered_tool_names(server)
                if discovered:
                    result_tools[slug] = discovered
                    logger.info(
                        "MCP server '%s': expanded 'all tools' to %d "
                        "discovered tool name(s)",
                        slug, len(discovered),
                    )
                else:
                    logger.warning(
                        "MCP server '%s': no enabled_tools, no "
                        "default_enabled_tools, and no discovered tools "
                        "available — skipping server",
                        slug,
                    )
                    result_servers.pop(slug, None)
                    result_tools.pop(slug, None)
                    continue

        except (ValueError, PlaceholderResolutionError) as e:
            logger.error(f"Failed to transform MCP server '{slug}': {e}")
            continue
    
    logger.info(
        f"Transformed {len(result_servers)} MCP server(s): "
        f"{list(result_servers.keys())}"
    )
    
    return McpConfigResult(servers=result_servers, tools=result_tools)
