"""gRPC client for fetching Agent configuration."""

from __future__ import annotations

import grpc
from ai.stigmer.agentic.agent.v1 import query_pb2_grpc
from ai.stigmer.agentic.agent.v1.api_pb2 import Agent
from ai.stigmer.agentic.agent.v1.io_pb2 import AgentId

from stigmer_runner.grpc_client.auth.client_interceptor import AuthClientInterceptor
from stigmer_runner.grpc_client.channel import create_channel
from stigmer_runner.worker.config import Config

_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class AgentClient:
    """Client for interacting with AgentQueryController."""
    
    def __init__(
        self,
        token: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """
        Initialize Agent client with authentication.
        
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
        
        self.stub = query_pb2_grpc.AgentQueryControllerStub(self.channel)
        self._timeout = timeout
    
    async def get(self, agent_id: str) -> Agent:
        """Fetch agent by ID."""
        if not agent_id:
            raise ValueError("agent_id cannot be empty")
        request = AgentId(value=agent_id)
        return await self.stub.get(request, timeout=self._timeout)
