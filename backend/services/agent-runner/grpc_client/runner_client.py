"""gRPC client for Runner heartbeat reporting."""

from __future__ import annotations

import grpc
from ai.stigmer.agentic.runner.v1 import command_pb2_grpc
from ai.stigmer.agentic.runner.v1.api_pb2 import Runner
from ai.stigmer.agentic.runner.v1.io_pb2 import RunnerHeartbeatInput

from grpc_client.auth.client_interceptor import AuthClientInterceptor
from grpc_client.channel import create_channel
from worker.config import Config

_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0


class RunnerClient:
    """Client for reporting runner liveness via the heartbeat RPC.

    Used by :class:`~worker.heartbeat.HeartbeatEmitter` to send periodic
    heartbeats to the Stigmer backend.  Unlike other gRPC clients in this
    package (which are short-lived, per-activity), the heartbeat client is
    long-lived and shares a single channel for the worker's lifetime.
    """

    def __init__(
        self,
        token: str,
        *,
        timeout: float = _DEFAULT_GRPC_TIMEOUT_SECONDS,
        channel: grpc.aio.Channel | None = None,
    ):
        """Initialize Runner client with authentication.

        Args:
            token: Stigmer auth token (JWT or API key).
            timeout: Per-call gRPC deadline in seconds.
            channel: Optional shared gRPC channel. When provided, the client
                does not create or own a channel.
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

        self.stub = command_pb2_grpc.RunnerCommandControllerStub(self.channel)
        self._timeout = timeout

    async def heartbeat(self, input: RunnerHeartbeatInput) -> Runner:
        """Send a heartbeat to report runner liveness and state.

        Args:
            input: Heartbeat payload with runner ID, phase, execution count,
                and connection info.

        Returns:
            The updated Runner resource as persisted by the server.

        Raises:
            grpc.RpcError: On gRPC failures (NOT_FOUND, FAILED_PRECONDITION,
                UNAVAILABLE, etc.)
        """
        return await self.stub.heartbeat(input, timeout=self._timeout)
