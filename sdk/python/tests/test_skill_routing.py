"""Pins for RoutedSkillClient's size-routed push (stigmer#701) — mirrors
sdk/go/skill_test.go's routing pins. A fake command stub captures outgoing
protos; the staging PUT is intercepted at urllib level."""

from __future__ import annotations

import io
import urllib.error
import urllib.request

import grpc
import pytest

from ai.stigmer.agentic.skill.v1 import api_pb2, io_pb2

from stigmer import MAX_INLINE_ARTIFACT_BYTES, RoutedSkillClient, StigmerError


class _FakeCommandStub:
    """Captures push/mint calls; behavior injectable per test."""

    def __init__(self, mint_error: grpc.StatusCode | None = None) -> None:
        self.pushes: list[io_pb2.PushSkillRequest] = []
        self.mints: list[io_pb2.CreateSkillArtifactUploadUrlRequest] = []
        self._mint_error = mint_error

    def push(self, request: io_pb2.PushSkillRequest) -> api_pb2.Skill:
        self.pushes.append(request)
        return api_pb2.Skill()

    def createArtifactUploadUrl(  # noqa: N802 - proto rpc name
        self, request: io_pb2.CreateSkillArtifactUploadUrlRequest
    ) -> io_pb2.SkillArtifactUploadUrl:
        if self._mint_error is not None:
            raise _fake_rpc_error(self._mint_error)
        self.mints.append(request)
        return io_pb2.SkillArtifactUploadUrl(
            url="https://stage.example/put", artifact_upload_ref="sau_t", ttl_seconds=900
        )


def _fake_rpc_error(code: grpc.StatusCode) -> grpc.RpcError:
    class _Err(grpc.RpcError):
        def code(self) -> grpc.StatusCode:
            return code

        def details(self) -> str:
            return "fake"

    return _Err()


def _client(stub: _FakeCommandStub) -> RoutedSkillClient:
    channel = grpc.insecure_channel("localhost:1")
    client = RoutedSkillClient(channel)
    client._command = stub  # the same seam test_billing.py uses
    return client


def test_small_artifact_stays_inline(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _FakeCommandStub()
    client = _client(stub)
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda *_a, **_k: pytest.fail("no PUT for inline push")
    )

    client.push(io_pb2.PushSkillRequest(org="acme", artifact=b"x" * 1024))

    assert len(stub.mints) == 0
    assert len(stub.pushes) == 1
    assert len(stub.pushes[0].artifact) == 1024


def test_large_artifact_routes_via_upload_url(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _FakeCommandStub()
    client = _client(stub)
    put: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request):
        put["url"] = request.full_url
        put["bytes"] = len(request.data or b"")
        put["content_type"] = request.get_header("Content-type")

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *args: object) -> None:
                return None

        return _Resp()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    artifact = b"x" * (MAX_INLINE_ARTIFACT_BYTES + 1)

    client.push(io_pb2.PushSkillRequest(org="acme", artifact=artifact, tag="stable", message="big"))

    assert len(stub.mints) == 1
    assert stub.mints[0].size_bytes == len(artifact)
    assert put["url"] == "https://stage.example/put"
    assert put["bytes"] == len(artifact)
    assert put["content_type"] == "application/zip"
    assert len(stub.pushes) == 1
    assert len(stub.pushes[0].artifact) == 0
    assert stub.pushes[0].artifact_upload_ref == "sau_t"
    # The by-ref rewrite must not lose the rest of the request.
    assert stub.pushes[0].tag == "stable"
    assert stub.pushes[0].message == "big"


def test_explicit_ref_passes_through() -> None:
    stub = _FakeCommandStub()
    client = _client(stub)

    client.push(io_pb2.PushSkillRequest(org="acme", artifact_upload_ref="sau_mine"))

    assert len(stub.mints) == 0
    assert stub.pushes[0].artifact_upload_ref == "sau_mine"


def test_pre_lane_server_fails_loud() -> None:
    stub = _FakeCommandStub(mint_error=grpc.StatusCode.UNIMPLEMENTED)
    client = _client(stub)

    with pytest.raises(StigmerError, match="upgrade stigmer-server"):
        client.push(
            io_pb2.PushSkillRequest(org="acme", artifact=b"x" * (MAX_INLINE_ARTIFACT_BYTES + 1))
        )
    assert len(stub.pushes) == 0


def test_failed_staging_put_surfaces_body_and_never_pushes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = _FakeCommandStub()
    client = _client(stub)

    def rejecting_urlopen(request: urllib.request.Request):
        raise urllib.error.HTTPError(
            request.full_url, 404, "Not Found", None, io.BytesIO(b"staging slot expired")
        )

    monkeypatch.setattr(urllib.request, "urlopen", rejecting_urlopen)

    with pytest.raises(StigmerError, match="HTTP 404: staging slot expired"):
        client.push(
            io_pb2.PushSkillRequest(org="acme", artifact=b"x" * (MAX_INLINE_ARTIFACT_BYTES + 1))
        )
    assert len(stub.pushes) == 0
