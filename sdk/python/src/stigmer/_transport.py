"""gRPC channel factory for the Stigmer SDK."""

from __future__ import annotations

from typing import Callable

import grpc

from ._interceptors import AuthInterceptor

DEFAULT_TARGET = "api.stigmer.ai:443"

# Raise the client's receive cap to the server's own 10MB message limit
# (stigmer#702). grpc's default is 4MB — an invisible library default BELOW
# the platform's documented behavior, so responses the server would happily
# serve (e.g. a 4-10MB skill get_artifact) died client-side with
# "received message larger than max". The server stays the single limiting
# authority.
_MAX_RECV_MSG_SIZE = 10 * 1024 * 1024

_CHANNEL_OPTIONS = [
    ("grpc.max_receive_message_length", _MAX_RECV_MSG_SIZE),
]


def create_channel(
    target: str,
    api_key: str | None,
    *,
    insecure: bool = False,
    get_access_token: Callable[[], str] | None = None,
) -> grpc.Channel:
    """Create a gRPC channel with auth interceptors applied.

    Args:
        target: gRPC target address (``host:port``).
        api_key: Stigmer API key used for ``Authorization: Bearer`` metadata.
            ``None`` sends no ``authorization`` header unless
            ``get_access_token`` is given; the caller allows neither only on
            an insecure (local) connection.
        insecure: When ``True``, skip TLS. Use only for local development.
        get_access_token: Called on every call for the bearer token, in place
            of a fixed ``api_key`` (never both).

    Returns:
        A ``grpc.Channel`` ready for use by resource clients.
    """
    if api_key is not None and get_access_token is not None:
        raise ValueError("stigmer: pass api_key or get_access_token, not both")
    if insecure:
        channel = grpc.insecure_channel(target, options=_CHANNEL_OPTIONS)
    else:
        channel = grpc.secure_channel(
            target, grpc.ssl_channel_credentials(), options=_CHANNEL_OPTIONS
        )

    if get_access_token is not None:
        return grpc.intercept_channel(channel, AuthInterceptor(get_access_token))
    if api_key is None:
        return channel
    key = api_key
    return grpc.intercept_channel(channel, AuthInterceptor(lambda: key))
