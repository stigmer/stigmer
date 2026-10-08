"""GitHub sign-in and repository reads for the Stigmer SDK.

The OAuth exchange saves the token as the github.com login in the caller's
My vault and returns only the account it belongs to. Repository listing,
search, branches, trees and file reads go through the server, which uses
that saved login, so no caller ever holds the token.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from ai.stigmer.platform.github.v1 import io_pb2
from ai.stigmer.platform.github.v1 import query_pb2_grpc
from ai.stigmer.platform.github.v1 import service_pb2
from ai.stigmer.platform.github.v1 import service_pb2_grpc

from ._gen._errors import wrap_error


@dataclass
class GetOAuthAuthorizeUrlParams:
    """Parameters for initiating the GitHub OAuth flow.

    ``org`` is the organization whose My vault will keep the login; the
    caller must be a member of it, and the exchange names the same one.
    """

    redirect_uri: str
    org: str


@dataclass
class OAuthAuthorizeUrlResponse:
    """Response containing the GitHub OAuth authorize URL and CSRF state."""

    authorize_url: str
    state: str


@dataclass
class ExchangeOAuthCodeParams:
    """Parameters for exchanging a GitHub OAuth authorization code.

    ``org`` is the organization whose My vault keeps the login.
    """

    code: str
    state: str
    redirect_uri: str
    org: str


@dataclass
class GitHubConnectedAccount:
    """The GitHub account a saved login belongs to."""

    login: str
    token_type: str
    scope: str


@dataclass
class GitHubRepoParams:
    """A repository read through the caller's saved github.com login."""

    org: str
    owner: str
    repo: str


class GitHubClient:
    """GitHub sign-in and server-side repository reads."""

    def __init__(self, channel: grpc.Channel) -> None:
        self._stub = service_pb2_grpc.GitHubServiceStub(channel)
        self._query = query_pb2_grpc.GitHubQueryControllerStub(channel)

    def get_oauth_authorize_url(
        self, params: GetOAuthAuthorizeUrlParams
    ) -> OAuthAuthorizeUrlResponse:
        """Get the GitHub OAuth authorize URL to redirect the user to."""
        req = service_pb2.GetOAuthAuthorizeUrlRequest(
            redirect_uri=params.redirect_uri,
            org=params.org,
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
    ) -> GitHubConnectedAccount:
        """Exchange an OAuth code; the server saves the login in My vault."""
        req = service_pb2.ExchangeOAuthCodeRequest(
            code=params.code,
            state=params.state,
            redirect_uri=params.redirect_uri,
            org=params.org,
        )
        try:
            resp = self._stub.exchangeOAuthCode(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

        return GitHubConnectedAccount(
            login=resp.login,
            token_type=resp.token_type,
            scope=resp.scope,
        )

    def list_repositories(self, org: str, page: int) -> io_pb2.GitHubRepositoryList:
        """One page (from 1) of the connected account's repositories."""
        try:
            return self._query.listRepositories(
                io_pb2.ListGitHubRepositoriesInput(org=org, page=page)
            )
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def search_repositories(
        self, org: str, query: str, page: int
    ) -> io_pb2.GitHubRepositoryList:
        """One page (from 1) of the connected account's repositories matching a search."""
        try:
            return self._query.searchRepositories(
                io_pb2.SearchGitHubRepositoriesInput(org=org, query=query, page=page)
            )
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def list_branches(self, params: GitHubRepoParams) -> list[str]:
        """A repository's branch names."""
        try:
            resp = self._query.listBranches(
                io_pb2.ListGitHubBranchesInput(
                    org=params.org, owner=params.owner, repo=params.repo
                )
            )
        except grpc.RpcError as e:
            raise wrap_error(e) from e
        return list(resp.names)

    def get_tree(self, params: GitHubRepoParams, ref: str) -> io_pb2.GitHubTree:
        """Every file and directory of a repository at a branch or commit."""
        try:
            return self._query.getTree(
                io_pb2.GetGitHubTreeInput(
                    org=params.org, owner=params.owner, repo=params.repo, ref=ref
                )
            )
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def get_file_content(
        self, params: GitHubRepoParams, ref: str, path: str
    ) -> io_pb2.GitHubFileContent:
        """One file at a branch or commit; above 10 MiB it is ``too_large`` with no content."""
        try:
            return self._query.getFileContent(
                io_pb2.GetGitHubFileContentInput(
                    org=params.org,
                    owner=params.owner,
                    repo=params.repo,
                    ref=ref,
                    path=path,
                )
            )
        except grpc.RpcError as e:
            raise wrap_error(e) from e
