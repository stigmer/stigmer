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

Stdio MCP servers run as local subprocesses via ``MultiServerMCPClient``.
HTTP servers connect to remote endpoints.

Security: The Go/Java backend creates an ephemeral ExecutionContext
containing only the environment variables the MCP server needs. The
Temporal workflow input carries only ``mcp_server_id`` and an
``execution_context_id`` — no secret values ever appear in Temporal's
durable workflow history. The Python activity reads from the scoped
ExecutionContext and cannot access arbitrary environments.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import grpc
from temporalio import activity, workflow
from temporalio.common import RetryPolicy

from stigmer_runner.grpc_client.channel import ChannelProvider
from stigmer_runner.grpc_client.execution_context_client import ExecutionContextClient
from stigmer_runner.grpc_client.mcp_server_client import McpServerClient
from stigmer_runner.worker import execution_tracker
from stigmer_runner.worker.auth import get_token
from stigmer_runner.worker.mcp.config_transformer import _inject_platform_env, transform_mcp_config

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
    """Output of the MCP server discovery activity.

    Includes the newly discovered tools and resource templates, plus a
    snapshot of the previous state (tools fingerprint and tool approvals)
    so the workflow can short-circuit classification when tools haven't
    changed.
    """

    tools: list[DiscoveredToolResult]
    resource_templates: list[DiscoveredResourceTemplateResult]
    previous_tools_fingerprint: str = ""
    previous_tool_approvals: list[dict[str, Any]] = field(default_factory=list)


def tools_fingerprint(tools: list[DiscoveredToolResult]) -> str:
    """Compute a deterministic content hash of a tool set.

    The fingerprint covers name, description, and input_schema for each
    tool, sorted by name.  Any material change (new tool, removed tool,
    schema change, description change) produces a different hash, which
    triggers reclassification in the connect workflow.

    Safe to call from Temporal workflow code (pure, deterministic, no I/O).
    """
    if not tools:
        return ""
    canonical = sorted(
        [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema,
            }
            for t in tools
        ],
        key=lambda x: str(x["name"]),
    )
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True).encode()
    ).hexdigest()


@activity.defn(name=ACTIVITY_NAME)
async def discover_mcp_server(input: DiscoverMcpServerInput) -> DiscoverMcpServerOutput:
    """Discover capabilities of an MCP server by connecting to it.

    1. Fetches the McpServer spec via gRPC (OBO impersonation when available)
    2. Resolves environment variables from the pre-created ExecutionContext
    3. Transforms the spec into a client-compatible config
    4. Connects and lists tools + resource templates
    5. Returns a serializable result for the backend to store
    """
    logger.info(
        "DiscoverMcpServerCapabilities started for mcp_server_id=%s",
        input.mcp_server_id,
    )

    token = get_token()
    if not token:
        raise RuntimeError("Auth token not available for MCP server discovery")

    execution_tracker.increment()

    grpc_provider = ChannelProvider(token)
    ch = grpc_provider.channel

    try:
        mcp_server_client = McpServerClient(token, channel=ch)
        mcp_server = await mcp_server_client.get(input.mcp_server_id)

        if not mcp_server or not mcp_server.spec:
            raise ValueError(
                f"MCP server '{input.mcp_server_id}' not found or has no spec"
            )

        slug = mcp_server.metadata.slug or input.mcp_server_id
        spec = mcp_server.spec

        prev_fingerprint, prev_approvals = _extract_previous_state(mcp_server)

        env_vars = await _resolve_env_vars_for_discovery(
            token=token,
            channel=ch,
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
            previous_tools_fingerprint=prev_fingerprint,
            previous_tool_approvals=prev_approvals,
        )

    finally:
        await grpc_provider.close()
        execution_tracker.decrement()


def _extract_previous_state(
    mcp_server: Any,
) -> tuple[str, list[dict[str, Any]]]:
    """Extract previous tools fingerprint and approvals from McpServer status.

    Returns ``("", [])`` when the server has never been connected (no
    discovered_capabilities or tool_approvals yet).
    """
    status = getattr(mcp_server, "status", None)
    if not status:
        return "", []

    caps = getattr(status, "discovered_capabilities", None)
    prev_tools: list[DiscoveredToolResult] = []
    if caps:
        for tool in getattr(caps, "tools", []):
            schema = None
            if tool.input_schema and tool.input_schema.fields:
                from google.protobuf.json_format import MessageToDict
                schema = MessageToDict(tool.input_schema)
            prev_tools.append(DiscoveredToolResult(
                name=tool.name,
                description=tool.description,
                input_schema=schema,
            ))

    prev_approvals: list[dict[str, Any]] = []
    for approval in getattr(status, "tool_approvals", []):
        prev_approvals.append({
            "tool_name": approval.tool_name,
            "requires_approval": approval.requires_approval,
            "message": approval.message,
        })

    return tools_fingerprint(prev_tools), prev_approvals


async def _resolve_env_vars_for_discovery(
    *,
    token: str,
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
            token, channel, execution_context_id,
        )

    return {}


async def _resolve_env_from_execution_context(
    token: str,
    channel: grpc.aio.Channel,
    execution_context_id: str,
) -> dict[str, str]:
    """Read environment variables from a pre-created ExecutionContext.

    Follows the same pattern as ``graphton/environment.py``: use
    ``ExecutionContextClient.try_get_by_execution_id`` and extract
    plaintext values from ``spec.data``.
    """
    ec_client = ExecutionContextClient(token, channel=channel)
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

    Uses ``MultiServerMCPClient`` for both stdio (local subprocess) and
    HTTP (remote endpoint) transports.

    The entire block is guarded by ``asyncio.timeout()`` to surface a clear
    error when an MCP server's cold start exceeds the allowed window.
    Unlike ``asyncio.wait_for()``, ``timeout()`` operates on the current
    task's cancel scope and does not cross anyio task boundaries during
    teardown.
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
            from stigmer_runner.worker.activities.classify_tool_approvals import (
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

        new_fingerprint = tools_fingerprint(discovery.tools)
        if (
            new_fingerprint
            and new_fingerprint == discovery.previous_tools_fingerprint
            and discovery.previous_tool_approvals
        ):
            workflow.logger.info(
                "Tools unchanged for '%s' (fingerprint %s) "
                "— reusing %d previous approval(s)",
                input.mcp_server_id,
                new_fingerprint[:12],
                len(discovery.previous_tool_approvals),
            )
            tool_approvals = discovery.previous_tool_approvals
        else:
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
                mcp_server_id=input.mcp_server_id,
            )

            num_tools = len(discovery.tools)
            classify_timeout = max(120, (num_tools // 40 + 1) * 60)

            tool_approvals = await workflow.execute_activity(
                classify_tool_approvals,
                classify_input,
                start_to_close_timeout=timedelta(seconds=classify_timeout),
                retry_policy=RetryPolicy(maximum_attempts=2),
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
