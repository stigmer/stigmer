"""Unit tests for attachment injection: zip validation and orchestration.

Tests cover:
- _validate_zip_for_extraction: safety gate for untrusted zip archives
- inject_attachments: orchestrator that writes via WorkspaceBackend
"""

import io
import logging
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from stigmer_runner.worker.activities.execute_graphton import (
    _MAX_ZIP_EXTRACTED_SIZE,
    _MAX_ZIP_FILES,
    _validate_zip_for_extraction,
    inject_attachments,
)
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend

# =============================================================================
# Helpers
# =============================================================================


def _make_zip(entries: dict[str, bytes | str]) -> bytes:
    """Build a zip archive from a mapping of {path: content}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            if isinstance(data, str):
                data = data.encode()
            zf.writestr(name, data)
    return buf.getvalue()


def _make_zip_with_sizes(entries: list[tuple[str, int]]) -> bytes:
    """Build a zip where each entry is filled with *size* zero-bytes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for name, size in entries:
            zf.writestr(name, b"\x00" * size)
    return buf.getvalue()


def _make_attachment(
    *,
    filename: str = "data.zip",
    storage_key: str = "attachments/abc/data.zip",
    mount_path: str = "",
    content_type: str = "application/zip",
    extract: bool = False,
    local_path: str = "",
) -> MagicMock:
    """Create a mock Attachment proto."""
    att = MagicMock()
    att.filename = filename
    att.storage_key = storage_key
    att.mount_path = mount_path
    att.content_type = content_type
    att.extract = extract
    att.local_path = local_path
    return att


def _make_mock_backend() -> MagicMock:
    """Create a mock WorkspaceBackend for tests that don't need real I/O."""
    backend = MagicMock()
    backend.root_dir = "/workspace"
    return backend


_logger = logging.getLogger("test.inject_attachments")


# =============================================================================
# TestValidateZipForExtraction
# =============================================================================


class TestValidateZipForExtraction:
    """Tests for _validate_zip_for_extraction — the safety gate."""

    def test_valid_zip_returns_sorted_manifest(self):
        zip_bytes = _make_zip({
            "b.txt": "beta",
            "a.txt": "alpha",
            "c.txt": "charlie",
        })

        result = _validate_zip_for_extraction(zip_bytes, "test.zip", _logger)

        assert len(result) == 3
        paths = [r[0] for r in result]
        assert paths == ["a.txt", "b.txt", "c.txt"]

    def test_nested_paths_preserved(self):
        zip_bytes = _make_zip({
            "src/main.py": "print('hi')",
            "README.md": "# Hello",
            "src/lib/util.py": "pass",
        })

        result = _validate_zip_for_extraction(zip_bytes, "project.zip", _logger)
        paths = [r[0] for r in result]
        assert "src/main.py" in paths
        assert "src/lib/util.py" in paths
        assert "README.md" in paths

    def test_sizes_match_uncompressed(self):
        content_a = "hello world"
        content_b = "x" * 500
        zip_bytes = _make_zip({"a.txt": content_a, "b.txt": content_b})

        result = _validate_zip_for_extraction(zip_bytes, "test.zip", _logger)
        sizes = {name: size for name, size in result}
        assert sizes["a.txt"] == len(content_a.encode())
        assert sizes["b.txt"] == len(content_b.encode())

    def test_directory_entries_excluded(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.mkdir("empty_dir/")
            zf.writestr("file.txt", "content")
        zip_bytes = buf.getvalue()

        result = _validate_zip_for_extraction(zip_bytes, "test.zip", _logger)
        assert len(result) == 1
        assert result[0][0] == "file.txt"

    def test_invalid_zip_raises(self):
        with pytest.raises(ValueError, match="not a valid zip archive"):
            _validate_zip_for_extraction(b"not-a-zip", "bad.zip", _logger)

    def test_empty_zip_raises(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.mkdir("empty_dir/")
        zip_bytes = buf.getvalue()

        with pytest.raises(ValueError, match="empty zip archive"):
            _validate_zip_for_extraction(zip_bytes, "empty.zip", _logger)

    def test_path_traversal_absolute_forward_slash(self):
        zip_bytes = _make_zip({"/etc/passwd": "root:x:0:0"})
        with pytest.raises(ValueError, match="absolute path"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_path_traversal_absolute_backslash(self):
        zip_bytes = _make_zip({"\\windows\\system32\\evil.dll": "payload"})
        with pytest.raises(ValueError, match="absolute path"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_path_traversal_dot_dot(self):
        zip_bytes = _make_zip({"../../etc/passwd": "root:x:0:0"})
        with pytest.raises(ValueError, match="path traversal"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_path_traversal_sneaky_dot_dot(self):
        zip_bytes = _make_zip({"foo/../../etc/passwd": "root:x:0:0"})
        with pytest.raises(ValueError, match="path traversal"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_zip_bomb_too_many_files(self):
        entries = {f"file_{i:04d}.txt": "x" for i in range(_MAX_ZIP_FILES + 1)}
        zip_bytes = _make_zip(entries)
        with pytest.raises(ValueError, match=f"limit: {_MAX_ZIP_FILES}"):
            _validate_zip_for_extraction(zip_bytes, "bomb.zip", _logger)

    def test_zip_bomb_too_large_uncompressed(self):
        over_limit = _MAX_ZIP_EXTRACTED_SIZE + 1
        zip_bytes = _make_zip_with_sizes([("big.bin", over_limit)])
        with pytest.raises(ValueError, match="limit: 100 MB"):
            _validate_zip_for_extraction(zip_bytes, "bomb.zip", _logger)

    def test_at_limit_file_count_passes(self):
        entries = {f"f{i}.txt": "x" for i in range(_MAX_ZIP_FILES)}
        zip_bytes = _make_zip(entries)
        result = _validate_zip_for_extraction(zip_bytes, "ok.zip", _logger)
        assert len(result) == _MAX_ZIP_FILES


# =============================================================================
# TestInjectAttachments — with LocalWorkspaceBackend (real filesystem)
# =============================================================================


class TestInjectAttachmentsLocal:
    """Test inject_attachments with a real LocalWorkspaceBackend."""

    @pytest.mark.asyncio
    async def test_empty_list_returns_empty(self):
        result = await inject_attachments(
            backend=_make_mock_backend(),
            attachments=[],
            storage=MagicMock(),
            logger=_logger,
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_missing_storage_key_raises(self):
        att = _make_attachment(storage_key="")
        with pytest.raises(ValueError, match="missing storage_key"):
            await inject_attachments(
                backend=_make_mock_backend(),
                attachments=[att],
                storage=MagicMock(),
                logger=_logger,
            )

    @pytest.mark.asyncio
    async def test_single_file(self, tmp_path: Path):
        content = b"hello world"
        att = _make_attachment(
            filename="config.yaml",
            storage_key="attachments/abc/config.yaml",
            content_type="application/x-yaml",
        )
        storage = MagicMock()
        storage.download.return_value = content

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        assert len(result) == 1
        assert result[0]["filename"] == "config.yaml"
        assert result[0]["path"] == ".stigmer/inputs/config.yaml"
        assert result[0]["size"] == len(content)
        assert (tmp_path / ".stigmer" / "inputs" / "config.yaml").read_bytes() == content

    @pytest.mark.asyncio
    async def test_custom_mount_path(self, tmp_path: Path):
        content = b"data"
        att = _make_attachment(
            filename="data.csv",
            mount_path="/workspace/data/input.csv",
        )
        storage = MagicMock()
        storage.download.return_value = content

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        assert result[0]["path"] == "workspace/data/input.csv"
        assert (tmp_path / "workspace" / "data" / "input.csv").read_bytes() == content

    @pytest.mark.asyncio
    async def test_zip_extract(self, tmp_path: Path):
        zip_bytes = _make_zip({
            "main.py": "print('hello')",
            "lib/util.py": "pass",
        })
        att = _make_attachment(
            filename="project.zip",
            mount_path="inputs/project/",
            extract=True,
        )
        storage = MagicMock()
        storage.download.return_value = zip_bytes

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        assert len(result) == 2
        paths = {r["path"] for r in result}
        assert "inputs/project/lib/util.py" in paths
        assert "inputs/project/main.py" in paths

        assert (tmp_path / "inputs" / "project" / "main.py").read_text() == "print('hello')"
        assert (tmp_path / "inputs" / "project" / "lib" / "util.py").read_text() == "pass"

    @pytest.mark.asyncio
    async def test_zip_extract_returns_basenames(self, tmp_path: Path):
        zip_bytes = _make_zip({"src/deep/module.py": "x = 1"})
        att = _make_attachment(
            filename="code.zip",
            mount_path="inputs/code/",
            extract=True,
        )
        storage = MagicMock()
        storage.download.return_value = zip_bytes

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        assert result[0]["filename"] == "module.py"
        assert result[0]["path"] == "inputs/code/src/deep/module.py"

    @pytest.mark.asyncio
    async def test_mixed_regular_and_zip(self, tmp_path: Path):
        regular_content = b"standalone"
        zip_bytes = _make_zip({"nested.txt": "extracted"})

        att_regular = _make_attachment(
            filename="standalone.txt",
            storage_key="attachments/abc/standalone.txt",
            content_type="text/plain",
        )
        att_zip = _make_attachment(
            filename="archive.zip",
            storage_key="attachments/def/archive.zip",
            mount_path="inputs/archive/",
            extract=True,
        )
        storage = MagicMock()
        storage.download.side_effect = [regular_content, zip_bytes]

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = await inject_attachments(
            backend=backend,
            attachments=[att_regular, att_zip],
            storage=storage,
            logger=_logger,
        )

        assert len(result) == 2
        filenames = {r["filename"] for r in result}
        assert "standalone.txt" in filenames
        assert "nested.txt" in filenames
        assert (tmp_path / ".stigmer" / "inputs" / "standalone.txt").read_bytes() == regular_content
        assert (tmp_path / "inputs" / "archive" / "nested.txt").read_text() == "extracted"

    @pytest.mark.asyncio
    async def test_zip_extract_invalid_zip_raises(self, tmp_path: Path):
        att = _make_attachment(
            filename="bad.zip",
            mount_path="inputs/bad/",
            extract=True,
        )
        storage = MagicMock()
        storage.download.return_value = b"not-a-zip-file"

        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        with pytest.raises(ValueError, match="not a valid zip archive"):
            await inject_attachments(
                backend=backend,
                attachments=[att],
                storage=storage,
                logger=_logger,
            )


# =============================================================================
# TestInjectAttachments — with mock WorkspaceBackend
# =============================================================================


class TestInjectAttachmentsMockBackend:
    """Test inject_attachments with a mocked WorkspaceBackend."""

    @pytest.mark.asyncio
    async def test_write_files_called_with_correct_paths(self):
        content = b"file-content"
        att = _make_attachment(filename="input.txt")
        storage = MagicMock()
        storage.download.return_value = content

        backend = _make_mock_backend()
        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        assert len(result) == 1
        assert result[0]["path"] == ".stigmer/inputs/input.txt"
        assert result[0]["size"] == len(content)

        backend.write_files.assert_called_once()
        files_written = backend.write_files.call_args[0][0]
        assert len(files_written) == 1
        assert files_written[0] == (".stigmer/inputs/input.txt", content)

    @pytest.mark.asyncio
    async def test_zip_extract_writes_extracted_files(self):
        zip_bytes = _make_zip({"file.txt": "content"})
        att = _make_attachment(
            filename="project.zip",
            mount_path="inputs/project/",
            extract=True,
        )
        storage = MagicMock()
        storage.download.return_value = zip_bytes

        backend = _make_mock_backend()
        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        assert len(result) == 1
        assert result[0]["filename"] == "file.txt"

        backend.write_files.assert_called_once()
        files_written = backend.write_files.call_args[0][0]
        paths_written = [p for p, _ in files_written]
        assert "inputs/project/file.txt" in paths_written

    @pytest.mark.asyncio
    async def test_write_failure_propagates(self):
        content = b"data"
        att = _make_attachment(filename="file.txt")
        storage = MagicMock()
        storage.download.return_value = content

        backend = _make_mock_backend()
        backend.write_files.side_effect = RuntimeError("Write failed")

        with pytest.raises(RuntimeError, match="Write failed"):
            await inject_attachments(
                backend=backend,
                attachments=[att],
                storage=storage,
                logger=_logger,
            )


# =============================================================================
# TestInjectAttachments — local_path fast path
# =============================================================================


class TestInjectAttachmentsLocalPath:
    """Test the allow_local_path optimisation in inject_attachments."""

    @pytest.mark.asyncio
    async def test_local_path_reads_from_disk(self, tmp_path: Path):
        """When allow_local_path=True and the file exists, storage is skipped."""
        source_file = tmp_path / "source" / "config.yaml"
        source_file.parent.mkdir()
        source_file.write_bytes(b"local-content")

        att = _make_attachment(
            filename="config.yaml",
            local_path=str(source_file),
        )
        storage = MagicMock()

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        backend = LocalWorkspaceBackend(root_dir=workspace)

        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
            allow_local_path=True,
        )

        assert len(result) == 1
        assert result[0]["filename"] == "config.yaml"
        assert result[0]["size"] == len(b"local-content")
        written = (workspace / ".stigmer" / "inputs" / "config.yaml")
        assert written.read_bytes() == b"local-content"
        storage.download.assert_not_called()

    @pytest.mark.asyncio
    async def test_local_path_missing_falls_back_to_storage(self, tmp_path: Path):
        """If local_path points to a non-existent file, falls back to storage."""
        att = _make_attachment(
            filename="missing.txt",
            local_path="/no/such/file.txt",
        )
        storage = MagicMock()
        storage.download.return_value = b"from-storage"

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        backend = LocalWorkspaceBackend(root_dir=workspace)

        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
            allow_local_path=True,
        )

        assert len(result) == 1
        assert result[0]["size"] == len(b"from-storage")
        storage.download.assert_called_once_with(att.storage_key)

    @pytest.mark.asyncio
    async def test_allow_local_path_false_ignores_local_path(self, tmp_path: Path):
        """When allow_local_path=False (cloud mode), local_path is not used."""
        source_file = tmp_path / "source" / "data.csv"
        source_file.parent.mkdir()
        source_file.write_bytes(b"local-data")

        att = _make_attachment(
            filename="data.csv",
            local_path=str(source_file),
        )
        storage = MagicMock()
        storage.download.return_value = b"storage-data"

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        backend = LocalWorkspaceBackend(root_dir=workspace)

        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
            allow_local_path=False,
        )

        assert result[0]["size"] == len(b"storage-data")
        storage.download.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_local_path_uses_storage(self):
        """Backward compat: attachments without local_path use storage."""
        att = _make_attachment(filename="old.txt", local_path="")
        storage = MagicMock()
        storage.download.return_value = b"from-storage"

        backend = _make_mock_backend()
        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
            allow_local_path=True,
        )

        assert len(result) == 1
        storage.download.assert_called_once()

    @pytest.mark.asyncio
    async def test_local_path_with_zip_extraction(self, tmp_path: Path):
        """local_path works for zip archives with extract=True."""
        zip_bytes = _make_zip({"main.py": "print(1)", "lib/util.py": "pass"})
        source_zip = tmp_path / "source" / "project.zip"
        source_zip.parent.mkdir()
        source_zip.write_bytes(zip_bytes)

        att = _make_attachment(
            filename="project.zip",
            local_path=str(source_zip),
            mount_path="inputs/project/",
            extract=True,
        )
        storage = MagicMock()

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        backend = LocalWorkspaceBackend(root_dir=workspace)

        result = await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
            allow_local_path=True,
        )

        assert len(result) == 2
        paths = {r["path"] for r in result}
        assert "inputs/project/main.py" in paths
        assert "inputs/project/lib/util.py" in paths
        assert (workspace / "inputs" / "project" / "main.py").read_text() == "print(1)"
        storage.download.assert_not_called()

    @pytest.mark.asyncio
    async def test_default_allow_local_path_is_false(self):
        """The default for allow_local_path preserves existing behaviour."""
        att = _make_attachment(filename="f.txt")
        storage = MagicMock()
        storage.download.return_value = b"ok"

        backend = _make_mock_backend()
        await inject_attachments(
            backend=backend,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        storage.download.assert_called_once()
