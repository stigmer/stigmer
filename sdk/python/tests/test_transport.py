"""Transport pins: the channel factory must receive responses above grpc's
4MB default (stigmer#702 — the server's limit is 10MB, and an invisible
client-side library default below it refused responses the server would
happily serve)."""

from __future__ import annotations

from concurrent import futures

import grpc
import pytest

from ai.stigmer.agentic.skill.v1 import io_pb2, query_pb2_grpc

from stigmer._transport import create_channel

_FIVE_MB = 5 * 1024 * 1024


class _OversizedArtifactServicer(query_pb2_grpc.SkillQueryControllerServicer):
    """Serves a getArtifact response above the 4MB grpc default."""

    def getArtifact(self, request, context):  # noqa: N802 - proto rpc name
        return io_pb2.GetArtifactResponse(artifact=b"\xab" * _FIVE_MB)


@pytest.fixture()
def oversized_artifact_server():
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=1),
        # The server must be allowed to SEND the oversized response; the
        # subject under test is the client's receive cap.
        options=[("grpc.max_send_message_length", 10 * 1024 * 1024)],
    )
    query_pb2_grpc.add_SkillQueryControllerServicer_to_server(
        _OversizedArtifactServicer(), server
    )
    port = server.add_insecure_port("localhost:0")
    server.start()
    yield port
    server.stop(grace=None)


def test_receives_responses_above_grpc_default_cap(oversized_artifact_server):
    """A 5MB artifact response must arrive intact through create_channel
    (fails with RESOURCE_EXHAUSTED "received message larger than max"
    without the raised cap)."""
    channel = create_channel(
        f"localhost:{oversized_artifact_server}", "test-api-key", insecure=True
    )
    try:
        stub = query_pb2_grpc.SkillQueryControllerStub(channel)
        response = stub.getArtifact(
            io_pb2.GetArtifactRequest(
                artifact_storage_key="skills/org/skill/hash.zip"
            )
        )
        assert len(response.artifact) == _FIVE_MB
    finally:
        channel.close()


def test_a_key_and_a_provider_are_refused_together() -> None:
    with pytest.raises(ValueError, match="not both"):
        create_channel("localhost:1", "stk_key", insecure=True, get_access_token=lambda: "tok")


def test_a_server_streaming_call_carries_the_providers_token() -> None:
    """A session's event stream is server-streaming: it is authenticated the same way."""
    from stigmer._interceptors import AuthInterceptor

    sent: list[object] = []

    def continuation(details: grpc.ClientCallDetails, request: object) -> None:
        sent.extend(details.metadata or [])

    details = grpc.ClientCallDetails()
    details.method, details.timeout, details.metadata = "/x/y", None, None  # type: ignore[misc]
    details.credentials, details.wait_for_ready, details.compression = None, None, None  # type: ignore[misc]
    AuthInterceptor(lambda: "tok").intercept_unary_stream(continuation, details, object())
    assert sent == [("authorization", "Bearer tok")]
