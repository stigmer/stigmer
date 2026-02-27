"""Tests for WorkspaceProvisioner — dispatch logic and credential scoping."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from unittest.mock import MagicMock

import pytest

from worker.workspace.backend import ExecuteResult, WorkspaceBackend
from worker.workspace.local import LocalWorkspaceBackend
from worker.workspace.provisioner import (
    GitMetadata,
    ProvisionResult,
    SourceType,
    WorkspaceProvisionError,
    WorkspaceProvisioner,
)


# ---------------------------------------------------------------------------
# Lightweight proto mocks — duck-typed to match HasField / attribute access
# ---------------------------------------------------------------------------


class _MockWorkspaceSource:
    """Mimics the ``WorkspaceSource`` proto for dispatch testing."""

    def __init__(
        self,
        *,
        git_repo: object | None = None,
        local_path: object | None = None,
    ) -> None:
        self.git_repo = git_repo
        self.local_path = local_path

    def HasField(self, name: str) -> bool:
        if name == "git_repo":
            return self.git_repo is not None
        if name == "local_path":
            return self.local_path is not None
        return False


class _MockGitRepoSource:
    def __init__(
        self,
        url: str,
        branch: str = "",
        commit: str = "",
        depth: int | None = None,
    ) -> None:
        self.url = url
        self.branch = branch
        self.commit = commit
        self._has_depth = depth is not None
        self.depth = depth if depth is not None else 0

    def HasField(self, name: str) -> bool:
        if name == "depth":
            return self._has_depth
        return False


class _MockLocalPathSource:
    def __init__(self, path: str) -> None:
        self.path = path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_git_backend(tmp_path) -> LocalWorkspaceBackend:
    """Create a backend whose execute() succeeds for the git clone flow."""
    backend = LocalWorkspaceBackend(root_dir=tmp_path)

    original_execute = backend.execute

    def _patched_execute(command, *, cwd=None, timeout=30):
        if "test -d .git" in command:
            return ExecuteResult(exit_code=0, stdout="no\n", stderr="")
        if command.startswith("ls -A"):
            return ExecuteResult(exit_code=0, stdout="", stderr="")
        if command.startswith("git clone"):
            return ExecuteResult(exit_code=0, stdout="", stderr="")
        if "rev-parse --abbrev-ref HEAD" in command:
            return ExecuteResult(exit_code=0, stdout="main\n", stderr="")
        if "rev-parse HEAD" in command:
            return ExecuteResult(
                exit_code=0, stdout="abc1234def5678\n", stderr=""
            )
        if command.startswith("git checkout"):
            return ExecuteResult(exit_code=0, stdout="", stderr="")
        return original_execute(command, cwd=cwd, timeout=timeout)

    backend.execute = _patched_execute  # type: ignore[assignment]
    return backend


# ---------------------------------------------------------------------------
# Dispatch tests
# ---------------------------------------------------------------------------


class TestDispatchEmpty:
    """None or unset workspace_source dispatches to empty source."""

    def test_none_source(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        provisioner = WorkspaceProvisioner()
        result = provisioner.provision(None, backend, {}, is_local_mode=True)

        assert result.source_type is SourceType.EMPTY
        assert result.root_dir == backend.root_dir
        assert result.consumed_keys == ()
        assert result.git_metadata is None

    def test_source_with_no_variant_set(self, tmp_path):
        source = _MockWorkspaceSource()  # neither git_repo nor local_path
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        provisioner = WorkspaceProvisioner()
        result = provisioner.provision(source, backend, {}, is_local_mode=True)

        assert result.source_type is SourceType.EMPTY


class TestDispatchGitRepo:
    """workspace_source.git_repo dispatches to git source."""

    def test_git_repo_dispatched(self, tmp_path):
        git = _MockGitRepoSource(url="https://github.com/acme/repo.git")
        source = _MockWorkspaceSource(git_repo=git)
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_test123"}, is_local_mode=True
        )

        assert result.source_type is SourceType.GIT_REPO
        assert result.git_metadata is not None
        assert result.git_metadata.repo_url == "https://github.com/acme/repo.git"
        assert "GITHUB_TOKEN" in result.consumed_keys


class TestDispatchLocalPath:
    """workspace_source.local_path dispatches to local_path source."""

    def test_local_path_dispatched(self, tmp_path):
        local = _MockLocalPathSource(path=str(tmp_path))
        source = _MockWorkspaceSource(local_path=local)
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(
            source, backend, {}, is_local_mode=True
        )

        assert result.source_type is SourceType.LOCAL_PATH
        assert result.root_dir == str(tmp_path)

    def test_local_path_cloud_rejected(self, tmp_path):
        local = _MockLocalPathSource(path=str(tmp_path))
        source = _MockWorkspaceSource(local_path=local)
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        with pytest.raises(WorkspaceProvisionError, match="local mode"):
            provisioner.provision(
                source, backend, {}, is_local_mode=False
            )


# ---------------------------------------------------------------------------
# WORKSPACE_PROVISION_ prefix stripping (AD-05)
# ---------------------------------------------------------------------------


class TestPrefixStripping:
    """Reserved WORKSPACE_PROVISION_-prefixed keys are always consumed."""

    def test_prefix_keys_added_to_consumed(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        provisioner = WorkspaceProvisioner()

        env = {
            "WORKSPACE_PROVISION_CUSTOM": "val1",
            "WORKSPACE_PROVISION_SECRET": "val2",
            "REGULAR_KEY": "val3",
        }
        result = provisioner.provision(None, backend, env, is_local_mode=True)

        assert "WORKSPACE_PROVISION_CUSTOM" in result.consumed_keys
        assert "WORKSPACE_PROVISION_SECRET" in result.consumed_keys
        assert "REGULAR_KEY" not in result.consumed_keys

    def test_prefix_keys_merged_with_source_keys(self, tmp_path):
        git = _MockGitRepoSource(url="https://github.com/acme/repo.git")
        source = _MockWorkspaceSource(git_repo=git)
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        env = {
            "GITHUB_TOKEN": "ghp_test",
            "WORKSPACE_PROVISION_EXTRA": "x",
        }
        result = provisioner.provision(
            source, backend, env, is_local_mode=True
        )

        assert "GITHUB_TOKEN" in result.consumed_keys
        assert "WORKSPACE_PROVISION_EXTRA" in result.consumed_keys

    def test_no_prefix_keys_means_no_extra_consumed(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(
            None, backend, {"SOME_KEY": "v"}, is_local_mode=True
        )

        assert result.consumed_keys == ()


# ---------------------------------------------------------------------------
# Domain type immutability
# ---------------------------------------------------------------------------


class TestImmutability:
    """Value objects are truly frozen."""

    def test_provision_result_frozen(self):
        result = ProvisionResult(
            root_dir="/tmp/ws",
            source_type=SourceType.EMPTY,
            consumed_keys=(),
            workspace_description="desc",
        )
        with pytest.raises(FrozenInstanceError):
            result.root_dir = "/other"  # type: ignore[misc]

    def test_git_metadata_frozen(self):
        meta = GitMetadata(repo_url="https://x", branch="main", base_commit="abc")
        with pytest.raises(FrozenInstanceError):
            meta.branch = "other"  # type: ignore[misc]

    def test_consumed_keys_is_tuple(self):
        result = ProvisionResult(
            root_dir="/tmp",
            source_type=SourceType.GIT_REPO,
            consumed_keys=("GITHUB_TOKEN",),
            workspace_description="desc",
        )
        assert isinstance(result.consumed_keys, tuple)


# ---------------------------------------------------------------------------
# WorkspaceProvisionError
# ---------------------------------------------------------------------------


class TestWorkspaceProvisionError:
    """Error carries structured context."""

    def test_message_includes_source_type(self):
        err = WorkspaceProvisionError(SourceType.GIT_REPO, "clone failed")
        assert "[git_repo]" in str(err)
        assert "clone failed" in str(err)

    def test_cause_preserved(self):
        cause = RuntimeError("network down")
        err = WorkspaceProvisionError(
            SourceType.GIT_REPO, "clone failed", cause=cause
        )
        assert err.cause is cause
        assert err.source_type is SourceType.GIT_REPO
