"""gRPC client interceptors for the Stigmer SDK."""

from __future__ import annotations

from typing import Any, Sequence

import grpc


class _ClientCallDetails(grpc.ClientCallDetails):  # type: ignore[misc]
    """Mutable wrapper around ``grpc.ClientCallDetails``.

    The gRPC Python API provides ``ClientCallDetails`` as a read-only named
    tuple.  Interceptors that need to modify metadata must construct a new
    details object — this class serves that purpose.
    """

    def __init__(
        self,
        method: str,
        timeout: float | None,
        metadata: Sequence[tuple[str, str | bytes]] | None,
        credentials: grpc.CallCredentials | None,
        wait_for_ready: bool | None,
        compression: grpc.Compression | None,
    ) -> None:
        self.method = method
        self.timeout = timeout
        self.metadata = metadata
        self.credentials = credentials
        self.wait_for_ready = wait_for_ready
        self.compression = compression


def _with_auth_metadata(
    client_call_details: grpc.ClientCallDetails,
    bearer_value: str,
) -> _ClientCallDetails:
    """Return a copy of *client_call_details* with the auth header injected."""
    metadata = list(client_call_details.metadata or [])
    metadata.append(("authorization", bearer_value))
    return _ClientCallDetails(
        method=client_call_details.method,
        timeout=client_call_details.timeout,
        metadata=metadata,
        credentials=client_call_details.credentials,
        wait_for_ready=client_call_details.wait_for_ready,
        compression=client_call_details.compression,
    )


class AuthInterceptor(
    grpc.UnaryUnaryClientInterceptor,  # type: ignore[misc]
    grpc.UnaryStreamClientInterceptor,  # type: ignore[misc]
):
    """Injects ``Authorization: Bearer <token>`` into every outgoing call.

    Handles both unary-unary and unary-stream (server-streaming) RPCs, which
    covers all call patterns used by the Stigmer API.
    """

    def __init__(self, api_key: str) -> None:
        self._bearer = f"Bearer {api_key}"

    def intercept_unary_unary(
        self,
        continuation: Any,
        client_call_details: grpc.ClientCallDetails,
        request: Any,
    ) -> Any:
        return continuation(
            _with_auth_metadata(client_call_details, self._bearer),
            request,
        )

    def intercept_unary_stream(
        self,
        continuation: Any,
        client_call_details: grpc.ClientCallDetails,
        request: Any,
    ) -> Any:
        return continuation(
            _with_auth_metadata(client_call_details, self._bearer),
            request,
        )
