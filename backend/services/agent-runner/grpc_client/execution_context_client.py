"""gRPC client for fetching ExecutionContext resources."""

from __future__ import annotations

import logging

import grpc
from ai.stigmer.agentic.executioncontext.v1 import query_pb2_grpc
from ai.stigmer.agentic.executioncontext.v1.api_pb2 import ExecutionContext
from ai.stigmer.agentic.executioncontext.v1.io_pb2 import ExecutionContextExecutionIdInput

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker.config import Config

logger = logging.getLogger(__name__)


class ExecutionContextNotFoundError(Exception):
    """Raised when no ExecutionContext exists for the given execution ID.
    
    This is expected for executions created before ExecutionContext support was added.
    Callers should fall back to the existing environment resolution flow.
    """
    pass


_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class ExecutionContextClient:
    """Client for fetching ExecutionContext from Stigmer backend.
    
    The ExecutionContext contains environment variables that were merged from:
    1. AgentInstance environment_refs (layered environment configs)
    2. AgentExecution runtime_env (runtime overrides)
    
    This client queries the ExecutionContext by execution ID to retrieve
    the decrypted environment variables for use during agent execution.
    
    Usage:
        client = ExecutionContextClient(api_key)
        
        try:
            exec_ctx = await client.get_by_execution_id(execution_id)
            # Use exec_ctx.spec.data for environment variables
        except ExecutionContextNotFoundError:
            # Fall back to existing flow (backward compatibility)
            pass
    """
    
    def __init__(
        self,
        token: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize ExecutionContextClient with authentication.
        
        Args:
            token: Stigmer auth token (JWT or API key).
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
            interceptor = AuthClientInterceptor(token)
            self.channel = create_channel(
                config.stigmer_backend_endpoint, interceptors=[interceptor],
            )
            self._owns_channel = True
        
        self.stub = query_pb2_grpc.ExecutionContextQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def get_by_execution_id(self, execution_id: str) -> ExecutionContext:
        """Fetch ExecutionContext by execution ID.
        
        The returned ExecutionContext contains:
        - spec.execution_id: The execution ID this context belongs to
        - spec.data: Map of environment variables with decrypted secret values
        
        Args:
            execution_id: The agent or workflow execution ID
            
        Returns:
            ExecutionContext proto message with decrypted environment variables
            
        Raises:
            ExecutionContextNotFoundError: If no context exists for the execution
                (expected for backward compatibility - caller should fall back)
            grpc.RpcError: If gRPC call fails for other reasons
        """
        if not execution_id:
            raise ValueError("execution_id cannot be empty")
        
        try:
            input_msg = ExecutionContextExecutionIdInput(execution_id=execution_id)
            result = await self.stub.getByExecutionId(input_msg, timeout=self._timeout)
            
            logger.debug(
                f"Successfully retrieved ExecutionContext for execution {execution_id}: "
                f"context_id={result.metadata.id}, data_count={len(result.spec.data)}"
            )
            
            return result
            
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.debug(
                    f"ExecutionContext not found for execution {execution_id} - "
                    "will use fallback environment resolution"
                )
                raise ExecutionContextNotFoundError(
                    f"No ExecutionContext exists for execution {execution_id}"
                ) from e
            else:
                logger.error(
                    f"Failed to fetch ExecutionContext for execution {execution_id}: {e}"
                )
                raise
    
    async def try_get_by_execution_id(self, execution_id: str) -> ExecutionContext | None:
        """Try to fetch ExecutionContext, returning None if not found.
        
        This is a convenience method that handles ExecutionContextNotFoundError
        by returning None instead of raising an exception.
        
        Args:
            execution_id: The agent or workflow execution ID
            
        Returns:
            ExecutionContext if found, None if not found
            
        Raises:
            grpc.RpcError: If gRPC call fails for reasons other than NOT_FOUND
        """
        try:
            return await self.get_by_execution_id(execution_id)
        except ExecutionContextNotFoundError:
            return None
