"""GitHub repository reads for the Stigmer SDK.

GitHub is connected by the vault's sign-in at the address ``github.com``
(the vault client's ``start_sign_in`` and ``complete_sign_in``), which saves
the login in the caller's My vault. Repository listing, search, branches,
trees and file reads go through the server, which uses that saved login, so
no caller ever holds the token.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from ai.stigmer.platform.github.v1 import io_pb2
from ai.stigmer.platform.github.v1 import query_pb2_grpc

from ._gen._errors import wrap_error


@dataclass
class GitHubRepoParams:
    """A repository read through the caller's saved github.com login."""

    org: str
    owner: str
    repo: str


class GitHubClient:
    """Server-side repository reads with the caller's github.com login."""

    def __init__(self, channel: grpc.Channel) -> None:
        self._query = query_pb2_grpc.GitHubQueryControllerStub(channel)

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
