"""MCP client manager for loading tools and resources from configured servers.

This module handles MCP client operations: tool loading, resource listing,
and resource reading. It accepts pre-configured server configurations
(with auth already injected) and creates MCP clients accordingly.

Functions:
    load_mcp_tools: Load and filter MCP tools from configured servers.
    list_mcp_resources: List available resources and resource templates.
    read_mcp_resource: Read a specific resource by URI.
"""

import logging
from collections.abc import Sequence
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient  # type: ignore[import-untyped]
from mcp.types import BlobResourceContents, TextResourceContents

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
