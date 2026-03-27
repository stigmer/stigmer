"""Temporal activity for MCP server capability discovery.

Connects to an MCP server (stdio or HTTP), enumerates its tools and
resource templates, and returns the result as a serializable dict. This
activity is the Python-side counterpart of the ``discoverCapabilities``
gRPC RPC — the Java/Go backend starts a Temporal workflow that schedules
this activity, and the agent-runner executes it.

The agent-runner container has all the runtimes needed for stdio MCP
servers (Node.js/npx, Go, Docker CLI, uv/uvx), so discovery works for
any transport type without polluting the Java/Go service containers.
"""

from __future__ import annotations

import logging
from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow

from grpc_client.channel import ChannelProvider
from grpc_client.mcp_server_client import McpServerClient
from worker.mcp.config_transformer import transform_mcp_config, _inject_platform_env
from worker.token_manager import get_api_key

logger = logging.getLogger(__name__)

ACTIVITY_NAME = "DiscoverMcpServerCapabilities"
WORKFLOW_NAME = "stigmer/mcp-server/discover"


@dataclass
class DiscoverMcpServerInput:
    """Input for the MCP server discovery activity.

    Follows the slim-payload pattern: the activity hydrates the full
    McpServer spec via gRPC using ``mcp_server_id``. Environment variables
    (credentials) are pre-resolved by the backend from the user's personal
    environment and passed directly.
    """

    mcp_server_id: str
    env_vars: dict[str, str]
    invoker_identity_account_id: str | None = None


@dataclass
class DiscoveredToolResult:
    """Serializable representation of a discovered MCP tool."""

    name: str
    description: str
    input_schema: dict[str, Any] | None = None


@dataclass
class DiscoveredResourceTemplateResult:
    """Serializable representation of a discovered MCP resource template."""

    uri_template: str
    name: str
    description: str
    mime_type: str


@dataclass
class DiscoverMcpServerOutput:
    """Output of the MCP server discovery activity."""

    tools: list[DiscoveredToolResult]
    resource_templates: list[DiscoveredResourceTemplateResult]


@activity.defn(name=ACTIVITY_NAME)
async def discover_mcp_server(input: DiscoverMcpServerInput) -> DiscoverMcpServerOutput:
    """Discover capabilities of an MCP server by connecting to it.

    1. Fetches the McpServer spec via gRPC
    2. Transforms the spec into a MultiServerMCPClient-compatible config
    3. Connects and lists tools + resource templates
    4. Returns a serializable result for the backend to store
    """
    logger.info(
        "DiscoverMcpServerCapabilities started for mcp_server_id=%s",
        input.mcp_server_id,
    )

    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("API key not available for MCP server discovery")

    grpc_provider = ChannelProvider(
        api_key,
        invoker_identity_account_id=input.invoker_identity_account_id,
    )
    obo_ch = (
        grpc_provider.obo_channel
        if input.invoker_identity_account_id
        else grpc_provider.channel
    )

    try:
        mcp_server_client = McpServerClient(api_key, channel=obo_ch)
        mcp_server = await mcp_server_client.get(input.mcp_server_id)

        if not mcp_server or not mcp_server.spec:
            raise ValueError(
                f"MCP server '{input.mcp_server_id}' not found or has no spec"
            )

        slug = mcp_server.metadata.slug or input.mcp_server_id
        spec = mcp_server.spec

        env_vars = _inject_platform_env(spec, input.env_vars)

        config, _ = transform_mcp_config(
            server_slug=slug,
            spec=spec,
            env_vars=env_vars,
            enabled_tools=None,
        )

        tools, resource_templates = await _connect_and_discover(slug, config)

        logger.info(
            "Discovery complete for '%s': %d tool(s), %d resource template(s)",
            slug,
            len(tools),
            len(resource_templates),
        )

        return DiscoverMcpServerOutput(
            tools=tools,
            resource_templates=resource_templates,
        )

    finally:
        await grpc_provider.close()


async def _connect_and_discover(
    server_slug: str,
    config: dict[str, Any],
) -> tuple[list[DiscoveredToolResult], list[DiscoveredResourceTemplateResult]]:
    """Connect to an MCP server and enumerate its capabilities.

    Uses ``MultiServerMCPClient`` with a persistent session (same pattern
    as agent execution) so both stdio and HTTP transports work correctly.
    """
    from langchain_mcp_adapters.client import MultiServerMCPClient

    servers = {server_slug: config}
    client = MultiServerMCPClient(servers)
    tools: list[DiscoveredToolResult] = []
    resource_templates: list[DiscoveredResourceTemplateResult] = []

    async with AsyncExitStack() as stack:
        session = await stack.enter_async_context(client.session(server_slug))

        tools_result = await session.list_tools()
        for tool in tools_result.tools:
            schema = None
            if tool.inputSchema:
                schema = (
                    dict(tool.inputSchema)
                    if isinstance(tool.inputSchema, dict)
                    else tool.inputSchema
                )
            tools.append(DiscoveredToolResult(
                name=tool.name,
                description=tool.description or "",
                input_schema=schema,
            ))

        try:
            init_result = session.initialize_result
            if (
                init_result
                and init_result.capabilities
                and init_result.capabilities.resources
            ):
                templates_result = await session.list_resource_templates()
                for tpl in templates_result.resourceTemplates:
                    resource_templates.append(DiscoveredResourceTemplateResult(
                        uri_template=tpl.uriTemplate,
                        name=tpl.name,
                        description=tpl.description or "",
                        mime_type=tpl.mimeType or "",
                    ))
        except Exception as e:
            logger.warning(
                "Server '%s' does not support resource templates: %s",
                server_slug, e,
            )

    return tools, resource_templates


@workflow.defn(name=WORKFLOW_NAME)
class DiscoverMcpServerWorkflow:
    """Thin Temporal workflow that orchestrates MCP server discovery.

    This workflow is defined in Python so that both the Go (OSS) and Java (Cloud)
    backends can start it by name on the runner queue without needing to implement
    the workflow in their respective languages. The workflow simply schedules the
    ``DiscoverMcpServerCapabilities`` activity and returns the result.
    """

    @workflow.run
    async def run(self, input: DiscoverMcpServerInput) -> DiscoverMcpServerOutput:
        return await workflow.execute_activity(
            discover_mcp_server,
            input,
            start_to_close_timeout=timedelta(seconds=60),
        )
