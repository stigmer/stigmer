"""gRPC client interceptor for Stigmer auth token injection.

Attaches ``Authorization: Bearer <token>`` to every outgoing gRPC call.
The token can be either a user JWT or a platform API key (``stk_*``) —
the server's auth chain determines the credential type by content, not
by header.
"""

from collections.abc import Awaitable, Callable, Sequence
from typing import Any

import grpc


class _ClientCallDetails:
    """Custom ClientCallDetails to allow metadata modification."""

    def __init__(
        self,
        method: str,
        timeout: float | None,
        metadata: Sequence[tuple[str, str]] | None,
        credentials: grpc.CallCredentials | None,
        wait_for_ready: bool | None,
    ):
        self.method = method
        self.timeout = timeout
        self.metadata = metadata
        self.credentials = credentials
        self.wait_for_ready = wait_for_ready


class AuthClientInterceptor(
    grpc.aio.UnaryUnaryClientInterceptor,
    grpc.aio.UnaryStreamClientInterceptor,
    grpc.aio.StreamUnaryClientInterceptor,
    grpc.aio.StreamStreamClientInterceptor,
):
    """gRPC client interceptor that attaches an auth token to all requests."""

    def __init__(self, token: str):
        self._token = token

    def _augment_call_details(
        self,
        client_call_details: grpc.aio.ClientCallDetails,
    ) -> _ClientCallDetails:
        metadata = list(client_call_details.metadata or [])
        metadata.append(("authorization", f"Bearer {self._token}"))
        return _ClientCallDetails(
            method=client_call_details.method,
            timeout=client_call_details.timeout,
            metadata=tuple(metadata),
            credentials=client_call_details.credentials,
            wait_for_ready=client_call_details.wait_for_ready,
        )

    async def intercept_unary_unary(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request: Any,
    ) -> Any:
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request)

    async def intercept_unary_stream(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request: Any,
    ) -> Any:
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request)

    async def intercept_stream_unary(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request_iterator)

    async def intercept_stream_stream(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request_iterator)
