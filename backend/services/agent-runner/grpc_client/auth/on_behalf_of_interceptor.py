"""gRPC client interceptor for on-behalf-of (OBO) impersonation.

Attaches the ``x-on-behalf-of`` header to outgoing gRPC calls so the server
treats the request as if it came from the impersonated user rather than the
machine account.  The machine account's ``authorization`` header is still
sent (via :class:`AuthClientInterceptor`); the server verifies the machine
account has ``can_impersonate`` before accepting the OBO header.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import grpc

from grpc_client.auth.client_interceptor import _ClientCallDetails

_OBO_HEADER = "x-on-behalf-of"


class OnBehalfOfInterceptor(
    grpc.aio.UnaryUnaryClientInterceptor,
    grpc.aio.UnaryStreamClientInterceptor,
    grpc.aio.StreamUnaryClientInterceptor,
    grpc.aio.StreamStreamClientInterceptor,
):
    """Injects ``x-on-behalf-of`` metadata into every outgoing gRPC call."""

    def __init__(self, identity_account_id: str) -> None:
        if not identity_account_id:
            raise ValueError("identity_account_id must not be empty for OBO interceptor")
        self._identity_account_id = identity_account_id

    def _augment_call_details(
        self,
        client_call_details: grpc.aio.ClientCallDetails,
    ) -> _ClientCallDetails:
        metadata = list(client_call_details.metadata or [])
        metadata.append((_OBO_HEADER, self._identity_account_id))
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
        return await continuation(self._augment_call_details(client_call_details), request)

    async def intercept_unary_stream(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request: Any,
    ) -> Any:
        return await continuation(self._augment_call_details(client_call_details), request)

    async def intercept_stream_unary(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        return await continuation(self._augment_call_details(client_call_details), request_iterator)

    async def intercept_stream_stream(
        self,
        continuation: Callable[[grpc.aio.ClientCallDetails, Any], Awaitable[Any]],
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        return await continuation(self._augment_call_details(client_call_details), request_iterator)
