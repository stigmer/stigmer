"""Tests for WorkspaceProvisioner — dispatch logic and credential scoping."""

from __future__ import annotations

import os
from dataclasses import FrozenInstanceError

import pytest

from stigmer_runner.worker.workspace.backend import ExecuteResult
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend
from stigmer_runner.worker.workspace.provisioner import (
    GitMetadata,
    ProvisionResult,
    SourceType,
    WorkspaceProvisioner,
    WorkspaceProvisionError,
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


class _MockWorkspaceEntry:
    """Mimics a ``WorkspaceEntry`` proto for provision_all testing."""

    def __init__(self, name: str, source: object) -> None:
        self.name = name
        self.source = source


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
# File-tree enrichment
# ---------------------------------------------------------------------------


class TestFileTreeEnrichment:
    """Provisioner generates a file-tree manifest after dispatch."""

    def test_local_path_gets_tree(self, tmp_path):
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "main.py").write_text("print('hello')")
        (tmp_path / "README.md").write_text("# My Project")

        local = _MockLocalPathSource(path=str(tmp_path))
        source = _MockWorkspaceSource(local_path=local)
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(source, backend, {}, is_local_mode=True)

        assert result.file_tree is not None
        assert "### Project Structure" in result.file_tree
        assert "src/" in result.file_tree
        assert "README.md" in result.file_tree

    def test_empty_workspace_skips_tree(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(None, backend, {}, is_local_mode=True)

        assert result.source_type is SourceType.EMPTY
        assert result.file_tree is None

    def test_git_workspace_with_files_gets_tree(self, tmp_path):
        (tmp_path / "app.py").write_text("import flask")

        git = _MockGitRepoSource(url="https://github.com/acme/repo.git")
        source = _MockWorkspaceSource(git_repo=git)
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(
            source, backend, {}, is_local_mode=True
        )

        assert result.file_tree is not None
        assert "app.py" in result.file_tree

    def test_empty_git_workspace_returns_none_tree(self, tmp_path):
        git = _MockGitRepoSource(url="https://github.com/acme/repo.git")
        source = _MockWorkspaceSource(git_repo=git)
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(
            source, backend, {}, is_local_mode=True
        )

        assert result.file_tree is None

    def test_file_tree_survives_consumed_keys_rebuild(self, tmp_path):
        """When WORKSPACE_PROVISION_ keys expand consumed_keys via
        dataclasses.replace(), file_tree must not be lost."""
        (tmp_path / "data.csv").write_text("a,b,c")

        local = _MockLocalPathSource(path=str(tmp_path))
        source = _MockWorkspaceSource(local_path=local)
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        env = {"WORKSPACE_PROVISION_SECRET": "val"}
        result = provisioner.provision(source, backend, env, is_local_mode=True)

        assert "WORKSPACE_PROVISION_SECRET" in result.consumed_keys
        assert result.file_tree is not None
        assert "data.csv" in result.file_tree


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


# ---------------------------------------------------------------------------
# provision_all — multi-entry orchestrator
# ---------------------------------------------------------------------------


class TestProvisionAll:
    """Tests for WorkspaceProvisioner.provision_all()."""

    def test_empty_entries_returns_empty_list(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all([], backend, {}, is_local_mode=True)

        assert results == []

    def test_single_local_entry_returns_one_result_with_name(self, tmp_path):
        source = _MockWorkspaceSource(
            local_path=_MockLocalPathSource(path=str(tmp_path)),
        )
        entry = _MockWorkspaceEntry(name="my-project", source=source)
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry], backend, {}, is_local_mode=True,
        )

        assert len(results) == 1
        assert results[0].entry_name == "my-project"
        assert results[0].source_type is SourceType.LOCAL_PATH
        assert results[0].root_dir == str(tmp_path)

    def test_multiple_local_entries_returns_all_with_names(self, tmp_path):
        dir_a = tmp_path / "alpha"
        dir_b = tmp_path / "beta"
        dir_a.mkdir()
        dir_b.mkdir()

        entry_a = _MockWorkspaceEntry(
            name="alpha",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(dir_a)),
            ),
        )
        entry_b = _MockWorkspaceEntry(
            name="beta",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(dir_b)),
            ),
        )
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry_a, entry_b], backend, {}, is_local_mode=True,
        )

        assert len(results) == 2
        assert results[0].entry_name == "alpha"
        assert results[0].root_dir == str(dir_a)
        assert results[1].entry_name == "beta"
        assert results[1].root_dir == str(dir_b)

    def test_entry_name_stamped_on_result(self, tmp_path):
        """entry_name comes from the entry, not the source handler."""
        source = _MockWorkspaceSource(
            local_path=_MockLocalPathSource(path=str(tmp_path)),
        )
        entry = _MockWorkspaceEntry(name="custom-label", source=source)
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry], backend, {}, is_local_mode=True,
        )

        assert results[0].entry_name == "custom-label"

    def test_consumed_keys_propagated_per_entry(self, tmp_path):
        dir_a = tmp_path / "a"
        dir_a.mkdir()

        entry = _MockWorkspaceEntry(
            name="a",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(dir_a)),
            ),
        )
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        env = {"WORKSPACE_PROVISION_SECRET": "val"}
        results = provisioner.provision_all(
            [entry], backend, env, is_local_mode=True,
        )

        assert "WORKSPACE_PROVISION_SECRET" in results[0].consumed_keys

    def test_first_failure_aborts_remaining_entries(self, tmp_path):
        good_dir = tmp_path / "good"
        good_dir.mkdir()
        bad_path = str(tmp_path / "does-not-exist")

        entry_good = _MockWorkspaceEntry(
            name="good",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(good_dir)),
            ),
        )
        entry_bad = _MockWorkspaceEntry(
            name="bad",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=bad_path),
            ),
        )
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        with pytest.raises(WorkspaceProvisionError, match="does not exist"):
            provisioner.provision_all(
                [entry_good, entry_bad], backend, {}, is_local_mode=True,
            )

    def test_existing_provision_method_unchanged(self, tmp_path):
        """provision() still works as before — no entry_name."""
        source = _MockWorkspaceSource(
            local_path=_MockLocalPathSource(path=str(tmp_path)),
        )
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        provisioner = WorkspaceProvisioner()

        result = provisioner.provision(source, backend, {}, is_local_mode=True)

        assert result.entry_name == ""
        assert result.source_type is SourceType.LOCAL_PATH


# ---------------------------------------------------------------------------
# provision_all — multi-git subdirectory support
# ---------------------------------------------------------------------------


class TestProvisionAllMultiGit:
    """Multi-git entries get target_subdir from provision_all."""

    def test_two_git_entries_get_subdirectories(self, tmp_path):
        entry_a = _MockWorkspaceEntry(
            name="frontend",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/front.git",
                ),
            ),
        )
        entry_b = _MockWorkspaceEntry(
            name="backend",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/back.git",
                ),
            ),
        )
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry_a, entry_b], backend, {}, is_local_mode=True,
        )

        assert len(results) == 2
        assert results[0].entry_name == "frontend"
        assert results[0].root_dir == str(tmp_path / "frontend")
        assert results[1].entry_name == "backend"
        assert results[1].root_dir == str(tmp_path / "backend")

    def test_single_git_entry_clones_into_root(self, tmp_path):
        entry = _MockWorkspaceEntry(
            name="my-app",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/repo.git",
                ),
            ),
        )
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry], backend, {}, is_local_mode=True,
        )

        assert len(results) == 1
        assert results[0].root_dir == str(tmp_path)

    def test_multi_git_entries_have_git_metadata(self, tmp_path):
        entry_a = _MockWorkspaceEntry(
            name="svc-a",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/svc-a.git",
                ),
            ),
        )
        entry_b = _MockWorkspaceEntry(
            name="svc-b",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/svc-b.git",
                ),
            ),
        )
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry_a, entry_b], backend, {}, is_local_mode=True,
        )

        assert results[0].git_metadata is not None
        assert results[0].git_metadata.repo_url == "https://github.com/org/svc-a.git"
        assert results[1].git_metadata is not None
        assert results[1].git_metadata.repo_url == "https://github.com/org/svc-b.git"

    def test_multi_entry_consumed_keys_propagated(self, tmp_path):
        entry_a = _MockWorkspaceEntry(
            name="a",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/a.git",
                ),
            ),
        )
        entry_b = _MockWorkspaceEntry(
            name="b",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/b.git",
                ),
            ),
        )
        backend = _make_git_backend(tmp_path)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry_a, entry_b],
            backend,
            {"GITHUB_TOKEN": "ghp_test"},
            is_local_mode=True,
        )

        assert "GITHUB_TOKEN" in results[0].consumed_keys
        assert "GITHUB_TOKEN" in results[1].consumed_keys


# ---------------------------------------------------------------------------
# Guard-rail tests — MVP limitation: mixed local + git entries
# ---------------------------------------------------------------------------


class TestMixedLocalGitGuardRail:
    """Document intentional MVP behavior for mixed local + git entries.

    When ``provision_all()`` receives a mix of local-path and git_repo
    entries, ``use_subdirs`` is ``True`` (len > 1).  The git entry
    clones into ``{root}/{name}/`` but the local-path entry retains
    its original absolute path — ``local_path_source.provision()`` does
    not accept ``target_subdir``.

    This means the local entry's ``root_dir`` is *outside* the
    workspace root tree.  This is intentional for MVP and only valid
    in local mode.
    """

    def test_local_entry_keeps_original_path(self, tmp_path):
        """local-path root_dir is the user's original path, not a subdir."""
        user_dir = tmp_path / "user-project"
        user_dir.mkdir()

        entry_local = _MockWorkspaceEntry(
            name="my-lib",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(user_dir)),
            ),
        )
        entry_git = _MockWorkspaceEntry(
            name="my-app",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/my-app.git",
                ),
            ),
        )
        backend = _make_git_backend(tmp_path / "workspace")
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry_local, entry_git],
            backend,
            {},
            is_local_mode=True,
        )

        assert len(results) == 2
        assert results[0].entry_name == "my-lib"
        assert results[0].root_dir == str(user_dir)
        assert results[0].source_type is SourceType.LOCAL_PATH

        assert results[1].entry_name == "my-app"
        assert results[1].root_dir == str(tmp_path / "workspace" / "my-app")
        assert results[1].source_type is SourceType.GIT_REPO

    def test_git_entry_gets_subdir_in_mixed_session(self, tmp_path):
        """git entry clones into {workspace_root}/{name}/ when mixed."""
        user_dir = tmp_path / "local-lib"
        user_dir.mkdir()

        entry_local = _MockWorkspaceEntry(
            name="local-lib",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(user_dir)),
            ),
        )
        entry_git = _MockWorkspaceEntry(
            name="cloud-svc",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/cloud-svc.git",
                ),
            ),
        )
        ws_root = tmp_path / "workspace"
        backend = _make_git_backend(ws_root)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry_local, entry_git],
            backend,
            {},
            is_local_mode=True,
        )

        assert results[1].root_dir == str(ws_root / "cloud-svc")


# ---------------------------------------------------------------------------
# provision_all — multi-local-path symlink creation
# ---------------------------------------------------------------------------


class TestProvisionAllMultiLocalPathSymlinks:
    """When multiple local_path entries are provisioned, symlinks are
    created inside the backend's root_dir so the FilesystemBackend can
    navigate to them via entry-relative paths."""

    def test_two_local_paths_create_symlinks(self, tmp_path):
        dir_a = tmp_path / "repo-a"
        dir_b = tmp_path / "repo-b"
        dir_a.mkdir()
        dir_b.mkdir()

        entry_a = _MockWorkspaceEntry(
            name="repo-a",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(dir_a)),
            ),
        )
        entry_b = _MockWorkspaceEntry(
            name="repo-b",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(dir_b)),
            ),
        )
        ws_root = tmp_path / "workspace"
        ws_root.mkdir()
        backend = LocalWorkspaceBackend(root_dir=ws_root)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry_a, entry_b], backend, {}, is_local_mode=True,
        )

        assert len(results) == 2
        assert (ws_root / "repo-a").is_symlink()
        assert (ws_root / "repo-b").is_symlink()
        assert os.path.realpath(str(ws_root / "repo-a")) == str(dir_a.resolve())
        assert os.path.realpath(str(ws_root / "repo-b")) == str(dir_b.resolve())

    def test_single_local_path_no_symlink(self, tmp_path):
        dir_a = tmp_path / "repo-a"
        dir_a.mkdir()

        entry = _MockWorkspaceEntry(
            name="repo-a",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(dir_a)),
            ),
        )
        ws_root = tmp_path / "workspace"
        ws_root.mkdir()
        backend = LocalWorkspaceBackend(root_dir=ws_root)
        provisioner = WorkspaceProvisioner()

        provisioner.provision_all(
            [entry], backend, {}, is_local_mode=True,
        )

        assert not (ws_root / "repo-a").exists()

    def test_mixed_local_path_creates_symlink(self, tmp_path):
        """In a mixed session, the local_path entry gets a symlink."""
        dir_local = tmp_path / "local-lib"
        dir_local.mkdir()

        entry_local = _MockWorkspaceEntry(
            name="local-lib",
            source=_MockWorkspaceSource(
                local_path=_MockLocalPathSource(path=str(dir_local)),
            ),
        )
        entry_git = _MockWorkspaceEntry(
            name="cloud-svc",
            source=_MockWorkspaceSource(
                git_repo=_MockGitRepoSource(
                    url="https://github.com/org/cloud-svc.git",
                ),
            ),
        )
        ws_root = tmp_path / "workspace"
        backend = _make_git_backend(ws_root)
        provisioner = WorkspaceProvisioner()

        provisioner.provision_all(
            [entry_local, entry_git],
            backend,
            {},
            is_local_mode=True,
        )

        assert (ws_root / "local-lib").is_symlink()
        assert os.path.realpath(str(ws_root / "local-lib")) == str(dir_local.resolve())
