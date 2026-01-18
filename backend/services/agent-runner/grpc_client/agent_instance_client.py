"""gRPC client for fetching AgentInstance configuration."""

import grpc
from ai.stigmer.agentic.agentinstance.v1 import query_pb2_grpc
from ai.stigmer.agentic.agentinstance.v1.api_pb2 import AgentInstance
from ai.stigmer.agentic.agentinstance.v1.io_pb2 import AgentInstanceId
from worker.config import Config
from grpc_client.auth.client_interceptor import AuthClientInterceptor


class AgentInstanceClient:
    """Client for interacting with AgentInstanceQueryService."""
    
    def __init__(self, api_key: str):
        """
        Initialize AgentInstance client with authentication.
        
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
        
        self.stub = query_pb2_grpc.AgentInstanceQueryServiceStub(self.channel)
    
    async def get(self, agent_instance_id: str) -> AgentInstance:
        """Fetch agent instance by ID."""
        if not agent_instance_id:
            raise ValueError("agent_instance_id cannot be empty")
        request = AgentInstanceId(value=agent_instance_id)
        return await self.stub.get(request)
