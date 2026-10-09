"""Wire-shape tests for GitHubClient.

A fake stub captures the outgoing request proto, and each test asserts the
SDK params reached the right fields, the organization above all, since the
server refuses a connect or a read that names none.  The repository reads
also hand back the server's answer as it came, and a refusal (the "connect
GitHub first" precondition) reaches the caller as a StigmerError carrying
its code.  Same pattern as test_billing.py.
"""

from __future__ import annotations

import grpc
import pytest

from ai.stigmer.platform.github.v1 import io_pb2, service_pb2

from stigmer import StigmerClient
from stigmer._gen._errors import ErrorCode, StigmerError
from stigmer._github import (
    ExchangeOAuthCodeParams,
    GetOAuthAuthorizeUrlParams,
    GitHubRepoParams,
)


class _CapturingServiceStub:
    def __init__(self) -> None:
        self.authorize_in = None
        self.exchange_in = None

    def getOAuthAuthorizeUrl(self, req):  # noqa: N802 — proto RPC name
        self.authorize_in = req
        return service_pb2.GetOAuthAuthorizeUrlResponse(
            authorize_url="https://github.com/login/oauth/authorize?state=s1",
            state="s1",
        )

    def exchangeOAuthCode(self, req):  # noqa: N802 — proto RPC name
        self.exchange_in = req
        return service_pb2.ExchangeOAuthCodeResponse(
            login="octocat", token_type="bearer", scope="repo"
        )


class _FakeRpcError(grpc.RpcError):
    """Minimal grpc.RpcError double carrying a status code and details."""

    def __init__(self, code: grpc.StatusCode, details: str) -> None:
        self._code = code
        self._details = details

    def code(self) -> grpc.StatusCode:
        return self._code

    def details(self) -> str:
        return self._details


class _CapturingQueryStub:
    """Captures each repository read and answers it, or refuses every call."""

    def __init__(self, refuse: bool = False) -> None:
        self.refuse = refuse
        self.list_in = None
        self.search_in = None
        self.branches_in = None
        self.tree_in = None
        self.file_in = None

    def _check(self) -> None:
        if self.refuse:
            raise _FakeRpcError(
                grpc.StatusCode.FAILED_PRECONDITION, "connect GitHub first"
            )

    def listRepositories(self, req):  # noqa: N802 — proto RPC name
        self._check()
        self.list_in = req
        return io_pb2.GitHubRepositoryList(
            repositories=[
                io_pb2.GitHubRepository(
                    id=42,
                    full_name="acme/app",
                    name="app",
                    owner="acme",
                    owner_is_organization=True,
                    html_url="https://github.com/acme/app",
                    clone_url="https://github.com/acme/app.git",
                    default_branch="main",
                    is_private=True,
                    updated_at="2026-10-01T12:00:00Z",
                )
            ],
            has_more=True,
        )

    def searchRepositories(self, req):  # noqa: N802 — proto RPC name
        self._check()
        self.search_in = req
        return io_pb2.GitHubRepositoryList(
            repositories=[
                io_pb2.GitHubRepository(
                    full_name="acme/app-api", name="app-api", owner="acme"
                )
            ],
        )

    def listBranches(self, req):  # noqa: N802 — proto RPC name
        self._check()
        self.branches_in = req
        return io_pb2.GitHubBranchList(names=["main", "dev"])

    def getTree(self, req):  # noqa: N802 — proto RPC name
        self._check()
        self.tree_in = req
        return io_pb2.GitHubTree(
            entries=[
                io_pb2.GitHubTreeEntry(path="src", is_directory=True),
                io_pb2.GitHubTreeEntry(path="src/main.py", size=120),
            ],
            truncated=True,
        )

    def getFileContent(self, req):  # noqa: N802 — proto RPC name
        self._check()
        self.file_in = req
        if req.path == "big.bin":
            return io_pb2.GitHubFileContent(size=11 << 20, too_large=True)
        return io_pb2.GitHubFileContent(content=b"hello", size=5)


_APP = GitHubRepoParams(org="acme", owner="acme", repo="app")


@pytest.fixture()
def client():
    with StigmerClient("test-key", base_url="localhost:7234", insecure=True) as c:
        yield c


class TestGitHubSignIn:
    def test_authorize_url_sends_org_and_redirect(self, client: StigmerClient) -> None:
        fake = _CapturingServiceStub()
        client.github._stub = fake

        resp = client.github.get_oauth_authorize_url(
            GetOAuthAuthorizeUrlParams(
                redirect_uri="https://app.example/callback", org="acme"
            )
        )
        assert resp.state == "s1"

        req = fake.authorize_in
        assert req.org == "acme"
        assert req.redirect_uri == "https://app.example/callback"

    def test_exchange_sends_org(self, client: StigmerClient) -> None:
        fake = _CapturingServiceStub()
        client.github._stub = fake

        account = client.github.exchange_oauth_code(
            ExchangeOAuthCodeParams(
                code="c1",
                state="s1",
                redirect_uri="https://app.example/callback",
                org="acme",
            )
        )
        assert account.login == "octocat"

        req = fake.exchange_in
        assert req.org == "acme"
        assert req.code == "c1"
        assert req.state == "s1"


class TestGitHubRepositoryReads:
    def test_list_repositories_sends_org_and_page(self, client: StigmerClient) -> None:
        fake = _CapturingQueryStub()
        client.github._query = fake

        result = client.github.list_repositories("acme", 2)

        req = fake.list_in
        assert req.org == "acme"
        assert req.page == 2
        assert result.has_more is True
        assert len(result.repositories) == 1
        repo = result.repositories[0]
        assert repo.id == 42
        assert repo.full_name == "acme/app"
        assert repo.name == "app"
        assert repo.owner == "acme"
        assert repo.owner_is_organization is True
        assert repo.html_url == "https://github.com/acme/app"
        assert repo.clone_url == "https://github.com/acme/app.git"
        assert repo.default_branch == "main"
        assert repo.is_private is True
        assert repo.updated_at == "2026-10-01T12:00:00Z"

    def test_search_repositories_sends_org_query_and_page(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingQueryStub()
        client.github._query = fake

        result = client.github.search_repositories("acme", "app", 3)

        req = fake.search_in
        assert req.org == "acme"
        assert req.query == "app"
        assert req.page == 3
        assert result.has_more is False
        assert [r.full_name for r in result.repositories] == ["acme/app-api"]

    def test_list_branches_sends_org_owner_and_repo(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingQueryStub()
        client.github._query = fake

        names = client.github.list_branches(_APP)

        req = fake.branches_in
        assert (req.org, req.owner, req.repo) == ("acme", "acme", "app")
        # A plain list, not the proto's repeated container.
        assert names == ["main", "dev"]
        assert type(names) is list

    def test_get_tree_sends_repo_and_ref(self, client: StigmerClient) -> None:
        fake = _CapturingQueryStub()
        client.github._query = fake

        tree = client.github.get_tree(_APP, "dev")

        req = fake.tree_in
        assert (req.org, req.owner, req.repo, req.ref) == ("acme", "acme", "app", "dev")
        assert tree.truncated is True
        assert [(e.path, e.is_directory, e.size) for e in tree.entries] == [
            ("src", True, 0),
            ("src/main.py", False, 120),
        ]

    def test_get_file_content_sends_repo_ref_and_path(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingQueryStub()
        client.github._query = fake

        file = client.github.get_file_content(_APP, "main", "README.md")

        req = fake.file_in
        assert (req.org, req.owner, req.repo, req.ref, req.path) == (
            "acme",
            "acme",
            "app",
            "main",
            "README.md",
        )
        assert file.content == b"hello"
        assert file.size == 5
        assert file.too_large is False

    def test_get_file_content_too_large_has_no_content(
        self, client: StigmerClient
    ) -> None:
        client.github._query = _CapturingQueryStub()

        file = client.github.get_file_content(_APP, "main", "big.bin")

        assert file.too_large is True
        assert file.content == b""
        assert file.size == 11 << 20

    @pytest.mark.parametrize(
        "read",
        [
            lambda gh: gh.list_repositories("acme", 1),
            lambda gh: gh.search_repositories("acme", "q", 1),
            lambda gh: gh.list_branches(_APP),
            lambda gh: gh.get_tree(_APP, "main"),
            lambda gh: gh.get_file_content(_APP, "main", "a"),
        ],
        ids=[
            "list_repositories",
            "search_repositories",
            "list_branches",
            "get_tree",
            "get_file_content",
        ],
    )
    def test_refusal_surfaces_as_stigmer_error(
        self, client: StigmerClient, read
    ) -> None:
        client.github._query = _CapturingQueryStub(refuse=True)

        with pytest.raises(StigmerError) as exc_info:
            read(client.github)

        assert exc_info.value.code == ErrorCode.FAILED_PRECONDITION
        assert str(exc_info.value) == "connect GitHub first"
