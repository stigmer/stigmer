"""Wire-shape tests for TokenClient (``client.tokens``).

Each test injects a fake stub that captures the outgoing request proto and
returns a canned response or raises a gRPC error, the pattern the other
handwritten clients' tests use (tests/test_billing.py). They pin that an
empty org or user id is refused before any request goes out, that the
request carries the organization and the person, that the result's
``expires_at`` is computed from ``expires_in`` at call time, and that a
server refusal surfaces as a :class:`StigmerError`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import grpc
import pytest

from ai.stigmer.iam.token.v1 import token_pb2

from stigmer import MintUserTokenResult, StigmerClient
from stigmer._gen._errors import ErrorCode, StigmerError


class _FakeRpcError(grpc.RpcError):
    """Minimal grpc.RpcError double carrying a status code and details."""

    def __init__(self, code: grpc.StatusCode, details: str) -> None:
        self._code = code
        self._details = details

    def code(self) -> grpc.StatusCode:
        return self._code

    def details(self) -> str:
        return self._details


class _CapturingTokenStub:
    def __init__(self) -> None:
        self.requests: list[token_pb2.MintUserTokenRequest] = []
        self.error: grpc.RpcError | None = None

    def mintUserToken(  # noqa: N802 — proto RPC name
        self, req: token_pb2.MintUserTokenRequest
    ) -> token_pb2.MintUserTokenResponse:
        self.requests.append(req)
        if self.error is not None:
            raise self.error
        return token_pb2.MintUserTokenResponse(
            access_token="minted-jwt", token_type="Bearer", expires_in=900
        )


@pytest.fixture()
def client():
    with StigmerClient("test-key", base_url="localhost:7234", insecure=True) as c:
        yield c


@pytest.fixture()
def stub(client: StigmerClient) -> _CapturingTokenStub:
    fake = _CapturingTokenStub()
    client.tokens._stub = fake
    return fake


class TestMintUserTokenValidation:
    def test_empty_org_is_refused_before_any_request(
        self, client: StigmerClient, stub: _CapturingTokenStub
    ) -> None:
        with pytest.raises(StigmerError, match="org is required") as exc_info:
            client.tokens.mint_user_token(org="", user_id="user-123")
        assert exc_info.value.code == ErrorCode.INVALID_ARGUMENT
        assert exc_info.value.grpc_code == grpc.StatusCode.INVALID_ARGUMENT
        assert stub.requests == []

    def test_empty_user_id_is_refused_before_any_request(
        self, client: StigmerClient, stub: _CapturingTokenStub
    ) -> None:
        with pytest.raises(StigmerError, match="user_id is required") as exc_info:
            client.tokens.mint_user_token(org="acme", user_id="")
        assert exc_info.value.code == ErrorCode.INVALID_ARGUMENT
        assert stub.requests == []


class TestMintUserTokenWire:
    def test_request_carries_org_and_person(
        self, client: StigmerClient, stub: _CapturingTokenStub
    ) -> None:
        client.tokens.mint_user_token(
            org="acme",
            user_id="user-123",
            user_email="jane@acme.com",
            user_name="Jane Doe",
        )

        [req] = stub.requests
        assert req.org == "acme"
        assert req.user_id == "user-123"
        assert req.user_email == "jane@acme.com"
        assert req.user_name == "Jane Doe"

    def test_omitted_profile_fields_are_sent_empty(
        self, client: StigmerClient, stub: _CapturingTokenStub
    ) -> None:
        client.tokens.mint_user_token(org="acme", user_id="user-123")

        [req] = stub.requests
        assert req.user_email == ""
        assert req.user_name == ""

    def test_result_maps_response_and_computes_expiry(
        self, client: StigmerClient, stub: _CapturingTokenStub
    ) -> None:
        before = datetime.now(timezone.utc).replace(microsecond=0)
        result = client.tokens.mint_user_token(org="acme", user_id="user-123")
        after = datetime.now(timezone.utc)

        assert isinstance(result, MintUserTokenResult)
        assert result.access_token == "minted-jwt"
        assert result.token_type == "Bearer"
        assert result.expires_in == 900
        assert before + timedelta(seconds=900) <= result.expires_at
        assert result.expires_at <= after + timedelta(seconds=900)

    def test_server_refusal_surfaces_as_stigmer_error(
        self, client: StigmerClient, stub: _CapturingTokenStub
    ) -> None:
        stub.error = _FakeRpcError(
            grpc.StatusCode.PERMISSION_DENIED,
            "unauthorized to mint user tokens for this organization",
        )

        with pytest.raises(StigmerError, match="unauthorized to mint") as exc_info:
            client.tokens.mint_user_token(org="acme", user_id="user-123")
        assert exc_info.value.code == ErrorCode.PERMISSION_DENIED
