"""The token service's client: mint a short-lived user token for a person
signed in to your product, from your product's backend.

Minting is one call on the ordinary :class:`~stigmer.StigmerClient` built
with a service account's API key, the way a payments or messaging platform
lets a backend act with its server key. The account must be an admin of the
organization the token is for, or of its parent organization; a person's key
is refused. Pass the returned ``access_token`` to the React SDK's
``StigmerProvider`` through ``getAccessToken``.

The organization's embedding settings decide whether a first sign-in creates
the person's account and with which role, and which web pages may use the
token. The token lives until it expires, or until the service account that
minted it is deleted.

An empty ``org`` or ``user_id`` is refused here, before any request, so a
backend that forgot to pass the person's identity fails with a message that
names the missing field instead of a server-side validation error.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import grpc

from ai.stigmer.iam.token.v1 import token_pb2
from ai.stigmer.iam.token.v1 import token_pb2_grpc

from ._gen._errors import ErrorCode, StigmerError, wrap_error


@dataclass(frozen=True)
class MintUserTokenResult:
    """A minted user token.

    Pass ``access_token`` to the React SDK's ``StigmerProvider`` through its
    ``getAccessToken`` callback to authenticate browser-based API calls.
    """

    access_token: str
    """The token a browser sends as its Bearer credential."""

    token_type: str
    """Token type. Always "Bearer"."""

    expires_in: int
    """Token lifetime in seconds from issuance."""

    expires_at: datetime
    """Absolute expiration time (UTC), computed from ``expires_in`` at call time."""


class TokenClient:
    """Mints user tokens with the client's service-account key.

    Reached as :attr:`StigmerClient.tokens`::

        with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
            result = client.tokens.mint_user_token(
                org="acme",
                user_id=user.id,
                user_email=user.email,
                user_name=user.name,
            )
            print(result.access_token, result.expires_at)
    """

    def __init__(self, channel: grpc.Channel) -> None:
        self._stub = token_pb2_grpc.TokenServiceStub(channel)

    def mint_user_token(
        self,
        *,
        org: str,
        user_id: str,
        user_email: str | None = None,
        user_name: str | None = None,
    ) -> MintUserTokenResult:
        """Mint a user token for a person signed in to your product.

        Args:
            org: The organization the token is for, by id or slug: the
                minting service account's organization, or one of its child
                organizations.
            user_id: Your product's stable identifier for the person.
            user_email: The person's email address, used when their account
                is created.
            user_name: The person's display name, used when their account is
                created.

        Returns:
            The minted token and its lifetime.

        Raises:
            StigmerError: with code ``INVALID_ARGUMENT`` when ``org`` or
                ``user_id`` is empty.
            StigmerError: with code ``PERMISSION_DENIED`` when the client's
                key is not an admin service account's for the organization.
            StigmerError: with code ``FAILED_PRECONDITION`` when the person
                has no account and the organization's embedding settings do
                not create one.
        """
        if not org:
            raise StigmerError(
                ErrorCode.INVALID_ARGUMENT,
                "mint_user_token: org is required — the organization the "
                "token is for, by id or slug",
                grpc.StatusCode.INVALID_ARGUMENT,
            )
        if not user_id:
            raise StigmerError(
                ErrorCode.INVALID_ARGUMENT,
                "mint_user_token: user_id is required — your product's "
                "stable identifier for the person",
                grpc.StatusCode.INVALID_ARGUMENT,
            )

        request = token_pb2.MintUserTokenRequest(
            org=org,
            user_id=user_id,
            user_email=user_email or "",
            user_name=user_name or "",
        )
        try:
            response = self._stub.mintUserToken(request)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

        return MintUserTokenResult(
            access_token=response.access_token,
            token_type=response.token_type,
            expires_in=response.expires_in,
            expires_at=datetime.now(timezone.utc).replace(microsecond=0)
            + timedelta(seconds=response.expires_in),
        )
