"""Tests for LocalArtifactStorage.

Verifies correct URL construction, upload/download, and cleanup behaviour.
"""

from pathlib import Path

import pytest

from stigmer_runner.worker.storage.local import LocalArtifactStorage


class TestGetDownloadURL:
    """URL construction must produce {serve_url_base}/{key} with no extra segments."""

    def test_url_uses_key_directly(self, tmp_path: Path) -> None:
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        url = storage.get_download_url("artifacts/exec-123/result.zip")
        assert url == "http://localhost:7235/artifacts/exec-123/result.zip"

    def test_url_no_double_artifacts(self, tmp_path: Path) -> None:
        """The old bug: base URL included '/artifacts' AND get_download_url added
        another '/artifacts/' prefix, resulting in triple 'artifacts/' segments."""
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        key = "artifacts/aex-abc123/agent-drafter.zip"
        url = storage.get_download_url(key)
        # Should contain 'artifacts' exactly once in the path
        assert url.count("/artifacts/") == 1

    def test_trailing_slash_stripped_from_base(self, tmp_path: Path) -> None:
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235/",
        )
        url = storage.get_download_url("artifacts/exec-123/file.txt")
        assert url == "http://localhost:7235/artifacts/exec-123/file.txt"

    def test_docker_internal_host(self, tmp_path: Path) -> None:
        """Agent-runner inside Docker uses host.docker.internal as base."""
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://host.docker.internal:7235",
        )
        url = storage.get_download_url("artifacts/exec-456/report.pdf")
        assert url == "http://host.docker.internal:7235/artifacts/exec-456/report.pdf"

    def test_expires_in_ignored(self, tmp_path: Path) -> None:
        """Local URLs don't expire — expires_in param has no effect."""
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        url_default = storage.get_download_url("artifacts/exec/f.zip")
        url_custom = storage.get_download_url("artifacts/exec/f.zip", expires_in=60)
        assert url_default == url_custom


class TestUploadDownload:
    """Basic round-trip tests for local filesystem operations."""

    def test_upload_and_download(self, tmp_path: Path) -> None:
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        content = b"hello world"
        key = "artifacts/exec-123/test.txt"

        returned_key = storage.upload(key, content)
        assert returned_key == key

        downloaded = storage.download(key)
        assert downloaded == content

    def test_download_nonexistent_raises(self, tmp_path: Path) -> None:
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        with pytest.raises(FileNotFoundError):
            storage.download("artifacts/does-not-exist/file.zip")

    def test_exists(self, tmp_path: Path) -> None:
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        key = "artifacts/exec-123/test.txt"
        assert not storage.exists(key)

        storage.upload(key, b"data")
        assert storage.exists(key)

    def test_delete(self, tmp_path: Path) -> None:
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        key = "artifacts/exec-123/test.txt"
        storage.upload(key, b"data")
        assert storage.exists(key)

        storage.delete(key)
        assert not storage.exists(key)

    def test_delete_nonexistent_is_idempotent(self, tmp_path: Path) -> None:
        storage = LocalArtifactStorage(
            base_path=str(tmp_path),
            serve_url_base="http://localhost:7235",
        )
        storage.delete("artifacts/does-not-exist/file.zip")
