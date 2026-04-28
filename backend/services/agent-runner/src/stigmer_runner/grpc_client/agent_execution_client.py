"""gRPC client for AgentExecution resources (read and write)."""

from __future__ import annotations

import grpc
from ai.stigmer.agentic.agentexecution.v1 import command_pb2_grpc, query_pb2_grpc
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecution, AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import (
    AgentExecutionId,
    AgentExecutionUpdateStatusInput,
)

from stigmer_runner.grpc_client.auth.client_interceptor import AuthClientInterceptor
from stigmer_runner.grpc_client.channel import create_channel
from stigmer_runner.worker.config import Config

_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class AgentExecutionClient:
    """Client for reading and updating AgentExecution resources.
    
    Uses two service stubs on a shared gRPC channel:
    - AgentExecutionQueryController  -- read operations (get, list, ...)
    - AgentExecutionCommandController -- write operations (updateStatus, ...)
    """
    
    def __init__(
        self,
        token: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize AgentExecution client with authentication.
        
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
        
        self.command_stub = command_pb2_grpc.AgentExecutionCommandControllerStub(self.channel)
        self.query_stub = query_pb2_grpc.AgentExecutionQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def get(self, execution_id: str) -> AgentExecution:
        """
        Fetch an AgentExecution by ID.
        
        This is used by the ExecuteGraphton activity to hydrate the execution
        from the database instead of receiving the full proto through Temporal,
        keeping Temporal activity payloads small and bounded.
        
        Args:
            execution_id: The execution ID to fetch
            
        Returns:
            The full AgentExecution protobuf (metadata + spec + status)
            
        Raises:
            ValueError: If execution_id is empty
            grpc.RpcError: On gRPC failures (NOT_FOUND, UNAVAILABLE, etc.)
        """
        if not execution_id:
            raise ValueError("execution_id cannot be empty")
        
        return await self.query_stub.get(
            AgentExecutionId(value=execution_id), timeout=self._timeout,
        )
    
    async def update_status(self, execution_id: str, status: AgentExecutionStatus) -> AgentExecution:
        """
        Send status update for an execution.
        
        This method uses AgentExecutionUpdateStatusInput to send only execution_id and status.
        The BuildNewStateWithStatusStep in AgentExecutionUpdateStatusHandler will load the
        existing execution, authorize, and merge the status updates.
        
        Args:
            execution_id: The execution ID to update
            status: The AgentExecutionStatus with updates (messages, tool_calls, phase, etc.)
            
        Returns:
            Updated AgentExecution protobuf object
        """
        if not execution_id:
            raise ValueError("execution_id cannot be empty")
        
        update_input = AgentExecutionUpdateStatusInput(
            execution_id=execution_id,
            status=status
        )
        
        return await self.command_stub.updateStatus(update_input, timeout=self._timeout)
