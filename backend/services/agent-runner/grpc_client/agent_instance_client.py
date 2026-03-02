"""gRPC client for fetching AgentInstance configuration."""

import grpc
from ai.stigmer.agentic.agentinstance.v1 import query_pb2_grpc
from ai.stigmer.agentic.agentinstance.v1.api_pb2 import AgentInstance
from ai.stigmer.agentic.agentinstance.v1.io_pb2 import AgentInstanceId

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from worker.config import Config


_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class AgentInstanceClient:
    """Client for interacting with AgentInstanceQueryController."""
    
    def __init__(self, api_key: str, *, timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS):
        """
        Initialize AgentInstance client with authentication.
        
        Args:
            api_key: Stigmer API key for authentication
            timeout: Per-call gRPC deadline in seconds (must stay well under
                     Temporal's 30s heartbeat timeout to allow graceful recovery).
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
        
        self.stub = query_pb2_grpc.AgentInstanceQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def get(self, agent_instance_id: str) -> AgentInstance:
        """Fetch agent instance by ID."""
        if not agent_instance_id:
            raise ValueError("agent_instance_id cannot be empty")
        request = AgentInstanceId(value=agent_instance_id)
        return await self.stub.get(request, timeout=self._timeout)
