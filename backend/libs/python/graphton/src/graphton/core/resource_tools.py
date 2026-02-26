"""MCP resource tools for agent-accessible resource discovery and reading.

Creates LangChain tools that agents use to discover and read MCP resources
from connected servers. Resources are read-only reference data exposed by
MCP servers, distinct from tools which perform actions.

Two tools are created:

- ``list_mcp_resources``: Lists available resources and resource templates
  from all connected servers.
- ``read_mcp_resource``: Reads a specific resource by server name and URI.
"""

import json
import logging
from typing import Any

from langchain_core.tools import BaseTool, tool

from graphton.core.mcp_manager import (
    list_mcp_resources as _list_resources,
)
from graphton.core.mcp_manager import (
    read_mcp_resource as _read_resource,
)

logger = logging.getLogger(__name__)


def create_resource_tools(
    servers: dict[str, dict[str, Any]],
) -> list[BaseTool]:
    """Create LangChain tools for MCP resource discovery and reading.

    Creates two tools that agents can invoke to interact with MCP resources:

    1. ``list_mcp_resources``: Queries all connected servers for available
       resources and resource templates. Returns a JSON summary.

    2. ``read_mcp_resource``: Reads a specific resource by server name and
       URI. Returns the resource content directly (text for text resources).

    The tools capture server configurations in closures and create fresh
    MCP sessions per invocation (same pattern as MCP tool calls).

    Args:
        servers: Dictionary mapping server names to complete MCP server configs
            with authentication already resolved.

    Returns:
        List of two LangChain BaseTool instances.

    Example:
        >>> servers = {"planton": {"transport": "streamable_http", "url": "..."}}
        >>> tools = create_resource_tools(servers)
        >>> len(tools)
        2
        >>> [t.name for t in tools]
        ['list_mcp_resources', 'read_mcp_resource']

    """

    @tool
    async def list_mcp_resources() -> str:
        """List available resources and resource templates from all connected MCP servers.

        Returns a JSON object mapping server names to their available resources
        and resource templates.

        Resources have fixed URIs and can be read directly with read_mcp_resource.

        Resource templates have parameterized URI patterns (RFC 6570). To read a
        templated resource, replace the template parameters with actual values to
        construct a full URI, then call read_mcp_resource with that URI.

        Example template: "cloud-resource-schema://{kind}"
        Example expanded URI: "cloud-resource-schema://AwsAlb"

        Returns:
            JSON string with resources grouped by server name.
        """
        try:
            result = await _list_resources(servers)
            if not result:
                return "No MCP resources available from any connected server."
            return json.dumps(result, indent=2)
        except Exception as e:
            logger.error("list_mcp_resources tool failed: %s", e, exc_info=True)
            return f"Error listing MCP resources: {e}"

    @tool
    async def read_mcp_resource(server_name: str, uri: str) -> str:
        """Read a specific MCP resource by URI from a named server.

        Use list_mcp_resources first to discover available resources and URIs.

        For resource templates, construct the full URI by replacing template
        parameters before calling this tool. For example, if the template is
        "cloud-resource-schema://{kind}", replace {kind} with the actual value:
        "cloud-resource-schema://AwsAlb".

        Args:
            server_name: Name of the MCP server to read from (as shown in
                list_mcp_resources output).
            uri: Full URI of the resource to read. Must be a complete URI,
                not a template pattern.

        Returns:
            The resource content as text (for text resources) or a JSON
            structure describing the content.
        """
        try:
            contents = await _read_resource(servers, server_name, uri)
            if not contents:
                return f"Resource '{uri}' returned no content."

            if len(contents) == 1 and "text" in contents[0]:
                return contents[0]["text"]

            return json.dumps(contents, indent=2)
        except ValueError as e:
            return f"Error: {e}"
        except RuntimeError as e:
            return f"Error reading resource: {e}"

    return [list_mcp_resources, read_mcp_resource]  # type: ignore[list-item]
