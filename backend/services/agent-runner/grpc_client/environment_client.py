"""gRPC client for fetching Environment resources."""

import grpc
from ai.stigmer.agentic.environment.v1 import query_pb2_grpc
from ai.stigmer.agentic.environment.v1.api_pb2 import Environment
from ai.stigmer.agentic.environment.v1.io_pb2 import EnvironmentId
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference
from worker.config import Config
from grpc_client.auth.client_interceptor import AuthClientInterceptor
import logging
import asyncio

logger = logging.getLogger(__name__)


class EnvironmentClient:
    """Client for fetching environments from Stigmer backend."""
    
    def __init__(self, api_key: str):
        """
        Initialize EnvironmentClient with authentication.
        
        Args:
            api_key: Stigmer API key for authentication
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
                interceptors=[interceptor]
            )
        else:
            self.channel = grpc.aio.insecure_channel(
                endpoint,
                interceptors=[interceptor]
            )
        
        self.stub = query_pb2_grpc.EnvironmentQueryServiceStub(self.channel)
    
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
            return await self.stub.getByReference(ref)
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
            # Fetch all environments in parallel, preserving order
            environments = await asyncio.gather(
                *[self.get_by_reference(ref) for ref in refs]
            )
            
            logger.info(
                f"Successfully fetched {len(environments)} environments: "
                f"{[env.metadata.name for env in environments]}"
            )
            
            return list(environments)
            
        except ValueError:
            # Re-raise ValueError (environment not found)
            raise
        except grpc.RpcError as e:
            logger.error(f"Failed to fetch environments: {e}")
            raise
