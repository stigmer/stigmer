"""Shared gRPC channel factory with keepalive and connection reuse.

This module solves two problems that cause intermittent DEADLINE_EXCEEDED errors:

1. Missing keepalive: The Go gRPC server sends keepalive PINGs every 15s and
   enforces a 5s minimum PING interval. Without matching client-side keepalive,
   idle channels can be silently closed by the server (GOAWAY), causing the next
   RPC to fail.

2. Channel churn: Each activity invocation was creating 4+ fresh channels (one
   per client class). Under concurrent activity load this means dozens of TCP
   connections to the same localhost:7234, wasting server resources and adding
   connection-setup latency. ChannelProvider lets callers share a single channel
   across all clients within an activity.
"""

from __future__ import annotations

import grpc

from stigmer_runner.grpc_client.auth.client_interceptor import AuthClientInterceptor
from stigmer_runner.worker.config import Config

# Channel options that match the Go server's keepalive configuration.
#
# Server settings (from backend/libs/go/grpc/server.go):
#   KeepaliveEnforcementPolicy: MinTime=5s, PermitWithoutStream=false
#   KeepaliveParams:            Time=15s,   Timeout=5s
#
# Client keepalive_time_ms must be >= server MinTime (5s) to avoid GOAWAY.
# We use 10s (comfortably above 5s) so the client detects dead connections
# within 10s + 5s = 15s, well under the 30s Temporal heartbeat budget.
#
# Message size: 16 MiB, raised from the 4 MiB gRPC default.  Agent
# execution status updates can legitimately exceed 4 MiB when many tool
# results accumulate (even with display-level truncation in StatusBuilder).
# 16 MiB matches common gRPC deployment practices and provides headroom
# without being dangerously permissive.
_MAX_MESSAGE_BYTES: int = 16 * 1024 * 1024

KEEPALIVE_CHANNEL_OPTIONS: list[tuple[str, int]] = [
    ("grpc.keepalive_time_ms", 10_000),
    ("grpc.keepalive_timeout_ms", 5_000),
    ("grpc.keepalive_permit_without_calls", 0),
    ("grpc.http2.max_pings_without_data", 0),
    ("grpc.max_send_message_length", _MAX_MESSAGE_BYTES),
    ("grpc.max_receive_message_length", _MAX_MESSAGE_BYTES),
]


def create_channel(
    endpoint: str,
    interceptors: list[grpc.aio.ClientInterceptor] | None = None,
) -> grpc.aio.Channel:
    """Create a gRPC async channel with keepalive options.

    Args:
        endpoint: Target address (e.g. "localhost:7234" or "api.stigmer.ai:443").
        interceptors: Optional client interceptors (e.g. auth).

    Returns:
        A configured grpc.aio channel.
    """
    interceptors = interceptors or []

    if endpoint.endswith(":443"):
        return grpc.aio.secure_channel(
            endpoint,
            grpc.ssl_channel_credentials(),
            options=KEEPALIVE_CHANNEL_OPTIONS,
            interceptors=interceptors,
        )

    return grpc.aio.insecure_channel(
        endpoint,
        options=KEEPALIVE_CHANNEL_OPTIONS,
        interceptors=interceptors,
    )


class ChannelProvider:
    """Manages a shared gRPC channel for an activity invocation.

    The channel authenticates using the user's own credential (JWT or API
    key) sent as a Bearer token.  All operations — reads, writes, status
    updates — use the same channel because the token IS the user's
    identity.  No impersonation or on-behalf-of headers are needed.

    Usage within an activity::

        provider = ChannelProvider(token)
        try:
            agent_client = AgentClient(token, channel=provider.channel)
            exec_client  = AgentExecutionClient(token, channel=provider.channel)
            # ... use clients ...
        finally:
            await provider.close()

    All clients sharing the same channel reuse a single TCP connection.
    """

    def __init__(self, token: str) -> None:
        config = Config.load_from_env()
        auth_interceptor = AuthClientInterceptor(token)
        self._channel = create_channel(
            config.stigmer_backend_endpoint,
            interceptors=[auth_interceptor],
        )

    @property
    def channel(self) -> grpc.aio.Channel:
        """The authenticated gRPC channel."""
        return self._channel

    async def close(self) -> None:
        """Close the underlying channel. Safe to call multiple times."""
        await self._channel.close()
