"""Pins for RoutedFileClient's size-routed upload, the File twin of
test_skill_routing.py. A fake command stub captures the outgoing protos; a
loopback HTTP server plays the upload URL, so each staged test sees the PUT
as a server does. Pins: inline at or below the threshold, staged above it
with the exact bytes and Content-Length and no Authorization header, the
size read from a file object, a stream sent as it is read rather than read
whole, ``upload`` itself routing large inline data, content that disagrees
with its size refused, a rejected PUT reported without the URL or its
query, and ``StigmerClient.files`` being the routed client."""

from __future__ import annotations

import contextlib
import email.message
import http.server
import io
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import grpc
import pytest

from ai.stigmer.agentic.file.v1 import api_pb2, io_pb2

from stigmer import MAX_INLINE_ARTIFACT_BYTES, RoutedFileClient, StigmerClient, StigmerError


class _FakeCommandStub:
    """Captures upload and mint calls; the minted URL is set per test."""

    def __init__(self, mint_url: str = "http://unused.invalid/") -> None:
        self.uploads: list[io_pb2.UploadFileInput] = []
        self.mints: list[io_pb2.CreateFileUploadUrlInput] = []
        self.mint_url = mint_url

    def upload(self, request: io_pb2.UploadFileInput) -> api_pb2.File:
        self.uploads.append(request)
        return api_pb2.File()

    def createUploadUrl(  # noqa: N802 - proto rpc name
        self, request: io_pb2.CreateFileUploadUrlInput
    ) -> io_pb2.FileUploadUrl:
        self.mints.append(request)
        return io_pb2.FileUploadUrl(url=self.mint_url, upload_ref="fup_t", ttl_seconds=900)


def _client(stub: _FakeCommandStub) -> RoutedFileClient:
    client = RoutedFileClient(grpc.insecure_channel("localhost:1"))
    client._command = stub  # the same seam test_skill_routing.py uses
    return client


@dataclass
class _Received:
    method: str = ""
    path: str = ""
    content_length: str | None = None
    authorization: str | None = None
    body: bytes = b""


@dataclass
class _UploadServer:
    base_url: str
    received: list[_Received] = field(default_factory=list)


@contextlib.contextmanager
def _serve(
    status: int = 200,
    body: bytes = b"",
    on_first_byte: threading.Event | None = None,
) -> Iterator[_UploadServer]:
    received: list[_Received] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_PUT(self) -> None:  # noqa: N802 - http.server hook
            length = int(self.headers.get("Content-Length", "0"))
            first = self.rfile.read(1) if length else b""
            if on_first_byte is not None:
                on_first_byte.set()
            rest = self.rfile.read(length - len(first)) if length else b""
            received.append(
                _Received(
                    method="PUT",
                    path=self.path,
                    content_length=self.headers.get("Content-Length"),
                    authorization=self.headers.get("Authorization"),
                    body=first + rest,
                )
            )
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return None

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield _UploadServer(f"http://127.0.0.1:{server.server_address[1]}", received)
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def upload_server() -> Iterator[_UploadServer]:
    with _serve() as server:
        yield server


def _patterned(n: int) -> bytes:
    return bytes(range(251)) * (n // 251) + bytes(range(n % 251))


def test_content_at_threshold_stays_inline() -> None:
    stub = _FakeCommandStub()
    content = _patterned(MAX_INLINE_ARTIFACT_BYTES)

    _client(stub).upload_file(
        org="acme", session_id="ses_1", filename="a.bin", mime_type="image/png", content=content
    )

    assert stub.mints == []
    sent = stub.uploads[0]
    assert sent.WhichOneof("source") == "data"
    assert sent.data == content
    assert (sent.org, sent.session_id, sent.filename, sent.mime_type) == (
        "acme",
        "ses_1",
        "a.bin",
        "image/png",
    )


def test_content_above_threshold_is_staged_exactly_without_auth(
    upload_server: _UploadServer,
) -> None:
    stub = _FakeCommandStub(f"{upload_server.base_url}/v1/file-uploads/fup_t?sig=s3cret")
    content = _patterned(MAX_INLINE_ARTIFACT_BYTES + 1)

    _client(stub).upload_file(org="acme", session_id="ses_1", filename="big.bin", content=content)

    assert len(stub.mints) == 1
    assert (stub.mints[0].org, stub.mints[0].session_id, stub.mints[0].size_bytes) == (
        "acme",
        "ses_1",
        len(content),
    )
    put = upload_server.received[0]
    assert put.path == "/v1/file-uploads/fup_t?sig=s3cret"
    assert put.content_length == str(len(content))
    assert put.authorization is None
    assert put.body == content
    sent = stub.uploads[0]
    assert sent.WhichOneof("source") == "upload_ref"
    assert sent.upload_ref == "fup_t"
    assert (sent.filename, sent.session_id) == ("big.bin", "ses_1")


def test_file_object_size_comes_from_the_file(
    upload_server: _UploadServer, tmp_path: Path
) -> None:
    stub = _FakeCommandStub(f"{upload_server.base_url}/u")
    content = _patterned(MAX_INLINE_ARTIFACT_BYTES + 4096)
    path = tmp_path / "ledger.xlsx"
    path.write_bytes(content)

    with path.open("rb") as handle:
        _client(stub).upload_file(org="acme", filename="ledger.xlsx", content=handle)

    assert stub.mints[0].size_bytes == len(content)
    assert upload_server.received[0].content_length == str(len(content))
    assert upload_server.received[0].body == content


def test_small_file_object_goes_inline_from_its_position(tmp_path: Path) -> None:
    stub = _FakeCommandStub()
    path = tmp_path / "notes.txt"
    path.write_bytes(b"skip:hello")

    with path.open("rb") as handle:
        handle.read(5)
        _client(stub).upload_file(org="acme", filename="notes.txt", content=handle)

    assert stub.uploads[0].data == b"hello"


class _GatedStream(io.RawIOBase):
    """Hands out its first half, then waits for the server's first byte: an
    uploader that read the stream whole before sending would never get it,
    so the read fails instead of hanging. Not seekable, so its size is
    given."""

    def __init__(self, data: bytes, released: threading.Event) -> None:
        self._data = data
        self._pos = 0
        self._released = released

    def readable(self) -> bool:
        return True

    def read(self, size: int = -1) -> bytes:
        half = len(self._data) // 2
        if self._pos >= half and not self._released.wait(timeout=10):
            raise AssertionError("the stream was read past its first half before any byte was sent")
        end = len(self._data) if size < 0 else self._pos + size
        if self._pos < half:
            end = min(end, half)
        chunk = self._data[self._pos : end]
        self._pos += len(chunk)
        return chunk


def test_stream_is_sent_as_it_is_read() -> None:
    released = threading.Event()
    content = _patterned(MAX_INLINE_ARTIFACT_BYTES + 1)
    with _serve(on_first_byte=released) as server:
        stub = _FakeCommandStub(f"{server.base_url}/u")

        _client(stub).upload_file(
            org="acme",
            filename="big.bin",
            content=_GatedStream(content, released),
            size=len(content),
        )

        assert server.received[0].body == content
        assert stub.uploads[0].upload_ref == "fup_t"


def test_upload_with_large_inline_data_is_staged(upload_server: _UploadServer) -> None:
    stub = _FakeCommandStub(f"{upload_server.base_url}/u")
    data = _patterned(MAX_INLINE_ARTIFACT_BYTES + 1)

    _client(stub).upload(
        io_pb2.UploadFileInput(org="acme", filename="big.csv", mime_type="text/csv", data=data)
    )

    assert upload_server.received[0].body == data
    sent = stub.uploads[0]
    assert sent.upload_ref == "fup_t"
    assert (sent.filename, sent.mime_type) == ("big.csv", "text/csv")


@pytest.mark.parametrize(
    ("actual", "declared"),
    [
        (10, 5),
        (5, 10),
        (MAX_INLINE_ARTIFACT_BYTES + 2, MAX_INLINE_ARTIFACT_BYTES + 1),
        (MAX_INLINE_ARTIFACT_BYTES + 1, MAX_INLINE_ARTIFACT_BYTES + 2),
    ],
)
def test_content_disagreeing_with_size_is_refused(
    upload_server: _UploadServer, actual: int, declared: int
) -> None:
    stub = _FakeCommandStub(f"{upload_server.base_url}/u")

    with pytest.raises(ValueError, match="size"):
        _client(stub).upload_file(
            org="acme", filename="x.bin", content=io.BytesIO(_patterned(actual)), size=declared
        )
    assert stub.uploads == []


def test_rejected_put_names_neither_url_nor_query() -> None:
    xml = (
        b"<Error><Code>SignatureDoesNotMatch</Code><Message>The signature does not match.</Message>"
        b"<CanonicalRequest>PUT /b/k X-Amz-Credential=AKIDEXAMPLE&amp;X-Amz-Signature=s3cret"
        b"</CanonicalRequest></Error>"
    )
    with _serve(status=403, body=xml) as server:
        stub = _FakeCommandStub(
            f"{server.base_url}/b/k?X-Amz-Credential=AKIDEXAMPLE&X-Amz-Signature=s3cret"
        )

        with pytest.raises(StigmerError) as caught:
            _client(stub).upload_file(
                org="acme", filename="big.bin", content=_patterned(MAX_INLINE_ARTIFACT_BYTES + 1)
            )

        assert str(caught.value) == (
            "file upload rejected with HTTP 403: SignatureDoesNotMatch: The signature does not match."
        )
        assert caught.value.__cause__ is None
        assert stub.uploads == []


def test_plain_rejection_echoing_the_url_is_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "http://stage.invalid/u/fup_t?token=s3cret"
    stub = _FakeCommandStub(url)
    echo = f"no slot at {url}; query token=s3cret".encode()

    def echoing_urlopen(request: urllib.request.Request) -> None:
        raise urllib.error.HTTPError(
            request.full_url, 404, "Not Found", email.message.Message(), io.BytesIO(echo)
        )

    monkeypatch.setattr(urllib.request, "urlopen", echoing_urlopen)

    with pytest.raises(StigmerError) as caught:
        _client(stub).upload_file(
            org="acme", filename="big.bin", content=_patterned(MAX_INLINE_ARTIFACT_BYTES + 1)
        )

    message = str(caught.value)
    assert message.startswith("file upload rejected with HTTP 404: ")
    assert "s3cret" not in message
    assert "stage.invalid" not in message


def test_unreachable_url_is_not_named() -> None:
    with _serve() as server:
        url = f"{server.base_url}/u?sig=s3cret"
    stub = _FakeCommandStub(url)

    with pytest.raises(StigmerError) as caught:
        _client(stub).upload_file(
            org="acme", filename="big.bin", content=_patterned(MAX_INLINE_ARTIFACT_BYTES + 1)
        )

    assert "s3cret" not in str(caught.value)
    assert stub.uploads == []


def test_client_files_is_the_routed_client() -> None:
    with StigmerClient("sk_test", base_url="localhost:1", insecure=True) as client:
        assert isinstance(client.files, RoutedFileClient)
