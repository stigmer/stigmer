"""gRPC client for fetching Environment resources."""

from __future__ import annotations

import asyncio
import logging

import grpc
from ai.stigmer.agentic.environment.v1 import query_pb2_grpc
from ai.stigmer.agentic.environment.v1.api_pb2 import Environment
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker.config import Config

logger = logging.getLogger(__name__)


_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class EnvironmentClient:
    """Client for fetching environments from Stigmer backend."""
    
    def __init__(
        self,
        api_key: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize EnvironmentClient with authentication.
        
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
        
        self.stub = query_pb2_grpc.EnvironmentQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def get_by_reference(self, ref: ApiResourceReference) -> Environment:
        """Fetch environment by ApiResourceReference.
        
        Args:
            ref: ApiResourceReference with scope, org, kind, and slug
            
        Returns:
            Environment proto message
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If environment not found or access denied
        """
        try:
            return await self.stub.getByReference(ref, timeout=self._timeout)
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.error(f"Environment {ref.slug} not found")
                raise ValueError(
                    f"Environment '{ref.slug}' not found or access denied. "
                    "Ensure environment exists and you have permission to access it."
                ) from e
            else:
                logger.error(f"Failed to fetch environment {ref.slug}: {e}")
                raise
    
    async def list_by_refs(self, refs: list[ApiResourceReference]) -> list[Environment]:
        """Fetch multiple environments by ApiResourceReference.
        
        Environments are returned in the same order as refs for proper merging.
        
        Args:
            refs: List of ApiResourceReference objects
            
        Returns:
            List of Environment proto messages (in same order as refs)
            
        Raises:
            grpc.RpcError: If gRPC call fails
            ValueError: If any environment not found or access denied
        """
        if not refs:
            return []
        
        logger.info(f"Fetching {len(refs)} environments: {[ref.slug for ref in refs]}")
        
        try:
            environments = await asyncio.gather(
                *[self.get_by_reference(ref) for ref in refs]
            )
            
            logger.info(
                f"Successfully fetched {len(environments)} environments: "
                f"{[env.metadata.name for env in environments]}"
            )
            
            return list(environments)
            
        except ValueError:
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch environments: {e}")
            raise
