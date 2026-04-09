"""MCP client manager for loading tools and resources from configured servers.

This module handles MCP client operations: tool loading, resource listing,
and resource reading. It accepts pre-configured server configurations
(with auth already injected) and creates MCP clients accordingly.

For tool loading there are two entry points:

- ``connect_mcp_client`` -- opens a per-server persistent session via
  ``MultiServerMCPClient.session()``, registering each session on the
  caller's ``AsyncExitStack``.  This keeps stdio subprocesses alive for
  the entire agent execution.

- ``load_mcp_tools`` -- convenience wrapper that creates an ephemeral
  client, loads tools, and lets the client close immediately.  Safe for
  HTTP-only servers; **not safe for stdio** servers because the
  subprocess dies before tool invocations happen.

Functions:
    connect_mcp_client: Open persistent per-server sessions and return filtered tools.
    load_mcp_tools: Load and filter MCP tools (ephemeral -- HTTP-only).
    list_mcp_resources: List available resources and resource templates.
    read_mcp_resource: Read a specific resource by URI.
"""

import logging
from collections.abc import Sequence
from contextlib import AsyncExitStack
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient  # type: ignore[import-untyped]
from langchain_mcp_adapters.tools import load_mcp_tools as _lc_load_mcp_tools
from mcp.types import BlobResourceContents, TextResourceContents

logger = logging.getLogger(__name__)


def _validate_inputs(
    servers: dict[str, dict[str, Any]],
    tool_filter: dict[str, list[str]],
) -> None:
    if not servers:
        raise ValueError(
            "servers cannot be empty. Provide at least one MCP server configuration."
        )
    if not tool_filter:
        raise ValueError(
            "tool_filter cannot be empty. Specify which tools to load."
        )


def _filter_tools(
    all_tools: Sequence[BaseTool],
    tool_filter: dict[str, list[str]],
) -> list[BaseTool]:
    """Filter tools by name, validate at least one match, and log."""
    requested: set[str] = set()
    for names in tool_filter.values():
        requested.update(names)

    filtered = [t for t in all_tools if t.name in requested]

    if not filtered:
        available = [t.name for t in all_tools]
        raise ValueError(
            f"No tools found matching filter. "
            f"Available tools: {available}, "
            f"Requested tools: {sorted(requested)}"
        )

    loaded_names = [t.name for t in filtered]
    logger.info(f"Loaded {len(filtered)} MCP tool(s): {loaded_names}")

    missing = requested - set(loaded_names)
    if missing:
        logger.warning(f"Some requested tools were not found: {sorted(missing)}")

    return filtered


async def connect_mcp_client(
    servers: dict[str, dict[str, Any]],
    tool_filter: dict[str, list[str]],
    exit_stack: AsyncExitStack,
    client: Any | None = None,
) -> Sequence[BaseTool]:
    """Open persistent per-server MCP sessions and return filtered tools.

    Creates a ``MultiServerMCPClient`` and opens a ``ClientSession`` for
    each server via ``client.session(server_name)``.  Each session is
    registered on *exit_stack* so connections (including stdio
    subprocesses) stay alive until the stack is closed.  Tools returned
    are bound to their persistent sessions, avoiding per-call reconnects.

    This is the **required** entry point for any configuration that
    includes stdio-transport servers.

    Args:
        servers: Server-name -> complete MCP server config (auth resolved).
        tool_filter: Server-name -> list of tool names to expose.
        exit_stack: An ``AsyncExitStack`` whose lifetime spans the agent
            execution.  Per-server sessions are registered on this stack;
            when the stack is closed all sessions shut down gracefully.
        client: Optional pre-built MCP client (duck-typed — must expose
            a ``session(server_name)`` async context manager).  When
            provided, used instead of creating a ``MultiServerMCPClient``.
            This enables alternative transports (e.g. Daytona sandbox
            relay) without coupling Graphton to specific backends.

    Returns:
        Filtered sequence of LangChain ``BaseTool`` instances backed by
        persistent sessions.

    Raises:
        ValueError: If inputs are empty or no tools match the filter.
        RuntimeError: If the MCP client fails to connect.
    """
    _validate_inputs(servers, tool_filter)

    logger.info(
        f"Opening persistent MCP connection to {len(servers)} server(s): "
        f"{list(servers.keys())}"
    )

    try:
        client = client or MultiServerMCPClient(servers)
        all_tools: list[BaseTool] = []

        for server_name in servers:
            session = await exit_stack.enter_async_context(
                client.session(server_name)
            )
            server_tools = await _lc_load_mcp_tools(session)
            all_tools.extend(server_tools)

        logger.info(
            f"Retrieved {len(all_tools)} total tool(s) from MCP server(s): "
            f"{[t.name for t in all_tools]}"
        )

        return _filter_tools(all_tools, tool_filter)

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to connect MCP client: {e}", exc_info=True)
        raise RuntimeError(
            f"MCP persistent connection failed: {e}. "
            "Check MCP server connectivity and configuration."
        ) from e


async def load_mcp_tools(
    servers: dict[str, dict[str, Any]],
    tool_filter: dict[str, list[str]],
) -> Sequence[BaseTool]:
    """Load MCP tools from configured servers (ephemeral client).

    Creates an ephemeral ``MultiServerMCPClient`` that closes after tool
    discovery.  This is fine for HTTP-transport servers but **will cause
    ``BrokenResourceError`` for stdio servers** because the subprocess
    exits before tools are invoked at runtime.

    Prefer ``connect_mcp_client`` for any configuration that may include
    stdio-transport servers.

    Args:
        servers: Server-name -> complete MCP server config (auth resolved).
        tool_filter: Server-name -> list of tool names to expose.

    Returns:
        Sequence of LangChain BaseTool instances.

    Raises:
        ValueError: If inputs are empty or no tools match the filter.
        RuntimeError: If MCP client fails to connect or load tools.
    """
    _validate_inputs(servers, tool_filter)

    logger.info(
        f"Connecting to {len(servers)} MCP server(s): {list(servers.keys())}"
    )

    try:
        mcp_client = MultiServerMCPClient(servers)
        all_tools = await mcp_client.get_tools()

        logger.info(
            f"Retrieved {len(all_tools)} total tool(s) from MCP server(s): "
            f"{[t.name for t in all_tools]}"
        )

        return _filter_tools(all_tools, tool_filter)

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
        raise RuntimeError(
            f"MCP tool loading failed: {e}. "
            "Check MCP server connectivity and configuration."
        ) from e


async def list_mcp_resources(
    servers: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """List available MCP resources and resource templates from all servers.

    Queries each configured server for both static resources (fixed URIs) and
    resource templates (parameterized URI patterns per RFC 6570). Returns a
    unified view grouped by server name.

    Servers that don't support resources or fail to connect are skipped
    with a warning logged. Only servers with at least one resource or
    template are included in the result.

    Args:
        servers: Dictionary mapping server names to MCP server configs.
            Configs must include transport, URL/command, and any auth headers.

    Returns:
        Dictionary mapping server names to their available resources::

            {
                "server-name": {
                    "resources": [
                        {
                            "uri": "planton://cloud-resource-kinds",
                            "name": "cloud-resource-kinds",
                            "description": "...",
                            "mime_type": "application/json"
                        }
                    ],
                    "resource_templates": [
                        {
                            "uri_template": "cloud-resource-schema://{kind}",
                            "name": "cloud-resource-schema",
                            "description": "...",
                            "mime_type": "application/json"
                        }
                    ]
                }
            }

    Raises:
        ValueError: If servers dict is empty.

    Example:
        >>> servers = {
        ...     "planton-cloud": {
        ...         "transport": "streamable_http",
        ...         "url": "https://mcp.planton.ai/",
        ...         "headers": {"Authorization": "Bearer token123"}
        ...     }
        ... }
        >>> result = await list_mcp_resources(servers)
        >>> result["planton-cloud"]["resource_templates"]
        [{"uri_template": "cloud-resource-schema://{kind}", ...}]

    """
    if not servers:
        raise ValueError(
            "servers cannot be empty. Provide at least one MCP server configuration."
        )

    client = MultiServerMCPClient(servers)
    result: dict[str, dict[str, Any]] = {}

    for server_name in servers:
        server_data: dict[str, list[dict[str, str]]] = {
            "resources": [],
            "resource_templates": [],
        }

        try:
            async with client.session(server_name) as session:
                try:
                    resources_result = await session.list_resources()
                    for resource in resources_result.resources:
                        server_data["resources"].append({
                            "uri": str(resource.uri),
                            "name": resource.name,
                            "description": resource.description or "",
                            "mime_type": resource.mimeType or "",
                        })
                except Exception as e:
                    logger.warning(
                        "Server '%s' does not support listing resources "
                        "or returned an error: %s",
                        server_name, e,
                    )

                try:
                    templates_result = await session.list_resource_templates()
                    for template in templates_result.resourceTemplates:
                        server_data["resource_templates"].append({
                            "uri_template": template.uriTemplate,
                            "name": template.name,
                            "description": template.description or "",
                            "mime_type": template.mimeType or "",
                        })
                except Exception as e:
                    logger.warning(
                        "Server '%s' does not support listing resource templates "
                        "or returned an error: %s",
                        server_name, e,
                    )
        except Exception as e:
            logger.warning(
                "Failed to connect to server '%s' for resource listing: %s",
                server_name, e,
            )
            continue

        if server_data["resources"] or server_data["resource_templates"]:
            result[server_name] = server_data
            logger.info(
                "Server '%s': found %d resource(s) and %d resource template(s)",
                server_name,
                len(server_data["resources"]),
                len(server_data["resource_templates"]),
            )

    logger.info(
        "Listed resources from %d/%d server(s)",
        len(result), len(servers),
    )

    return result


async def read_mcp_resource(
    servers: dict[str, dict[str, Any]],
    server_name: str,
    uri: str,
) -> list[dict[str, Any]]:
    """Read a specific MCP resource by URI from a named server.

    Reads the resource at the given URI. Works with both static resource
    URIs and template-expanded URIs (constructed by filling in parameters
    from a resource template).

    Args:
        servers: Dictionary mapping server names to MCP server configs.
        server_name: Name of the server to read from (must be a key in servers).
        uri: Full URI of the resource to read. For template resources, the
            caller must expand the template before calling this function
            (e.g., ``"cloud-resource-schema://AwsAlb"`` not ``"...://{kind}"``).

    Returns:
        List of resource content dicts. Each dict contains:

        - ``"uri"``: The resource URI
        - ``"mime_type"``: MIME type (empty string if not specified)
        - ``"text"``: Text content (present for text resources)
        - ``"blob"``: Base64-encoded binary (present for binary resources)

        Most resources return a single content item, but the MCP protocol
        allows multiple.

    Raises:
        ValueError: If server_name is not found in servers.
        RuntimeError: If the resource read fails.

    Example:
        >>> contents = await read_mcp_resource(
        ...     servers, "planton-cloud", "cloud-resource-schema://AwsAlb"
        ... )
        >>> contents[0]["text"]
        '{"kind": "AwsAlb", "fields": [...]}'

    """
    if server_name not in servers:
        raise ValueError(
            f"Server '{server_name}' not found. "
            f"Available servers: {sorted(servers.keys())}"
        )

    logger.info("Reading resource '%s' from server '%s'", uri, server_name)

    client = MultiServerMCPClient(servers)

    try:
        async with client.session(server_name) as session:
            result = await session.read_resource(uri)
    except Exception as e:
        logger.error(
            "Failed to read resource '%s' from server '%s': %s",
            uri, server_name, e, exc_info=True,
        )
        raise RuntimeError(
            f"Failed to read MCP resource '{uri}' from server '{server_name}': {e}"
        ) from e

    contents: list[dict[str, Any]] = []
    for item in result.contents:
        content_dict: dict[str, Any] = {
            "uri": str(item.uri),
            "mime_type": item.mimeType or "",
        }
        if isinstance(item, TextResourceContents):
            content_dict["text"] = item.text
        elif isinstance(item, BlobResourceContents):
            content_dict["blob"] = item.blob
        contents.append(content_dict)

    logger.info(
        "Read resource '%s': %d content item(s)", uri, len(contents),
    )

    return contents
