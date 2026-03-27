"""Temporal activity for MCP server capability discovery.

Connects to an MCP server (stdio or HTTP), enumerates its tools and
resource templates, and returns the result as a serializable dict. This
activity is the Python-side counterpart of the ``discoverCapabilities``
gRPC RPC — the Java/Go backend starts a Temporal workflow that schedules
this activity, and the agent-runner executes it.

The agent-runner container has all the runtimes needed for stdio MCP
servers (Node.js/npx, Go, Docker CLI, uv/uvx), so discovery works for
any transport type without polluting the Java/Go service containers.

Security: The Go/Java backend creates an ephemeral ExecutionContext
containing only the environment variables the MCP server needs. The
Temporal workflow input carries only ``mcp_server_id`` and an
``execution_context_id`` — no secret values ever appear in Temporal's
durable workflow history. The Python activity reads from the scoped
ExecutionContext and cannot access arbitrary environments.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import grpc
from temporalio import activity, workflow

from grpc_client.channel import ChannelProvider
from grpc_client.execution_context_client import ExecutionContextClient
from grpc_client.mcp_server_client import McpServerClient
from worker.mcp.config_transformer import _inject_platform_env, transform_mcp_config
from worker.token_manager import get_api_key

logger = logging.getLogger(__name__)

ACTIVITY_NAME = "DiscoverMcpServerCapabilities"
WORKFLOW_NAME = "stigmer/mcp-server/discover"


@dataclass
class DiscoverMcpServerInput:
    """Input for the MCP server discovery activity.

    Follows the slim-payload pattern established by
    ``InvokeAgentExecutionWorkflowInput``: only reference IDs are passed
    through Temporal. The activity hydrates the MCP server spec and
    resolves environment variables from an ExecutionContext, keeping
    secrets out of Temporal's durable workflow history.

    Fields:
        mcp_server_id: Required. The MCP server to discover.
        execution_context_id: Optional. When set, environment variables
            are read from this pre-created ExecutionContext (Go/Java
            backend creates and cleans it up).
        invoker_identity_account_id: Optional. Used for OBO channel
            when fetching the MCP server spec.
    """

    mcp_server_id: str
    execution_context_id: str | None = None
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

    1. Fetches the McpServer spec via gRPC (OBO impersonation when available)
    2. Resolves environment variables from the pre-created ExecutionContext
    3. Transforms the spec into a MultiServerMCPClient-compatible config
    4. Connects and lists tools + resource templates
    5. Returns a serializable result for the backend to store
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

        env_vars = await _resolve_env_vars_for_discovery(
            api_key=api_key,
            channel=obo_ch,
            execution_context_id=input.execution_context_id,
        )
        env_vars = _inject_platform_env(spec, env_vars)

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


async def _resolve_env_vars_for_discovery(
    *,
    api_key: str,
    channel: grpc.aio.Channel,
    execution_context_id: str | None,
) -> dict[str, str]:
    """Resolve environment variables for MCP discovery.

    When ``execution_context_id`` is provided, reads from the
    pre-created ExecutionContext. The Go/Java backend scoped the context
    to only the keys the MCP server needs.

    When no ``execution_context_id`` is provided, returns an empty dict
    (the MCP server does not require environment variables).
    """
    if execution_context_id:
        return await _resolve_env_from_execution_context(
            api_key, channel, execution_context_id,
        )

    return {}


async def _resolve_env_from_execution_context(
    api_key: str,
    channel: grpc.aio.Channel,
    execution_context_id: str,
) -> dict[str, str]:
    """Read environment variables from a pre-created ExecutionContext.

    Follows the same pattern as ``graphton/environment.py``: use
    ``ExecutionContextClient.try_get_by_execution_id`` and extract
    plaintext values from ``spec.data``.
    """
    ec_client = ExecutionContextClient(api_key, channel=channel)
    exec_ctx = await ec_client.try_get_by_execution_id(execution_context_id)

    if not exec_ctx or not exec_ctx.spec.data:
        logger.warning(
            "ExecutionContext '%s' not found or empty — MCP server "
            "may not require environment variables",
            execution_context_id,
        )
        return {}

    env_vars: dict[str, str] = {}
    for key, exec_value in exec_ctx.spec.data.items():
        env_vars[key] = exec_value.value

    logger.info(
        "Resolved %d env var(s) from ExecutionContext '%s'",
        len(env_vars),
        execution_context_id,
    )
    return env_vars


SESSION_INIT_TIMEOUT_SECONDS = 270


async def _connect_and_discover(
    server_slug: str,
    config: dict[str, Any],
) -> tuple[list[DiscoveredToolResult], list[DiscoveredResourceTemplateResult]]:
    """Connect to an MCP server and enumerate its capabilities.

    Uses ``MultiServerMCPClient`` with an ephemeral session (same pattern
    as graphton's ``list_mcp_resources``) so both stdio and HTTP transports
    work correctly.  The session context manager handles the full subprocess
    lifecycle: spawning, MCP ``initialize`` handshake, and clean teardown.

    The entire block is guarded by ``asyncio.timeout()`` to surface a clear
    error when an MCP server's cold start (e.g. ``go run`` compilation,
    ``npx`` package install) exceeds the allowed window.  Unlike
    ``asyncio.wait_for()``, ``timeout()`` operates on the current task's
    cancel scope and does not cross anyio task boundaries during teardown.
    """
    from langchain_mcp_adapters.client import MultiServerMCPClient

    servers: dict[str, Any] = {server_slug: config}
    client = MultiServerMCPClient(servers)  # type: ignore[arg-type]
    tools: list[DiscoveredToolResult] = []
    resource_templates: list[DiscoveredResourceTemplateResult] = []

    try:
        async with asyncio.timeout(SESSION_INIT_TIMEOUT_SECONDS):
            async with client.session(server_slug) as session:
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
                    init_result = getattr(session, "initialize_result", None)
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
    except TimeoutError:
        raise TimeoutError(
            f"MCP server '{server_slug}' did not respond within "
            f"{SESSION_INIT_TIMEOUT_SECONDS}s. If this server requires "
            f"compilation or package installation on first run "
            f"(e.g. go run, npx), the cold start may have exceeded "
            f"the discovery timeout."
        ) from None

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
            start_to_close_timeout=timedelta(seconds=300),
        )
