"""Unit tests for attachment injection: zip validation, extraction, and orchestration.

Tests cover the functions added for directory-attach support (T02-T04):
- _validate_zip_for_extraction: safety gate for untrusted zip archives
- _extract_zip_local: file-by-file extraction to local filesystem
- _prepare_daytona_extraction: staging zip for post-batch-upload extraction
- inject_attachments: orchestrator that routes to the correct mode
"""

import io
import logging
import sys
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from worker.activities.execute_graphton import (
    _MAX_ZIP_EXTRACTED_SIZE,
    _MAX_ZIP_FILES,
    _extract_zip_local,
    _prepare_daytona_extraction,
    _validate_zip_for_extraction,
    inject_attachments,
)

# =============================================================================
# Helpers
# =============================================================================


def _make_zip(entries: dict[str, bytes | str]) -> bytes:
    """Build a zip archive from a mapping of {path: content}.

    Content values may be ``str`` (encoded to UTF-8) or raw ``bytes``.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            if isinstance(data, str):
                data = data.encode()
            zf.writestr(name, data)
    return buf.getvalue()


def _make_zip_with_sizes(entries: list[tuple[str, int]]) -> bytes:
    """Build a zip where each entry is filled with *size* zero-bytes.

    Useful for testing zip-bomb size limits without allocating real data.
    """
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
) -> MagicMock:
    """Create a mock Attachment proto with the given fields."""
    att = MagicMock()
    att.filename = filename
    att.storage_key = storage_key
    att.mount_path = mount_path
    att.content_type = content_type
    att.extract = extract
    return att


_logger = logging.getLogger("test.inject_attachments")


@pytest.fixture()
def _fake_daytona():
    """Inject a fake ``daytona`` module so ``from daytona import FileUpload`` works.

    The module exposes a ``FileUpload`` class that records its constructor
    args as attributes (``source`` and ``destination``).
    """

    class _FakeFileUpload:
        def __init__(self, *, source, destination):
            self.source = source
            self.destination = destination

        def __repr__(self):
            return f"FileUpload(destination={self.destination!r})"

    mod = MagicMock()
    mod.FileUpload = _FakeFileUpload
    sys.modules["daytona"] = mod
    yield _FakeFileUpload
    sys.modules.pop("daytona", None)


# =============================================================================
# TestValidateZipForExtraction
# =============================================================================


class TestValidateZipForExtraction:
    """Tests for _validate_zip_for_extraction — the safety gate."""

    def test_valid_zip_returns_sorted_manifest(self):
        """Multi-file zip returns entries sorted by path."""
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
        """Entries like src/main.py are returned with full relative path."""
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
        """Returned sizes reflect the original uncompressed content."""
        content_a = "hello world"
        content_b = "x" * 500
        zip_bytes = _make_zip({"a.txt": content_a, "b.txt": content_b})

        result = _validate_zip_for_extraction(zip_bytes, "test.zip", _logger)

        sizes = {name: size for name, size in result}
        assert sizes["a.txt"] == len(content_a.encode())
        assert sizes["b.txt"] == len(content_b.encode())

    def test_directory_entries_excluded(self):
        """Directory-only entries in the zip are silently skipped."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.mkdir("empty_dir/")
            zf.writestr("file.txt", "content")
        zip_bytes = buf.getvalue()

        result = _validate_zip_for_extraction(zip_bytes, "test.zip", _logger)

        assert len(result) == 1
        assert result[0][0] == "file.txt"

    def test_invalid_zip_raises(self):
        """Random bytes that aren't a zip raise ValueError."""
        with pytest.raises(ValueError, match="not a valid zip archive"):
            _validate_zip_for_extraction(b"not-a-zip", "bad.zip", _logger)

    def test_empty_zip_raises(self):
        """A zip with only directory entries (no files) raises ValueError."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.mkdir("empty_dir/")
        zip_bytes = buf.getvalue()

        with pytest.raises(ValueError, match="empty zip archive"):
            _validate_zip_for_extraction(zip_bytes, "empty.zip", _logger)

    def test_path_traversal_absolute_forward_slash(self):
        """Absolute path starting with / is rejected."""
        zip_bytes = _make_zip({"/etc/passwd": "root:x:0:0"})

        with pytest.raises(ValueError, match="absolute path"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_path_traversal_absolute_backslash(self):
        """Absolute path starting with \\ is rejected."""
        zip_bytes = _make_zip({"\\windows\\system32\\evil.dll": "payload"})

        with pytest.raises(ValueError, match="absolute path"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_path_traversal_dot_dot(self):
        """Entry with ../../ prefix is rejected."""
        zip_bytes = _make_zip({"../../etc/passwd": "root:x:0:0"})

        with pytest.raises(ValueError, match="path traversal"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_path_traversal_sneaky_dot_dot(self):
        """Entry like foo/../../etc/passwd that escapes via normalization."""
        zip_bytes = _make_zip({"foo/../../etc/passwd": "root:x:0:0"})

        with pytest.raises(ValueError, match="path traversal"):
            _validate_zip_for_extraction(zip_bytes, "evil.zip", _logger)

    def test_zip_bomb_too_many_files(self):
        """Archive exceeding _MAX_ZIP_FILES is rejected."""
        entries = {f"file_{i:04d}.txt": "x" for i in range(_MAX_ZIP_FILES + 1)}
        zip_bytes = _make_zip(entries)

        with pytest.raises(ValueError, match=f"limit: {_MAX_ZIP_FILES}"):
            _validate_zip_for_extraction(zip_bytes, "bomb.zip", _logger)

    def test_zip_bomb_too_large_uncompressed(self):
        """Archive whose total uncompressed size exceeds the limit is rejected."""
        over_limit = _MAX_ZIP_EXTRACTED_SIZE + 1
        zip_bytes = _make_zip_with_sizes([("big.bin", over_limit)])

        with pytest.raises(ValueError, match="limit: 100 MB"):
            _validate_zip_for_extraction(zip_bytes, "bomb.zip", _logger)

    def test_at_limit_file_count_passes(self):
        """Exactly _MAX_ZIP_FILES entries should be accepted."""
        entries = {f"f{i}.txt": "x" for i in range(_MAX_ZIP_FILES)}
        zip_bytes = _make_zip(entries)

        result = _validate_zip_for_extraction(zip_bytes, "ok.zip", _logger)
        assert len(result) == _MAX_ZIP_FILES


# =============================================================================
# TestExtractZipLocal
# =============================================================================


class TestExtractZipLocal:
    """Tests for _extract_zip_local — local filesystem extraction."""

    def test_extracts_files_with_correct_content(self, tmp_path: Path):
        """Files are written to {local_root}/{mount_dir}/ with correct bytes."""
        zip_bytes = _make_zip({
            "config.yaml": "key: value",
            "data.csv": "a,b,c\n1,2,3",
        })

        _extract_zip_local(
            content=zip_bytes,
            local_root=str(tmp_path),
            mount_dir="inputs/my-project",
            attachment_filename="project.zip",
            logger=_logger,
        )

        config = tmp_path / "inputs" / "my-project" / "config.yaml"
        data = tmp_path / "inputs" / "my-project" / "data.csv"
        assert config.read_text() == "key: value"
        assert data.read_text() == "a,b,c\n1,2,3"

    def test_nested_directories_created(self, tmp_path: Path):
        """Parent directories for nested entries are created automatically."""
        zip_bytes = _make_zip({"src/lib/util.py": "pass"})

        _extract_zip_local(
            content=zip_bytes,
            local_root=str(tmp_path),
            mount_dir="inputs/project",
            attachment_filename="project.zip",
            logger=_logger,
        )

        assert (tmp_path / "inputs" / "project" / "src" / "lib" / "util.py").exists()

    def test_no_local_root_raises(self):
        """ValueError raised when local_root is None."""
        zip_bytes = _make_zip({"f.txt": "x"})

        with pytest.raises(ValueError, match="local_root required"):
            _extract_zip_local(
                content=zip_bytes,
                local_root=None,
                mount_dir="inputs/project",
                attachment_filename="test.zip",
                logger=_logger,
            )

    def test_empty_string_local_root_raises(self):
        """ValueError raised when local_root is empty string."""
        zip_bytes = _make_zip({"f.txt": "x"})

        with pytest.raises(ValueError, match="local_root required"):
            _extract_zip_local(
                content=zip_bytes,
                local_root="",
                mount_dir="inputs/project",
                attachment_filename="test.zip",
                logger=_logger,
            )


# =============================================================================
# TestPrepareDaytonaExtraction
# =============================================================================


class TestPrepareDaytonaExtraction:
    """Tests for _prepare_daytona_extraction — Daytona sandbox staging."""

    @staticmethod
    def _mock_sandbox(*, mkdir_exit_code: int = 0) -> MagicMock:
        sandbox = MagicMock()
        result = MagicMock()
        result.exit_code = mkdir_exit_code
        result.output = ""
        sandbox.process.exec.return_value = result
        return sandbox

    def test_happy_path(self):
        """Appends FileUpload and registers extract target."""
        sandbox = self._mock_sandbox()
        file_uploads: list = []
        extract_targets: list[str] = []
        mock_file_upload = MagicMock()

        _prepare_daytona_extraction(
            sandbox=sandbox,
            ws_root="/home/daytona",
            mount_dir="inputs/project",
            content=b"zip-bytes",
            attachment_filename="project.zip",
            file_uploads=file_uploads,
            extract_targets=extract_targets,
            FileUpload=mock_file_upload,
            logger=_logger,
        )

        assert len(file_uploads) == 1
        mock_file_upload.assert_called_once_with(
            source=b"zip-bytes",
            destination="/home/daytona/inputs/project/__attachment__.zip",
        )
        assert extract_targets == ["/home/daytona/inputs/project"]
        sandbox.process.exec.assert_called_once()

    def test_mkdir_failure_raises(self):
        """RuntimeError raised when mkdir -p fails."""
        sandbox = self._mock_sandbox(mkdir_exit_code=1)

        with pytest.raises(RuntimeError, match="Failed to create extraction directory"):
            _prepare_daytona_extraction(
                sandbox=sandbox,
                ws_root="/home/daytona",
                mount_dir="inputs/project",
                content=b"zip-bytes",
                attachment_filename="project.zip",
                file_uploads=[],
                extract_targets=[],
                FileUpload=MagicMock(),
                logger=_logger,
            )

    def test_no_file_upload_class_raises(self):
        """RuntimeError raised when FileUpload is None (daytona not installed)."""
        sandbox = self._mock_sandbox()

        with pytest.raises(RuntimeError, match="Daytona FileUpload not available"):
            _prepare_daytona_extraction(
                sandbox=sandbox,
                ws_root="/home/daytona",
                mount_dir="inputs/project",
                content=b"zip-bytes",
                attachment_filename="project.zip",
                file_uploads=[],
                extract_targets=[],
                FileUpload=None,
                logger=_logger,
            )


# =============================================================================
# TestInjectAttachments
# =============================================================================


class TestInjectAttachments:
    """Tests for inject_attachments — the orchestrator."""

    @pytest.mark.asyncio
    async def test_empty_list_returns_empty(self):
        """No attachments -> immediate return of empty list."""
        result = await inject_attachments(
            sandbox=None,
            attachments=[],
            storage=MagicMock(),
            logger=_logger,
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_missing_storage_key_raises(self):
        """Attachment without storage_key raises ValueError."""
        att = _make_attachment(storage_key="")

        with pytest.raises(ValueError, match="missing storage_key"):
            await inject_attachments(
                sandbox=None,
                attachments=[att],
                storage=MagicMock(),
                logger=_logger,
                local_root="/tmp/workspace",
            )

    @pytest.mark.asyncio
    async def test_single_file_local_mode(self, tmp_path: Path):
        """Regular file attachment is written to local filesystem."""
        content = b"hello world"
        att = _make_attachment(
            filename="config.yaml",
            storage_key="attachments/abc/config.yaml",
            content_type="application/x-yaml",
        )

        storage = MagicMock()
        storage.download.return_value = content

        result = await inject_attachments(
            sandbox=None,
            attachments=[att],
            storage=storage,
            logger=_logger,
            local_root=str(tmp_path),
        )

        assert len(result) == 1
        assert result[0]["filename"] == "config.yaml"
        assert result[0]["path"] == "inputs/config.yaml"
        assert result[0]["size"] == len(content)

        written = tmp_path / "inputs" / "config.yaml"
        assert written.read_bytes() == content

    @pytest.mark.asyncio
    async def test_single_file_with_custom_mount_path(self, tmp_path: Path):
        """Custom mount_path overrides the default inputs/{filename}."""
        content = b"data"
        att = _make_attachment(
            filename="data.csv",
            mount_path="/workspace/data/input.csv",
        )

        storage = MagicMock()
        storage.download.return_value = content

        result = await inject_attachments(
            sandbox=None,
            attachments=[att],
            storage=storage,
            logger=_logger,
            local_root=str(tmp_path),
        )

        assert result[0]["path"] == "workspace/data/input.csv"
        assert (tmp_path / "workspace" / "data" / "input.csv").read_bytes() == content

    @pytest.mark.asyncio
    async def test_single_file_daytona_mode(self, _fake_daytona):
        """Regular file in Daytona mode queues FileUpload with correct path."""
        content = b"file-content"
        att = _make_attachment(filename="input.txt")

        storage = MagicMock()
        storage.download.return_value = content

        sandbox = MagicMock()

        result = await inject_attachments(
            sandbox=sandbox,
            attachments=[att],
            storage=storage,
            logger=_logger,
            workspace_root="/home/daytona",
        )

        assert len(result) == 1
        assert result[0]["filename"] == "input.txt"
        assert result[0]["path"] == "inputs/input.txt"
        assert result[0]["size"] == len(content)

        sandbox.fs.upload_files.assert_called_once()
        uploads = sandbox.fs.upload_files.call_args[0][0]
        assert len(uploads) == 1
        assert uploads[0].destination == "/home/daytona/inputs/input.txt"
        assert uploads[0].source == content

    @pytest.mark.asyncio
    async def test_zip_extract_local_mode(self, tmp_path: Path):
        """Zip with extract=true extracts files and returns per-file metadata."""
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

        result = await inject_attachments(
            sandbox=None,
            attachments=[att],
            storage=storage,
            logger=_logger,
            local_root=str(tmp_path),
        )

        assert len(result) == 2
        paths = {r["path"] for r in result}
        assert "inputs/project/lib/util.py" in paths
        assert "inputs/project/main.py" in paths

        assert (tmp_path / "inputs" / "project" / "main.py").read_text() == "print('hello')"
        assert (tmp_path / "inputs" / "project" / "lib" / "util.py").read_text() == "pass"

    @pytest.mark.asyncio
    async def test_zip_extract_returns_correct_filenames(self, tmp_path: Path):
        """The 'filename' field in results is the basename, not the full path."""
        zip_bytes = _make_zip({"src/deep/module.py": "x = 1"})

        att = _make_attachment(
            filename="code.zip",
            mount_path="inputs/code/",
            extract=True,
        )

        storage = MagicMock()
        storage.download.return_value = zip_bytes

        result = await inject_attachments(
            sandbox=None,
            attachments=[att],
            storage=storage,
            logger=_logger,
            local_root=str(tmp_path),
        )

        assert result[0]["filename"] == "module.py"
        assert result[0]["path"] == "inputs/code/src/deep/module.py"

    @pytest.mark.asyncio
    async def test_zip_extract_daytona_mode(self, _fake_daytona):
        """Zip with extract=true in Daytona mode stages, uploads, and extracts."""
        zip_bytes = _make_zip({"file.txt": "content"})

        att = _make_attachment(
            filename="project.zip",
            mount_path="inputs/project/",
            extract=True,
        )

        storage = MagicMock()
        storage.download.return_value = zip_bytes

        sandbox = MagicMock()
        mkdir_result = MagicMock()
        mkdir_result.exit_code = 0
        unzip_result = MagicMock()
        unzip_result.exit_code = 0
        sandbox.process.exec.side_effect = [mkdir_result, unzip_result]

        result = await inject_attachments(
            sandbox=sandbox,
            attachments=[att],
            storage=storage,
            logger=_logger,
            workspace_root="/home/daytona",
        )

        assert len(result) == 1
        assert result[0]["filename"] == "file.txt"
        assert result[0]["path"] == "inputs/project/file.txt"

        sandbox.fs.upload_files.assert_called_once()
        uploads = sandbox.fs.upload_files.call_args[0][0]
        assert len(uploads) == 1
        assert uploads[0].destination == "/home/daytona/inputs/project/__attachment__.zip"

        exec_calls = sandbox.process.exec.call_args_list
        assert len(exec_calls) == 2
        unzip_cmd = exec_calls[1][0][0]
        assert "unzip -o __attachment__.zip" in unzip_cmd
        assert "rm __attachment__.zip" in unzip_cmd

    @pytest.mark.asyncio
    async def test_mixed_regular_and_zip_attachments(self, tmp_path: Path):
        """Both regular files and zip-extract attachments in one call."""
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

        result = await inject_attachments(
            sandbox=None,
            attachments=[att_regular, att_zip],
            storage=storage,
            logger=_logger,
            local_root=str(tmp_path),
        )

        assert len(result) == 2
        filenames = {r["filename"] for r in result}
        assert "standalone.txt" in filenames
        assert "nested.txt" in filenames

        assert (tmp_path / "inputs" / "standalone.txt").read_bytes() == regular_content
        assert (tmp_path / "inputs" / "archive" / "nested.txt").read_text() == "extracted"

    @pytest.mark.asyncio
    async def test_zip_extract_invalid_zip_raises(self, tmp_path: Path):
        """extract=true with non-zip content raises ValueError from validation."""
        att = _make_attachment(
            filename="bad.zip",
            mount_path="inputs/bad/",
            extract=True,
        )

        storage = MagicMock()
        storage.download.return_value = b"not-a-zip-file"

        with pytest.raises(ValueError, match="not a valid zip archive"):
            await inject_attachments(
                sandbox=None,
                attachments=[att],
                storage=storage,
                logger=_logger,
                local_root=str(tmp_path),
            )

    @pytest.mark.asyncio
    async def test_local_mode_no_local_root_raises(self):
        """Local mode (sandbox=None) without local_root raises ValueError."""
        att = _make_attachment(filename="file.txt")

        storage = MagicMock()
        storage.download.return_value = b"content"

        with pytest.raises(ValueError, match="local_root required"):
            await inject_attachments(
                sandbox=None,
                attachments=[att],
                storage=storage,
                logger=_logger,
            )

    @pytest.mark.asyncio
    async def test_daytona_workspace_root_from_get_work_dir(self, _fake_daytona):
        """When workspace_root is not provided, sandbox.get_work_dir() is used."""
        content = b"data"
        att = _make_attachment(filename="file.txt")

        storage = MagicMock()
        storage.download.return_value = content

        sandbox = MagicMock()
        sandbox.get_work_dir.return_value = "/custom/workspace/"

        result = await inject_attachments(
            sandbox=sandbox,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        sandbox.get_work_dir.assert_called_once()
        assert len(result) == 1
        uploads = sandbox.fs.upload_files.call_args[0][0]
        assert uploads[0].destination == "/custom/workspace/inputs/file.txt"

    @pytest.mark.asyncio
    async def test_daytona_get_work_dir_failure_fallback(self, _fake_daytona):
        """When sandbox.get_work_dir() raises, falls back to /home/daytona."""
        content = b"data"
        att = _make_attachment(filename="file.txt")

        storage = MagicMock()
        storage.download.return_value = content

        sandbox = MagicMock()
        sandbox.get_work_dir.side_effect = RuntimeError("SDK error")

        result = await inject_attachments(
            sandbox=sandbox,
            attachments=[att],
            storage=storage,
            logger=_logger,
        )

        assert len(result) == 1
        uploads = sandbox.fs.upload_files.call_args[0][0]
        assert uploads[0].destination == "/home/daytona/inputs/file.txt"

    @pytest.mark.asyncio
    async def test_daytona_unzip_failure_raises(self, _fake_daytona):
        """RuntimeError raised when the post-upload unzip command fails."""
        zip_bytes = _make_zip({"file.txt": "content"})

        att = _make_attachment(
            filename="project.zip",
            mount_path="inputs/project/",
            extract=True,
        )

        storage = MagicMock()
        storage.download.return_value = zip_bytes

        sandbox = MagicMock()
        mkdir_ok = MagicMock(exit_code=0)
        unzip_fail = MagicMock(exit_code=1, output="unzip: command not found")
        sandbox.process.exec.side_effect = [mkdir_ok, unzip_fail]

        with pytest.raises(RuntimeError, match="Failed to extract attachment"):
            await inject_attachments(
                sandbox=sandbox,
                attachments=[att],
                storage=storage,
                logger=_logger,
                workspace_root="/home/daytona",
            )
