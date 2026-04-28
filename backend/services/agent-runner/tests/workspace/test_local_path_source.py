"""Tests for the local-path workspace source handler."""

from __future__ import annotations

import os

import pytest

from stigmer_runner.worker.workspace.provisioner import SourceType, WorkspaceProvisionError
from stigmer_runner.worker.workspace.sources import local_path as local_path_source

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


# ---------------------------------------------------------------------------
# Multi-entry symlink creation
# ---------------------------------------------------------------------------


class TestMultiEntrySymlink:
    """When target_subdir and backend_root_dir are provided, a symlink is
    created inside the session directory so the FilesystemBackend can
    reach the local path via entry-relative paths."""

    def test_symlink_created(self, tmp_path):
        workspace_dir = tmp_path / "project"
        workspace_dir.mkdir()
        session_dir = tmp_path / "session"
        session_dir.mkdir()
        source = _MockLocalPathSource(path=str(workspace_dir))

        local_path_source.provision(
            source,
            is_local_mode=True,
            target_subdir="project",
            backend_root_dir=str(session_dir),
        )

        link = session_dir / "project"
        assert link.is_symlink()
        assert os.path.realpath(str(link)) == os.path.realpath(str(workspace_dir))

    def test_symlink_idempotent(self, tmp_path):
        """Calling provision twice with the same target does not fail."""
        workspace_dir = tmp_path / "project"
        workspace_dir.mkdir()
        session_dir = tmp_path / "session"
        session_dir.mkdir()
        source = _MockLocalPathSource(path=str(workspace_dir))

        for _ in range(2):
            local_path_source.provision(
                source,
                is_local_mode=True,
                target_subdir="project",
                backend_root_dir=str(session_dir),
            )

        link = session_dir / "project"
        assert link.is_symlink()
        assert os.path.realpath(str(link)) == os.path.realpath(str(workspace_dir))

    def test_stale_symlink_replaced(self, tmp_path):
        """If a symlink exists pointing elsewhere, it is replaced."""
        workspace_dir = tmp_path / "project_new"
        workspace_dir.mkdir()
        old_target = tmp_path / "project_old"
        old_target.mkdir()
        session_dir = tmp_path / "session"
        session_dir.mkdir()

        os.symlink(str(old_target), str(session_dir / "project"))

        source = _MockLocalPathSource(path=str(workspace_dir))
        local_path_source.provision(
            source,
            is_local_mode=True,
            target_subdir="project",
            backend_root_dir=str(session_dir),
        )

        link = session_dir / "project"
        assert link.is_symlink()
        assert os.path.realpath(str(link)) == os.path.realpath(str(workspace_dir))

    def test_no_symlink_without_target_subdir(self, tmp_path):
        """Single-entry mode: no symlink is created."""
        workspace_dir = tmp_path / "project"
        workspace_dir.mkdir()
        session_dir = tmp_path / "session"
        session_dir.mkdir()
        source = _MockLocalPathSource(path=str(workspace_dir))

        local_path_source.provision(
            source,
            is_local_mode=True,
        )

        assert not (session_dir / "project").exists()

    def test_result_root_dir_unchanged(self, tmp_path):
        """Symlink creation does not alter ProvisionResult.root_dir."""
        workspace_dir = tmp_path / "project"
        workspace_dir.mkdir()
        session_dir = tmp_path / "session"
        session_dir.mkdir()
        source = _MockLocalPathSource(path=str(workspace_dir))

        result = local_path_source.provision(
            source,
            is_local_mode=True,
            target_subdir="project",
            backend_root_dir=str(session_dir),
        )

        assert result.root_dir == str(workspace_dir)

    def test_session_dir_created_if_missing(self, tmp_path):
        """backend_root_dir is created if it does not exist."""
        workspace_dir = tmp_path / "project"
        workspace_dir.mkdir()
        session_dir = tmp_path / "new_session"
        source = _MockLocalPathSource(path=str(workspace_dir))

        local_path_source.provision(
            source,
            is_local_mode=True,
            target_subdir="project",
            backend_root_dir=str(session_dir),
        )

        assert session_dir.is_dir()
        assert (session_dir / "project").is_symlink()
