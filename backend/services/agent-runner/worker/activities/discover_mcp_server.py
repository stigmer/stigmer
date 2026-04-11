"""Temporal workflows and activity for MCP server connect flow.

The connect flow has two stages:

1. **Discover** — connect to an MCP server (stdio or HTTP), enumerate its
   tools and resource templates, and return the result as a serializable dict.
2. **Classify** — pass the discovered tools through a lightweight LLM to
   determine which tools require human approval before execution.

The ``ConnectMcpServerWorkflow`` chains both stages and returns a combined
output (capabilities + tool approval policies).  The legacy
``DiscoverMcpServerWorkflow`` is retained for backward compatibility during
deployment transitions.

In cloud mode, stdio MCP servers are started inside an ephemeral Daytona
sandbox for security isolation — the agent-runner pod never executes
untrusted MCP server code directly.  The sandbox is created before
discovery, used for the MCP session, and deleted immediately afterward.
HTTP servers connect to remote endpoints and need no sandbox.  In
local/OSS mode, stdio servers run as local subprocesses (no sandbox).

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
import os
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import grpc
from temporalio import activity, workflow
from temporalio.common import RetryPolicy

from grpc_client.channel import ChannelProvider
from grpc_client.execution_context_client import ExecutionContextClient
from grpc_client.mcp_server_client import McpServerClient
from worker.mcp.config_transformer import _inject_platform_env, transform_mcp_config
from worker.token_manager import get_api_key

logger = logging.getLogger(__name__)

ACTIVITY_NAME = "DiscoverMcpServerCapabilities"
DISCOVER_WORKFLOW_NAME = "stigmer/mcp-server/discover"
CONNECT_WORKFLOW_NAME = "stigmer/mcp-server/connect"


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
    3. Transforms the spec into a client-compatible config
    4. In cloud mode, creates an ephemeral sandbox for stdio servers
    5. Connects and lists tools + resource templates
    6. Deletes the ephemeral sandbox immediately after use
    7. Returns a serializable result for the backend to store
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

    sandbox = None
    sandbox_manager = None

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

        sandbox, sandbox_manager = await _maybe_create_discovery_sandbox(
            config=config,
            heartbeat_fn=activity.heartbeat,
        )

        tools, resource_templates = await _connect_and_discover(
            slug, config, sandbox=sandbox,
        )

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
        if sandbox is not None and sandbox_manager is not None:
            await _cleanup_discovery_sandbox(sandbox_manager, sandbox.id)
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


async def _maybe_create_discovery_sandbox(
    config: dict[str, Any],
    heartbeat_fn: Any | None = None,
) -> tuple[Any, Any] | tuple[None, None]:
    """Create an ephemeral Daytona sandbox for stdio discovery in cloud mode.

    Encapsulates the three-way gating decision (mirrors
    ``_maybe_create_daytona_mcp_client`` in ``graphton/setup.py``):

    1. Local/OSS mode → ``(None, None)`` — stdio runs as local subprocess
    2. Cloud mode but HTTP transport → ``(None, None)`` — no sandbox needed
    3. Cloud mode + stdio transport → create ephemeral sandbox

    The sandbox is used only for the duration of the MCP discovery session
    and is deleted immediately afterward by the caller's ``finally`` block.

    Returns:
        ``(sandbox, sandbox_manager)`` when a sandbox was created,
        ``(None, None)`` when no sandbox is needed.
    """
    from worker.config import Config

    worker_config = Config.load_from_env()
    if worker_config.is_local_mode():
        return None, None

    if config.get("transport") != "stdio":
        return None, None

    daytona_api_key = os.environ.get("DAYTONA_API_KEY")
    if not daytona_api_key:
        raise RuntimeError(
            "DAYTONA_API_KEY required for cloud-mode stdio MCP discovery"
        )

    from worker.sandbox_manager import SandboxManager

    sandbox_manager = SandboxManager(daytona_api_key=daytona_api_key)
    sandbox_config = worker_config.get_sandbox_config(session_id=None)

    logger.info("Creating ephemeral Daytona sandbox for MCP discovery")
    sandbox, _ = await sandbox_manager.get_or_create_daytona_sandbox(
        sandbox_config=sandbox_config,
        session_id=None,
        session_client=None,
        heartbeat_fn=heartbeat_fn,
    )
    logger.info("Ephemeral discovery sandbox ready: %s", sandbox.id)

    return sandbox, sandbox_manager


async def _cleanup_discovery_sandbox(
    sandbox_manager: Any,
    sandbox_id: str,
) -> None:
    """Delete the ephemeral discovery sandbox immediately after use.

    Best-effort: logs a warning on failure rather than masking the
    original exception.  The sandbox's ``auto_stop_interval`` (set during
    creation by ``SandboxManager``) acts as a safety net if explicit
    deletion fails.
    """
    logger.info("Cleaning up ephemeral discovery sandbox: %s", sandbox_id)
    await sandbox_manager.cleanup_daytona_sandbox(sandbox_id)


async def _connect_and_discover(
    server_slug: str,
    config: dict[str, Any],
    sandbox: Any | None = None,
) -> tuple[list[DiscoveredToolResult], list[DiscoveredResourceTemplateResult]]:
    """Connect to an MCP server and enumerate its capabilities.

    When ``sandbox`` is provided and the transport is stdio, the MCP server
    runs inside the Daytona sandbox via ``DaytonaMCPClient``.  Otherwise,
    ``MultiServerMCPClient`` handles the connection (stdio as local
    subprocess, or HTTP to a remote endpoint).

    Both client types expose the same ``session()`` context manager
    yielding an MCP ``ClientSession``, so the discovery code below is
    transport-agnostic.

    The entire block is guarded by ``asyncio.timeout()`` to surface a clear
    error when an MCP server's cold start exceeds the allowed window.
    Unlike ``asyncio.wait_for()``, ``timeout()`` operates on the current
    task's cancel scope and does not cross anyio task boundaries during
    teardown.
    """
    servers: dict[str, Any] = {server_slug: config}

    if sandbox is not None and config.get("transport") == "stdio":
        from worker.mcp.daytona_mcp_client import DaytonaMCPClient
        client: Any = DaytonaMCPClient(servers=servers, sandbox=sandbox)
    else:
        from langchain_mcp_adapters.client import MultiServerMCPClient
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


@dataclass
class ConnectMcpServerOutput:
    """Combined output of the connect workflow (discover + classify).

    Extends discovery output with tool approval policies produced by the
    LLM classifier.  The Go/Java backend persists ``tools`` and
    ``resource_templates`` to ``status.discovered_capabilities`` and
    ``tool_approvals`` to ``status.tool_approvals``.
    """

    tools: list[DiscoveredToolResult]
    resource_templates: list[DiscoveredResourceTemplateResult]
    tool_approvals: list[dict[str, Any]]


@workflow.defn(name=CONNECT_WORKFLOW_NAME)
class ConnectMcpServerWorkflow:
    """Temporal workflow that discovers MCP capabilities and classifies approvals.

    Two-stage pipeline:
    1. ``DiscoverMcpServerCapabilities`` — connect, list tools and resources.
    2. ``ClassifyToolApprovals`` — pass discovered tools through an LLM
       classifier to determine which require human approval.

    Both the Go (OSS) and Java (Cloud) backends start this workflow by name
    on the runner queue.  The workflow returns a combined output that the
    backend stores on the ``McpServer`` status.
    """

    @workflow.run
    async def run(self, input: DiscoverMcpServerInput) -> ConnectMcpServerOutput:
        with workflow.unsafe.imports_passed_through():
            from worker.activities.classify_tool_approvals import (
                ClassifyToolApprovalsInput,
                classify_tool_approvals,
            )

        discovery = await workflow.execute_activity(
            discover_mcp_server,
            input,
            start_to_close_timeout=timedelta(seconds=600),
            heartbeat_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )

        classify_input = ClassifyToolApprovalsInput(
            tools=[
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                }
                for t in discovery.tools
            ],
            server_name=input.mcp_server_id,
            server_description="",
        )

        tool_approvals = await workflow.execute_activity(
            classify_tool_approvals,
            classify_input,
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )

        return ConnectMcpServerOutput(
            tools=discovery.tools,
            resource_templates=discovery.resource_templates,
            tool_approvals=tool_approvals,
        )


@workflow.defn(name=DISCOVER_WORKFLOW_NAME)
class DiscoverMcpServerWorkflow:
    """Legacy workflow for backward compatibility during deploy transitions.

    Retained so that in-flight workflows started with the old name
    ``stigmer/mcp-server/discover`` complete successfully.  New callers
    should use ``ConnectMcpServerWorkflow`` instead.
    """

    @workflow.run
    async def run(self, input: DiscoverMcpServerInput) -> DiscoverMcpServerOutput:
        return await workflow.execute_activity(
            discover_mcp_server,
            input,
            start_to_close_timeout=timedelta(seconds=600),
            heartbeat_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
