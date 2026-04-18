"""PlatformClient token-minting helper for platform builder backends.

This module provides a minimal, purpose-built client for minting
Stigmer-signed user JWTs. It is NOT a general-purpose Stigmer client —
use :class:`StigmerClient` with an API key for resource management.

Usage::

    from stigmer.platform_client_auth import platform_client_auth

    auth = platform_client_auth(
        base_url="api.stigmer.ai:443",
        client_id=os.environ["STIGMER_CLIENT_ID"],
        client_secret=os.environ["STIGMER_CLIENT_SECRET"],
    )

    result = auth.mint_user_token(MintUserTokenInput(
        user_id="user-123",
        user_email="jane@acme.com",
        user_name="Jane Doe",
    ))
    print(result.access_token)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import TracebackType

import grpc

from ai.stigmer.iam.platformclient.v1 import io_pb2
from ai.stigmer.iam.platformclient.v1 import token_pb2_grpc

from ._gen._errors import ErrorCode, StigmerError, wrap_error

DEFAULT_TARGET = "api.stigmer.ai:443"


@dataclass(frozen=True)
class MintUserTokenInput:
    """Input for minting a user-scoped Stigmer JWT.

    The platform builder's backend calls this with the authenticated
    user's identity. Stigmer validates the PlatformClient credentials,
    optionally JIT-provisions the user's identity account, and returns
    a signed JWT.
    """

    user_id: str
    """Platform's stable user identifier. Becomes the JWT sub claim."""

    user_email: str = ""
    """User's email address. Used for profile enrichment during JIT provisioning."""

    user_name: str = ""
    """User's display name. Used for profile enrichment during JIT provisioning."""

    org_id: str = ""
    """Organization to scope the token to. Defaults to the PlatformClient's owning org."""


@dataclass(frozen=True)
class MintUserTokenResult:
    """Result of a successful :meth:`PlatformClientAuth.mint_user_token` call.

    Pass ``access_token`` to the React SDK's ``StigmerProvider`` via the
    ``getAccessToken`` callback to authenticate browser-based API calls.
    """

    access_token: str
    """Stigmer-signed JWT for browser-based API authentication."""

    token_type: str
    """Token type. Always "Bearer"."""

    expires_in: int
    """Token lifetime in seconds from issuance."""

    expires_at: datetime
    """Absolute expiration time (UTC), computed from ``expires_in`` at call time."""


class PlatformClientAuth:
    """Mints Stigmer-signed user JWTs from a platform builder's backend.

    Use :func:`platform_client_auth` to create instances — it validates
    configuration before connecting.

    Implements the context manager protocol for clean channel shutdown::

        with platform_client_auth(...) as auth:
            result = auth.mint_user_token(...)
    """

    def __init__(
        self,
        base_url: str,
        client_id: str,
        client_secret: str,
        *,
        insecure: bool = False,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret

        if insecure:
            self._channel = grpc.insecure_channel(base_url)
        else:
            self._channel = grpc.secure_channel(
                base_url, grpc.ssl_channel_credentials()
            )

        self._token_stub = token_pb2_grpc.PlatformClientTokenControllerStub(
            self._channel
        )

    def mint_user_token(self, input: MintUserTokenInput) -> MintUserTokenResult:
        """Mint a user-scoped JWT for browser-based access to Stigmer resources.

        Args:
            input: User identity and optional org scope.

        Returns:
            The minted token with metadata.

        Raises:
            StigmerError: with code ``UNAUTHENTICATED`` if credentials are invalid.
            StigmerError: with code ``NOT_FOUND`` if the user doesn't exist and
                JIT provisioning is disabled.
            StigmerError: with code ``FAILED_PRECONDITION`` if the secret has expired.
            StigmerError: with code ``PERMISSION_DENIED`` if the origin is not allowed.
        """
        if not input.user_id:
            raise StigmerError(
                ErrorCode.INVALID_ARGUMENT,
                "mint_user_token: user_id is required — this is the platform's "
                "stable identifier for the user",
                grpc.StatusCode.INVALID_ARGUMENT,
            )

        request = io_pb2.MintUserTokenRequest(
            client_id=self._client_id,
            client_secret=self._client_secret,
            user_id=input.user_id,
            user_email=input.user_email,
            user_name=input.user_name,
            org_id=input.org_id,
        )

        try:
            response = self._token_stub.mintUserToken(request)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

        return MintUserTokenResult(
            access_token=response.access_token,
            token_type=response.token_type,
            expires_in=response.expires_in,
            expires_at=datetime.now(timezone.utc).replace(microsecond=0)
            + timedelta(seconds=response.expires_in),
        )

    def close(self) -> None:
        """Release the underlying gRPC channel."""
        if self._channel is not None:
            self._channel.close()

    def __enter__(self) -> PlatformClientAuth:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()


def platform_client_auth(
    base_url: str = DEFAULT_TARGET,
    *,
    client_id: str,
    client_secret: str,
    insecure: bool = False,
) -> PlatformClientAuth:
    """Create a PlatformClient token-minting helper.

    This is the recommended way to mint Stigmer user JWTs from a Python
    backend. The returned tokens are passed to the React SDK's
    ``StigmerProvider`` via ``getAccessToken``.

    Args:
        base_url: gRPC target address (``host:port``). Defaults to
            ``api.stigmer.ai:443``.
        client_id: PlatformClient client_id (``stgm_cid_`` prefix).
        client_secret: PlatformClient client_secret (``stgm_cs_`` prefix).
            Server-only — never expose in browser code.
        insecure: Disable TLS. Use only for local development.

    Returns:
        A :class:`PlatformClientAuth` instance.

    Raises:
        ValueError: If ``client_id`` or ``client_secret`` is empty.
    """
    if not client_id:
        raise ValueError(
            "platform_client_auth: client_id is required — find it in the "
            "Stigmer Console under IAM > Platform Clients"
        )
    if not client_secret:
        raise ValueError(
            "platform_client_auth: client_secret is required — the secret is "
            "shown once at creation time. If lost, rotate via the Console or CLI"
        )

    return PlatformClientAuth(
        base_url=base_url,
        client_id=client_id,
        client_secret=client_secret,
        insecure=insecure,
    )
