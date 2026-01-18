"""gRPC client for updating AgentExecution resources."""

import grpc
from ai.stigmer.agentic.agentexecution.v1 import command_pb2_grpc
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecution, AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.command_pb2 import AgentExecutionUpdateStatusInput
from worker.config import Config
from grpc_client.auth.client_interceptor import AuthClientInterceptor


class AgentExecutionClient:
    """Client for sending status updates to AgentExecutionCommandController."""
    
    def __init__(self, api_key: str):
        """
        Initialize AgentExecution client with authentication.
        
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
        
        self.command_stub = command_pb2_grpc.AgentExecutionCommandControllerStub(self.channel)
    
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
        
        # Build AgentExecutionUpdateStatusInput with execution_id and status
        # This is the new contract that avoids validation errors on incomplete metadata
        update_input = AgentExecutionUpdateStatusInput(
            execution_id=execution_id,
            status=status
        )
        
        return await self.command_stub.updateStatus(update_input)
