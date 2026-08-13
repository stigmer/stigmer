"""Skill client with transport-aware push routing (stigmer#675 / #701).

The gRPC transport caps messages at 10MB while skills may be up to 100MB,
so ``push`` routes by size: small artifacts travel inline in the request
(one round trip, unchanged behavior), larger ones are staged over HTTP via
``create_artifact_upload_url`` — a capability URL, so no auth header — and
pushed by reference. Callers never see the mechanics: ``push(req)`` simply
works for any valid skill size.

Every other method is the generated client's, inherited unchanged.
"""

from __future__ import annotations

import urllib.error
import urllib.request

import grpc

from ai.stigmer.agentic.skill.v1 import api_pb2, io_pb2

from ._gen._errors import ErrorCode, StigmerError, is_unimplemented
from ._gen._skill import SkillClient

# Largest artifact pushed inline in the gRPC request (#675). The server's
# transport cap is 10MB for the WHOLE message, so the artifact leaves 64KB
# of headroom for the request envelope (org, tag, provenance, framing).
# Mirrors the Go SDK's maxInlineArtifactBytes.
MAX_INLINE_ARTIFACT_BYTES = 10 * 1024 * 1024 - 64 * 1024


class RoutedSkillClient(SkillClient):
    """Skill operations, with ``push`` routed by artifact size."""

    def push(self, input: io_pb2.PushSkillRequest) -> api_pb2.Skill:
        """Push a skill, routing the artifact by size (see module docs).

        A request that already carries an ``artifact_upload_ref`` is passed
        through untouched — the caller has done its own staging.
        """
        if input.artifact_upload_ref or len(input.artifact) <= MAX_INLINE_ARTIFACT_BYTES:
            return super().push(input)
        return self._push_via_upload_url(input)

    def _push_via_upload_url(self, input: io_pb2.PushSkillRequest) -> api_pb2.Skill:
        """create_artifact_upload_url -> PUT bytes -> push(artifact_upload_ref)."""
        try:
            minted = super().create_artifact_upload_url(
                io_pb2.CreateSkillArtifactUploadUrlRequest(
                    org=input.org,
                    size_bytes=len(input.artifact),
                )
            )
        except StigmerError as err:
            if is_unimplemented(err):
                # Pre-transfer-lane server: without staging, an artifact this
                # size physically cannot travel. Say so instead of surfacing
                # the raw transport error (the failure mode #675 reported).
                raise StigmerError(
                    ErrorCode.UNKNOWN,
                    f"skill artifact is {len(input.artifact)} bytes, above the ~10MB gRPC "
                    "message cap, and this server does not support the HTTP artifact "
                    "transfer lane — upgrade stigmer-server to push skills of this size",
                    grpc.StatusCode.UNIMPLEMENTED,
                ) from err
            raise

        self._put_artifact(minted.url, bytes(input.artifact))

        # Same request, artifact traveling by reference instead of by value.
        by_ref = io_pb2.PushSkillRequest()
        by_ref.CopyFrom(input)
        by_ref.artifact = b""
        by_ref.artifact_upload_ref = minted.artifact_upload_ref
        return super().push(by_ref)

    @staticmethod
    def _put_artifact(url: str, artifact: bytes) -> None:
        """PUT the artifact ZIP to the staging URL.

        The URL is the credential (capability semantics — a pre-signed R2 URL
        on cloud, the server's own transfer lane on OSS), so no auth header
        is attached.
        """
        request = urllib.request.Request(
            url,
            data=artifact,
            method="PUT",
            headers={"Content-Type": "application/zip"},
        )
        try:
            with urllib.request.urlopen(request):
                pass
        except urllib.error.HTTPError as err:
            detail = err.read()[:512].decode("utf-8", errors="replace").strip()
            raise StigmerError(
                ErrorCode.UNKNOWN,
                f"skill artifact upload rejected with HTTP {err.code}"
                + (f": {detail}" if detail else ""),
                grpc.StatusCode.UNKNOWN,
            ) from err
