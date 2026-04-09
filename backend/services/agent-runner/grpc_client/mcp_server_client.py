"""gRPC client for MCP Server API.

Provides both query (read) and command (write) access to MCP server
resources.  The query stub is used during normal agent execution to
fetch server configs.  The command stub is used by the Graphton backfill
to trigger the ``connect`` RPC on first-time-use.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import grpc
from ai.stigmer.agentic.mcpserver.v1 import command_pb2_grpc, query_pb2_grpc
from ai.stigmer.agentic.mcpserver.v1.api_pb2 import McpServer
from ai.stigmer.agentic.mcpserver.v1.io_pb2 import ConnectInput, McpServerId
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker.config import Config

logger = logging.getLogger(__name__)

_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class McpServerClient:
    """Client for fetching MCP server configurations from Stigmer backend.
    
    This client communicates with the MCP Server Query API to retrieve
    McpServer resources by ID or reference. The fetched configurations
    are used to initialize MCP connections for agent execution.
    
    Example:
        >>> client = McpServerClient(api_key="...")
        >>> servers = await client.list_by_refs(agent.spec.mcp_server_usages)
        >>> for server in servers:
        ...     print(f"Server: {server.metadata.name}")
    """

    def __init__(
        self,
        api_key: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ) -> None:
        """Initialize McpServerClient with authentication.
        
        Args:
            api_key: Stigmer API key for authentication.
            timeout: Per-call gRPC deadline in seconds (must stay well under
                     Temporal's 30s heartbeat timeout to allow graceful recovery).
            channel: Optional shared gRPC channel (from ChannelProvider). When
                     provided, the client does not create or own a channel.
        """
        if channel is not None:
            self.channel = channel
            self._owns_channel = False
        else:
            config = Config.load_from_env()
            interceptor = AuthClientInterceptor(api_key)
            self.channel = create_channel(
                config.stigmer_backend_endpoint, interceptors=[interceptor],
            )
            self._owns_channel = True
        
        self.stub = query_pb2_grpc.McpServerQueryControllerStub(self.channel)
        self.command_stub = command_pb2_grpc.McpServerCommandControllerStub(self.channel)
        self._timeout = timeout
    
    async def get(self, mcp_server_id: str) -> McpServer:
        """Fetch a single MCP server by ID.
        
        Args:
            mcp_server_id: UUID of the MCP server.
            
        Returns:
            McpServer proto message.
            
        Raises:
            grpc.RpcError: If gRPC call fails.
            ValueError: If MCP server not found or access denied.
        """
        request = McpServerId(value=mcp_server_id)
        
        try:
            return await self.stub.get(request, timeout=self._timeout)
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.error(f"MCP server {mcp_server_id} not found")
                raise ValueError(
                    f"MCP server {mcp_server_id} not found or access denied. "
                    "Ensure the MCP server exists and you have permission to access it."
                ) from e
            else:
                logger.error(f"Failed to fetch MCP server {mcp_server_id}: {e}")
                raise
    
    async def get_by_reference(self, ref: ApiResourceReference) -> McpServer:
        """Fetch MCP server by ApiResourceReference.
        
        Args:
            ref: ApiResourceReference with scope, org, kind, and slug.
            
        Returns:
            McpServer proto message.
            
        Raises:
            grpc.RpcError: If gRPC call fails.
            ValueError: If MCP server not found or access denied.
        """
        try:
            return await self.stub.getByReference(ref, timeout=self._timeout)
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.error(f"MCP server '{ref.slug}' not found")
                raise ValueError(
                    f"MCP server '{ref.slug}' not found or access denied. "
                    "Ensure the MCP server exists and you have permission to access it."
                ) from e
            else:
                logger.error(f"Failed to fetch MCP server '{ref.slug}': {e}")
                raise
    
    async def list_by_ids(self, mcp_server_ids: list[str]) -> list[McpServer]:
        """Fetch multiple MCP servers by IDs.
        
        Fetches MCP servers in parallel for efficiency.
        
        Args:
            mcp_server_ids: List of MCP server IDs (UUIDs).
            
        Returns:
            List of McpServer proto messages.
            
        Raises:
            grpc.RpcError: If any gRPC call fails.
            ValueError: If any MCP server not found or access denied.
        """
        if not mcp_server_ids:
            return []
        
        logger.info(f"Fetching {len(mcp_server_ids)} MCP servers: {mcp_server_ids}")
        
        try:
            servers = await asyncio.gather(
                *[self.get(server_id) for server_id in mcp_server_ids]
            )
            
            logger.info(
                f"Successfully fetched {len(servers)} MCP servers: "
                f"{[s.metadata.name for s in servers]}"
            )
            
            return list(servers)
            
        except ValueError:
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch MCP servers: {e}")
            raise
    
    async def list_by_refs(self, refs: list[ApiResourceReference]) -> list[McpServer]:
        """Fetch multiple MCP servers by ApiResourceReference.
        
        Fetches MCP servers in parallel for efficiency. This is the primary
        method used when loading MCP servers from Agent.spec.mcp_server_usages.
        
        Args:
            refs: List of ApiResourceReference objects (from mcp_server_ref).
            
        Returns:
            List of McpServer proto messages.
            
        Raises:
            grpc.RpcError: If any gRPC call fails.
            ValueError: If any MCP server not found or access denied.
        """
        if not refs:
            return []
        
        logger.info(
            f"Fetching {len(refs)} MCP servers: {[ref.slug for ref in refs]}"
        )
        
        try:
            servers = await asyncio.gather(
                *[self.get_by_reference(ref) for ref in refs]
            )
            
            logger.info(
                f"Successfully fetched {len(servers)} MCP servers: "
                f"{[s.metadata.name for s in servers]}"
            )
            
            return list(servers)
            
        except ValueError:
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch MCP servers: {e}")
            raise
    
    async def connect(
        self,
        mcp_server_id: str,
        runtime_env: dict[str, Any] | None = None,
        *,
        timeout: float = 60.0,
    ) -> McpServer:
        """Trigger the connect RPC: discover tools and classify approvals.

        The backend starts a Temporal workflow that connects to the MCP
        server, enumerates tools and resource templates, classifies
        approval policies via LLM, and stores the results on the server's
        status.  This call blocks until the workflow completes.

        Args:
            mcp_server_id: ID of the MCP server to connect to.
            runtime_env: Optional env vars for one-time use.  When empty,
                the backend resolves from the user's personal environment.
            timeout: gRPC deadline in seconds.  Must exceed the backend's
                workflow run timeout (45s Go / 330s Java).

        Returns:
            Updated McpServer with populated status.

        Raises:
            grpc.RpcError: On timeout, auth failure, or missing env vars.
        """
        request = ConnectInput(mcp_server_id=mcp_server_id)

        if runtime_env:
            from ai.stigmer.agentic.executioncontext.v1.spec_pb2 import ExecutionValue
            for key, value in runtime_env.items():
                if isinstance(value, str):
                    request.runtime_env[key].CopyFrom(
                        ExecutionValue(value=value)
                    )

        try:
            return await self.command_stub.connect(request, timeout=timeout)
        except grpc.RpcError as e:
            logger.error(
                "Connect RPC failed for MCP server %s: %s",
                mcp_server_id, e,
            )
            raise

    async def close(self) -> None:
        """Close the gRPC channel (only if this client owns it)."""
        if self._owns_channel:
            await self.channel.close()
