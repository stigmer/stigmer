"""Temporal activity for MCP server capability discovery.

Connects to an MCP server (stdio or HTTP), enumerates its tools and
resource templates, and returns the result as a serializable dict. This
activity is the Python-side counterpart of the ``discoverCapabilities``
gRPC RPC — the Java/Go backend starts a Temporal workflow that schedules
this activity, and the agent-runner executes it.

The agent-runner container has all the runtimes needed for stdio MCP
servers (Node.js/npx, Go, Docker CLI, uv/uvx), so discovery works for
any transport type without polluting the Java/Go service containers.

Security: Secrets are resolved just-in-time inside the activity via
on-behalf-of gRPC calls to the environment service. The Temporal
workflow input carries only ``mcp_server_id`` and an optional
``invoker_identity_account_id`` — no secret values ever appear in
Temporal's durable workflow history.
"""

from __future__ import annotations

import logging
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import grpc
from temporalio import activity, workflow

from grpc_client.channel import ChannelProvider
from grpc_client.environment_client import EnvironmentClient
from grpc_client.mcp_server_client import McpServerClient
from worker.mcp.config_transformer import transform_mcp_config, _inject_platform_env
from worker.token_manager import get_api_key

logger = logging.getLogger(__name__)

ACTIVITY_NAME = "DiscoverMcpServerCapabilities"
WORKFLOW_NAME = "stigmer/mcp-server/discover"

_PERSONAL_ENV_LABEL = "stigmer.ai/personal"


@dataclass
class DiscoverMcpServerInput:
    """Input for the MCP server discovery activity.

    Follows the slim-payload pattern established by
    ``InvokeAgentExecutionWorkflowInput``: only reference IDs are passed
    through Temporal. The activity hydrates the MCP server spec and
    resolves credentials just-in-time via gRPC, keeping secrets out of
    Temporal's durable workflow history.

    ``env_vars`` is retained as an optional field for backward
    compatibility during rolling deployments. When present it is
    **ignored** — credentials are always resolved JIT from the personal
    environment.
    """

    mcp_server_id: str
    invoker_identity_account_id: str | None = None
    env_vars: dict[str, str] = field(default_factory=dict)


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
    2. Resolves required credentials JIT from the user's personal environment
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
        org = mcp_server.metadata.org

        env_client = EnvironmentClient(api_key, channel=obo_ch)
        env_vars = await _resolve_env_vars(env_client, org, spec)
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


async def _resolve_env_vars(
    env_client: EnvironmentClient,
    org: str,
    spec: Any,
) -> dict[str, str]:
    """Resolve required environment variables from the user's personal environment.

    This is the just-in-time credential resolution that keeps secrets out
    of the Temporal workflow history. The activity fetches each required
    secret value individually via gRPC, so decrypted values exist only in
    the activity's process memory.

    Returns an empty dict when the MCP server has no ``env_spec``.
    Raises ``ValueError`` with a clear message listing missing keys when
    required credentials are not present.
    """
    env_spec = spec.env_spec
    if not env_spec or not env_spec.data:
        return {}

    required_keys = list(env_spec.data.keys())
    logger.info(
        "Resolving %d env var(s) from personal environment: %s",
        len(required_keys),
        required_keys,
    )

    env_list = await env_client.list_environments(
        org=org,
        labels={_PERSONAL_ENV_LABEL: "true"},
    )

    if env_list.total_count == 0 or not env_list.items:
        raise ValueError(
            f"Personal environment not found for org '{org}'. "
            f"Save required credentials first: {required_keys}"
        )

    personal_env = env_list.items[0]
    personal_env_id = personal_env.metadata.id
    stored_keys = set(personal_env.spec.data.keys()) if personal_env.spec.data else set()

    result: dict[str, str] = {}
    missing: list[str] = []

    for key in required_keys:
        if key not in stored_keys:
            missing.append(key)
            continue

        try:
            env_value = await env_client.get_secret_value(personal_env_id, key)
            if env_value.value:
                result[key] = env_value.value
            else:
                missing.append(key)
        except (grpc.RpcError, ValueError) as exc:
            logger.warning(
                "Failed to get secret value for key '%s' from env '%s': %s",
                key, personal_env_id, exc,
            )
            missing.append(key)

    if missing:
        raise ValueError(
            f"Missing required credentials in personal environment: {missing}. "
            "Save these credentials in your personal environment before "
            "triggering discovery."
        )

    logger.info(
        "Resolved %d env var(s) from personal environment '%s'",
        len(result),
        personal_env_id,
    )
    return result


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
