"""gRPC client for fetching Agent configuration."""

import grpc
from ai.stigmer.agentic.agent.v1 import query_pb2_grpc
from ai.stigmer.agentic.agent.v1.api_pb2 import Agent
from ai.stigmer.agentic.agent.v1.io_pb2 import AgentId
from worker.config import Config
from grpc_client.auth.client_interceptor import AuthClientInterceptor


class AgentClient:
    """Client for interacting with AgentQueryController."""
    
    def __init__(self, api_key: str):
        """
        Initialize Agent client with authentication.
        
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
        
        self.stub = query_pb2_grpc.AgentQueryControllerStub(self.channel)
    
    async def get(self, agent_id: str) -> Agent:
        """Fetch agent by ID."""
        if not agent_id:
            raise ValueError("agent_id cannot be empty")
        request = AgentId(value=agent_id)
        return await self.stub.get(request)
