"""gRPC client for fetching AgentInstance configuration."""

from __future__ import annotations

import grpc
from ai.stigmer.agentic.agentinstance.v1 import query_pb2_grpc
from ai.stigmer.agentic.agentinstance.v1.api_pb2 import AgentInstance
from ai.stigmer.agentic.agentinstance.v1.io_pb2 import AgentInstanceId

from stigmer_runner.grpc_client.auth.client_interceptor import AuthClientInterceptor
from stigmer_runner.grpc_client.channel import create_channel
from stigmer_runner.worker.config import Config

_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class AgentInstanceClient:
    """Client for interacting with AgentInstanceQueryController."""
    
    def __init__(
        self,
        token: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize AgentInstance client with authentication.
        
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
        
        self.stub = query_pb2_grpc.AgentInstanceQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def get(self, agent_instance_id: str) -> AgentInstance:
        """Fetch agent instance by ID."""
        if not agent_instance_id:
            raise ValueError("agent_instance_id cannot be empty")
        request = AgentInstanceId(value=agent_instance_id)
        return await self.stub.get(request, timeout=self._timeout)
