"""GitHub OAuth client for the Stigmer SDK."""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from ai.stigmer.platform.github.v1 import service_pb2
from ai.stigmer.platform.github.v1 import service_pb2_grpc

from ._gen._errors import wrap_error


@dataclass
class GetOAuthAuthorizeUrlParams:
    """Parameters for initiating the GitHub OAuth flow."""

    redirect_uri: str


@dataclass
class OAuthAuthorizeUrlResponse:
    """Response containing the GitHub OAuth authorize URL and CSRF state."""

    authorize_url: str
    state: str


@dataclass
class ExchangeOAuthCodeParams:
    """Parameters for exchanging a GitHub OAuth authorization code."""

    code: str
    state: str
    redirect_uri: str


@dataclass
class OAuthTokenResponse:
    """Response containing the exchanged GitHub access token."""

    access_token: str
    token_type: str
    scope: str


class GitHubClient:
    """GitHub OAuth integration client.

    Provides methods to initiate the OAuth flow (get authorize URL) and
    exchange the authorization code for an access token.  The access token
    is returned to the caller — the backend never persists it.
    """

    def __init__(self, channel: grpc.Channel) -> None:
        self._stub = service_pb2_grpc.GitHubServiceStub(channel)

    def get_oauth_authorize_url(
        self, params: GetOAuthAuthorizeUrlParams
    ) -> OAuthAuthorizeUrlResponse:
        """Get the GitHub OAuth authorize URL to redirect the user to."""
        req = service_pb2.GetOAuthAuthorizeUrlRequest(
            redirect_uri=params.redirect_uri,
        )
        try:
            resp = self._stub.getOAuthAuthorizeUrl(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

        return OAuthAuthorizeUrlResponse(
            authorize_url=resp.authorize_url,
            state=resp.state,
        )

    def exchange_oauth_code(
        self, params: ExchangeOAuthCodeParams
    ) -> OAuthTokenResponse:
        """Exchange an OAuth authorization code for an access token."""
        req = service_pb2.ExchangeOAuthCodeRequest(
            code=params.code,
            state=params.state,
            redirect_uri=params.redirect_uri,
        )
        try:
            resp = self._stub.exchangeOAuthCode(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

        return OAuthTokenResponse(
            access_token=resp.access_token,
            token_type=resp.token_type,
            scope=resp.scope,
        )
