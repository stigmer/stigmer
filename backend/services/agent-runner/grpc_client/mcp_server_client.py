"""gRPC client for MCP Server API.

This client fetches MCP server configurations from the Stigmer backend.
MCP servers define how AI agents connect to external tools and services
via the Model Context Protocol.
"""

from __future__ import annotations

import asyncio
import logging

import grpc
from ai.stigmer.agentic.mcpserver.v1 import query_pb2_grpc
from ai.stigmer.agentic.mcpserver.v1.api_pb2 import McpServer
from ai.stigmer.agentic.mcpserver.v1.io_pb2 import McpServerId
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from worker.config import Config

logger = logging.getLogger(__name__)


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
    
    def __init__(self, api_key: str) -> None:
        """Initialize McpServerClient with authentication.
        
        Args:
            api_key: Stigmer API key for authentication.
        """
        config = Config.load_from_env()
        endpoint = config.stigmer_backend_endpoint
        
        # Create interceptor with API key
        interceptor = AuthClientInterceptor(api_key)
        
        # Create channel with interceptor
        if endpoint.endswith(":443"):
            self.channel = grpc.aio.secure_channel(
                endpoint,
                grpc.ssl_channel_credentials(),
                interceptors=[interceptor],
            )
        else:
            self.channel = grpc.aio.insecure_channel(
                endpoint,
                interceptors=[interceptor],
            )
        
        self.stub = query_pb2_grpc.McpServerQueryControllerStub(self.channel)
    
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
            return await self.stub.get(request)
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
            return await self.stub.getByReference(ref)
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
            # Fetch all MCP servers in parallel
            servers = await asyncio.gather(
                *[self.get(server_id) for server_id in mcp_server_ids]
            )
            
            logger.info(
                f"Successfully fetched {len(servers)} MCP servers: "
                f"{[s.metadata.name for s in servers]}"
            )
            
            return list(servers)
            
        except ValueError:
            # Re-raise ValueError (server not found)
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
            # Fetch all MCP servers in parallel
            servers = await asyncio.gather(
                *[self.get_by_reference(ref) for ref in refs]
            )
            
            logger.info(
                f"Successfully fetched {len(servers)} MCP servers: "
                f"{[s.metadata.name for s in servers]}"
            )
            
            return list(servers)
            
        except ValueError:
            # Re-raise ValueError (server not found)
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch MCP servers: {e}")
            raise
    
    async def close(self) -> None:
        """Close the gRPC channel.
        
        Should be called when the client is no longer needed.
        """
        await self.channel.close()
