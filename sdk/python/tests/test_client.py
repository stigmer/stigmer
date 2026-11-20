"""StigmerClient construction: the execution target, and when a client may
connect without a key.

The key rule is the Go SDK's: only a plain-text (insecure) connection, which
is a local server's, may go without a credential, and then the client sends
no ``authorization`` header at all. A keyless TLS client and an empty key
(an unset variable read as "") are refused at construction. The header
tests serve a real gRPC server on a free local port, so they read what
reaches the wire rather than what the client meant to send.
"""

from __future__ import annotations

from concurrent import futures

import grpc
import pytest

from ai.stigmer.agentic.skill.v1 import io_pb2, query_pb2_grpc

from stigmer import StigmerClient


class TestStigmerClientExecutionTarget:
    """Tests for the execution_target constructor parameter."""

    def test_local_target(self) -> None:
        with StigmerClient(
            "test-key", base_url="localhost:7234", insecure=True, execution_target="local"
        ) as client:
            assert client.default_execution_target == 1  # EXECUTION_TARGET_LOCAL

    def test_cloud_target(self) -> None:
        with StigmerClient(
            "test-key", base_url="localhost:7234", insecure=True, execution_target="cloud"
        ) as client:
            assert client.default_execution_target == 2  # EXECUTION_TARGET_CLOUD

    def test_no_target_defaults_to_unspecified(self) -> None:
        with StigmerClient(
            "test-key", base_url="localhost:7234", insecure=True
        ) as client:
            assert client.default_execution_target == 0  # EXECUTION_TARGET_UNSPECIFIED

    def test_missing_api_key_raises(self) -> None:
        with pytest.raises(ValueError, match="API key is required"):
            StigmerClient(
                "", base_url="localhost:7234", insecure=True, execution_target="local"
            )


class _HeaderRecorder(query_pb2_grpc.SkillQueryControllerServicer):
    """Records the metadata of every call it serves."""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def getArtifact(self, request, context):  # noqa: N802 - proto rpc name
        self.calls.append({k: v for k, v in context.invocation_metadata()})
        return io_pb2.GetArtifactResponse(artifact=b"ok")


@pytest.fixture()
def recorder():
    servicer = _HeaderRecorder()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
    query_pb2_grpc.add_SkillQueryControllerServicer_to_server(servicer, server)
    port = server.add_insecure_port("localhost:0")
    server.start()
    yield servicer, f"localhost:{port}"
    server.stop(grace=None)


def _one_call(client: StigmerClient) -> None:
    stub = query_pb2_grpc.SkillQueryControllerStub(client._channel)
    stub.getArtifact(io_pb2.GetArtifactRequest(artifact_storage_key="k"))


class TestKeylessLocalConnection:
    """A local server started by ``stigmer up`` needs no key."""

    def test_keyless_insecure_client_sends_no_authorization_header(self, recorder) -> None:
        servicer, target = recorder
        with StigmerClient(base_url=target, insecure=True) as client:
            _one_call(client)
        assert len(servicer.calls) == 1
        assert "authorization" not in servicer.calls[0]

    def test_keyed_client_sends_the_bearer_header(self, recorder) -> None:
        servicer, target = recorder
        with StigmerClient("stk_test_key", base_url=target, insecure=True) as client:
            _one_call(client)
        assert servicer.calls[0]["authorization"] == "Bearer stk_test_key"

    def test_keyless_tls_client_is_refused_naming_the_fix(self) -> None:
        with pytest.raises(ValueError, match="insecure=True for a local server"):
            StigmerClient(base_url="api.stigmer.ai:443")

    def test_empty_key_is_refused_even_on_an_insecure_connection(self) -> None:
        with pytest.raises(ValueError, match="the key given is empty"):
            StigmerClient("", base_url="localhost:7234", insecure=True)


class TestTokenProvider:
    """``get_access_token`` acts as one of a product's users: asked per call."""

    def test_the_provider_is_asked_on_every_call(self, recorder) -> None:
        servicer, target = recorder
        tokens = iter(["first-token", "second-token"])
        with StigmerClient(
            get_access_token=lambda: next(tokens), base_url=target, insecure=True
        ) as client:
            _one_call(client)
            _one_call(client)
        assert [call["authorization"] for call in servicer.calls] == [
            "Bearer first-token",
            "Bearer second-token",
        ]

    def test_a_provider_alone_is_enough_on_a_tls_connection(self) -> None:
        # Construction only: nothing is dialled until a call.
        client = StigmerClient(get_access_token=lambda: "tok", base_url="api.stigmer.ai:443")
        client.close()

    def test_a_key_and_a_provider_together_are_refused(self) -> None:
        with pytest.raises(ValueError, match="not both"):
            StigmerClient("stk_key", get_access_token=lambda: "tok", base_url="localhost:1", insecure=True)

    def test_the_provider_error_reaches_the_caller_and_nothing_is_sent(self, recorder) -> None:
        servicer, target = recorder

        def refuse() -> str:
            raise RuntimeError("mint refused")

        with StigmerClient(get_access_token=refuse, base_url=target, insecure=True) as client:
            with pytest.raises(RuntimeError, match="mint refused"):
                _one_call(client)
        assert servicer.calls == []

    def test_an_empty_token_is_refused_naming_the_provider(self, recorder) -> None:
        servicer, target = recorder
        with StigmerClient(get_access_token=lambda: "", base_url=target, insecure=True) as client:
            with pytest.raises(ValueError, match="get_access_token returned no token"):
                _one_call(client)
        assert servicer.calls == []
