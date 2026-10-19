"""File client with size-routed uploads.

The File kind's binding of the transfer lane skills already push over
(``_skill.py``). The transport caps a whole request at 10 MiB, so content at
or below the skills' inline threshold travels in the ``upload`` request
itself, and larger content is PUT to the short-lived URL
``create_upload_url`` mints and then uploaded by its reference. Callers hand
over the content and get the File back.

Trade-offs:

- The content is bytes or a binary file object. A file object is sent to
  the upload URL in blocks as it is read, so a large file is never held in
  memory; only content small enough to travel inline is read whole, because
  the inline request carries the bytes.
- The PUT carries no Authorization header: the URL is the credential. For
  the same reason no error names it, since a bucket's URL holds its
  signature in the query and the server's own lane holds its token in the
  path. A bucket's XML rejection is cut down to its Code and Message, the
  parts that never restate the signed request.

Every generated method is inherited; ``upload`` itself also routes, so a
request built with large inline data is staged instead of refused by the
transport.
"""

from __future__ import annotations

import io
import os
import re
import urllib.error
import urllib.request
from typing import BinaryIO, Union

import grpc

from ai.stigmer.agentic.file.v1 import api_pb2, io_pb2

from ._gen._errors import ErrorCode, StigmerError
from ._gen._file import FileClient
from ._skill import MAX_INLINE_ARTIFACT_BYTES

FileContent = Union[bytes, bytearray, memoryview, BinaryIO]
"""A file's bytes: in memory, or a binary file object read as it is sent."""

_MAX_REJECTION_DETAIL = 512
_READ_BLOCK = 64 * 1024


class RoutedFileClient(FileClient):
    """File operations, with uploads routed by content size."""

    def upload(self, input: io_pb2.UploadFileInput) -> api_pb2.File:
        """Upload a File from a built request.

        Inline ``data`` above the threshold is staged and uploaded by
        reference; any other request is sent as it is.
        """
        if input.WhichOneof("source") == "data" and len(input.data) > MAX_INLINE_ARTIFACT_BYTES:
            target = io_pb2.UploadFileInput(
                org=input.org,
                session_id=input.session_id,
                filename=input.filename,
                mime_type=input.mime_type,
            )
            return self._upload_staged(target, io.BytesIO(input.data), len(input.data))
        return super().upload(input)

    def upload_file(
        self,
        *,
        org: str,
        filename: str,
        content: FileContent,
        session_id: str = "",
        mime_type: str = "",
        size: int | None = None,
    ) -> api_pb2.File:
        """Upload a File, routing its content by size (see module docs).

        Args:
            org: Organization the File belongs to, by id or slug; with
                ``session_id``, the conversation's organization.
            filename: The file's name: at most 255 characters, with no
                ``/``, ``\\`` or control characters.
            content: The bytes, or a binary file object read from its
                current position. A file object is not closed.
            session_id: The conversation to upload the File into. Empty
                uploads a File of your own.
            mime_type: The media type (``"image/png"``). Empty takes it from
                the filename's extension.
            size: The content's length in bytes. Needed only for a stream
                that can report it neither by ``fileno`` nor by seeking.
        """
        target = io_pb2.UploadFileInput(
            org=org, session_id=session_id, filename=filename, mime_type=mime_type
        )
        if isinstance(content, (bytes, bytearray, memoryview)):
            data = bytes(content)
            if len(data) > MAX_INLINE_ARTIFACT_BYTES:
                return self._upload_staged(target, io.BytesIO(data), len(data))
            target.data = data
            return super().upload(target)

        length = size if size is not None else _stream_length(content)
        if length < 0:
            raise ValueError(f"stigmer: size is {length}; it must not be negative")
        if length > MAX_INLINE_ARTIFACT_BYTES:
            return self._upload_staged(target, content, length)
        data = _read_up_to(content, length + 1)
        if len(data) != length:
            raise ValueError(f"stigmer: file content does not match its size ({length} bytes)")
        target.data = data
        return super().upload(target)

    def _upload_staged(
        self, target: io_pb2.UploadFileInput, content: BinaryIO, size: int
    ) -> api_pb2.File:
        """create_upload_url -> PUT the bytes -> upload(upload_ref)."""
        minted = super().create_upload_url(
            io_pb2.CreateFileUploadUrlInput(
                org=target.org, session_id=target.session_id, size_bytes=size
            )
        )
        _put_content(minted.url, content, size)
        # Content longer than its size would leave a File that silently lost
        # its tail; one more byte answers whether there was more.
        if content.read(1):
            raise ValueError(f"stigmer: file content is longer than its size ({size} bytes)")
        target.upload_ref = minted.upload_ref
        return super().upload(target)


def _stream_length(content: BinaryIO) -> int:
    """The bytes left in a file object: by fstat where it has a descriptor,
    else by seeking to its end and back."""
    try:
        return os.fstat(content.fileno()).st_size - content.tell()
    except (AttributeError, OSError, io.UnsupportedOperation):
        pass
    try:
        if content.seekable():
            position = content.tell()
            end = content.seek(0, io.SEEK_END)
            content.seek(position)
            return end - position
    except (AttributeError, OSError, io.UnsupportedOperation):
        pass
    raise ValueError(
        "stigmer: the content's length cannot be read from the stream; pass size="
    )


def _read_up_to(content: BinaryIO, limit: int) -> bytes:
    """Read until ``limit`` bytes or the end, whichever comes first."""
    chunks: list[bytes] = []
    remaining = limit
    while remaining > 0:
        chunk = content.read(min(remaining, _READ_BLOCK))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


class _ExactBody:
    """Exactly ``size`` bytes of a file object, read as http.client sends
    them. Running out early raises, since the Content-Length already
    promised the rest and the receiver would wait for it."""

    def __init__(self, content: BinaryIO, size: int) -> None:
        self._content = content
        self._remaining = size

    def read(self, n: int = -1) -> bytes:
        if self._remaining == 0:
            return b""
        want = self._remaining if n < 0 else min(n, self._remaining)
        chunk = self._content.read(want)
        if not chunk:
            raise ValueError("stigmer: file content is shorter than its size")
        self._remaining -= len(chunk)
        return chunk


def _put_content(url: str, content: BinaryIO, size: int) -> None:
    """PUT exactly ``size`` bytes to the upload URL, with no auth header; on a
    bucket the Content-Length is signed into the URL."""
    request = urllib.request.Request(
        url,
        data=_ExactBody(content, size),
        method="PUT",
        headers={"Content-Type": "application/octet-stream", "Content-Length": str(size)},
    )
    try:
        with urllib.request.urlopen(request):
            pass
    except urllib.error.HTTPError as err:
        body = err.read(64 * 1024).decode("utf-8", errors="replace")
        detail = _redact_url(_rejection_detail(body), url)
        # Not chained: the HTTPError carries the URL.
        raise StigmerError(
            ErrorCode.UNKNOWN,
            f"file upload rejected with HTTP {err.code}" + (f": {detail}" if detail else ""),
            grpc.StatusCode.UNKNOWN,
        ) from None
    except urllib.error.URLError as err:
        reason = err.reason
        raise StigmerError(
            ErrorCode.UNAVAILABLE,
            f"file upload failed: {_redact_url(str(reason), url)}",
            grpc.StatusCode.UNAVAILABLE,
        ) from (reason if isinstance(reason, BaseException) else None)


_XML_CODE = re.compile(r"<Code>([^<]*)</Code>")
_XML_MESSAGE = re.compile(r"<Message>([^<]*)</Message>")


def _rejection_detail(body: str) -> str:
    """The part of a rejection body worth showing. A bucket answers XML whose
    other elements can restate the signed request, so only its Code and
    Message are kept; the server's own lane answers plain text."""
    text = body.strip()
    if not text.startswith("<"):
        return text[:_MAX_REJECTION_DETAIL]
    parts = [
        match.group(1).strip()
        for match in (_XML_CODE.search(text), _XML_MESSAGE.search(text))
        if match is not None and match.group(1).strip()
    ]
    return ": ".join(parts)[:_MAX_REJECTION_DETAIL]


def _redact_url(text: str, url: str) -> str:
    """Remove the URL, and its query on its own, from text that echoes either."""
    secrets = [url]
    _, _, query = url.partition("?")
    if query:
        secrets.append(query)
    for secret in secrets:
        text = text.replace(secret, "[redacted]")
    return text
