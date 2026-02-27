"""Tests for the local-path workspace source handler."""

from __future__ import annotations

import pytest

from worker.workspace.provisioner import SourceType, WorkspaceProvisionError
from worker.workspace.sources import local_path as local_path_source


# ---------------------------------------------------------------------------
# Mock proto
# ---------------------------------------------------------------------------


class _MockLocalPathSource:
    def __init__(self, path: str) -> None:
        self.path = path


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestValidPath:
    """Valid absolute directory produces a correct ProvisionResult."""

    def test_absolute_directory_succeeds(self, tmp_path):
        source = _MockLocalPathSource(path=str(tmp_path))

        result = local_path_source.provision(source, is_local_mode=True)

        assert result.source_type is SourceType.LOCAL_PATH
        assert result.root_dir == str(tmp_path)
        assert result.consumed_keys == ()
        assert result.git_metadata is None

    def test_description_includes_path(self, tmp_path):
        source = _MockLocalPathSource(path=str(tmp_path))

        result = local_path_source.provision(source, is_local_mode=True)

        assert str(tmp_path) in result.workspace_description
        assert "user's project directory" in result.workspace_description

    def test_description_warns_about_direct_access(self, tmp_path):
        source = _MockLocalPathSource(path=str(tmp_path))

        result = local_path_source.provision(source, is_local_mode=True)

        assert "immediate and persistent" in result.workspace_description


# ---------------------------------------------------------------------------
# Deployment constraint (AD-09 v3)
# ---------------------------------------------------------------------------


class TestCloudRejection:
    """LocalPathSource is rejected in cloud mode."""

    def test_cloud_mode_raises(self, tmp_path):
        source = _MockLocalPathSource(path=str(tmp_path))

        with pytest.raises(WorkspaceProvisionError, match="local mode") as exc_info:
            local_path_source.provision(source, is_local_mode=False)

        assert exc_info.value.source_type is SourceType.LOCAL_PATH

    def test_cloud_error_suggests_git_repo(self, tmp_path):
        source = _MockLocalPathSource(path=str(tmp_path))

        with pytest.raises(WorkspaceProvisionError, match="git_repo"):
            local_path_source.provision(source, is_local_mode=False)


# ---------------------------------------------------------------------------
# Path validation
# ---------------------------------------------------------------------------


class TestPathValidation:
    """Reject invalid paths with clear error messages."""

    def test_relative_path_rejected(self):
        source = _MockLocalPathSource(path="relative/path")

        with pytest.raises(WorkspaceProvisionError, match="absolute") as exc_info:
            local_path_source.provision(source, is_local_mode=True)

        assert exc_info.value.source_type is SourceType.LOCAL_PATH

    def test_nonexistent_path_rejected(self, tmp_path):
        gone = str(tmp_path / "does_not_exist")
        source = _MockLocalPathSource(path=gone)

        with pytest.raises(WorkspaceProvisionError, match="does not exist"):
            local_path_source.provision(source, is_local_mode=True)

    def test_file_not_directory_rejected(self, tmp_path):
        a_file = tmp_path / "file.txt"
        a_file.write_text("content")
        source = _MockLocalPathSource(path=str(a_file))

        with pytest.raises(WorkspaceProvisionError, match="not a directory"):
            local_path_source.provision(source, is_local_mode=True)

    def test_validation_order_cloud_check_first(self):
        """Cloud rejection happens before path validation."""
        source = _MockLocalPathSource(path="relative/and/invalid")

        with pytest.raises(WorkspaceProvisionError, match="local mode"):
            local_path_source.provision(source, is_local_mode=False)
