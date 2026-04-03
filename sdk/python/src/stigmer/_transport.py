"""gRPC channel factory for the Stigmer SDK."""

from __future__ import annotations

import grpc

from ._interceptors import AuthInterceptor

DEFAULT_TARGET = "api.stigmer.ai:443"


def create_channel(
    target: str,
    api_key: str,
    *,
    insecure: bool = False,
) -> grpc.Channel:
    """Create a gRPC channel with auth interceptors applied.

    Args:
        target: gRPC target address (``host:port``).
        api_key: Stigmer API key used for ``Authorization: Bearer`` metadata.
        insecure: When ``True``, skip TLS. Use only for local development.

    Returns:
        A ``grpc.Channel`` ready for use by resource clients.
    """
    if insecure:
        channel = grpc.insecure_channel(target)
    else:
        channel = grpc.secure_channel(target, grpc.ssl_channel_credentials())

    return grpc.intercept_channel(channel, AuthInterceptor(api_key))
