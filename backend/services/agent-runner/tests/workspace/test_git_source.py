"""Tests for the git workspace source handler."""

from __future__ import annotations

import pytest

from stigmer_runner.worker.workspace.backend import ExecuteResult
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend
from stigmer_runner.worker.workspace.provisioner import (
    SourceType,
    WorkspaceProvisionError,
)
from stigmer_runner.worker.workspace.sources import git as git_source

# ---------------------------------------------------------------------------
# Mock proto + backend helpers
# ---------------------------------------------------------------------------

_DETECT_CMD_KEY = "echo dir || (test -f"
"""Unique substring of the detection command used by _detect_existing_repo.

Matches: test -d .git && echo dir || (test -f .git && echo file) || echo none
"""


class _MockGitRepoSource:
    """Duck-typed ``GitRepoSource`` proto message."""

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


class _GitBackend:
    """Wraps a ``LocalWorkspaceBackend`` with controllable git responses.

    Records every command passed to ``execute()`` for assertion.
    """

    def __init__(self, tmp_path, *, clone_response=None, responses=None):
        self._inner = LocalWorkspaceBackend(root_dir=tmp_path)
        self.commands: list[str] = []
        self._tmp_path = tmp_path

        self._responses: dict[str, ExecuteResult] = {
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="none\n", stderr="",
            ),
            "ls -A": ExecuteResult(exit_code=0, stdout="", stderr=""),
            "git clone": clone_response
            or ExecuteResult(exit_code=0, stdout="", stderr=""),
            "rev-parse --abbrev-ref HEAD": ExecuteResult(
                exit_code=0, stdout="main\n", stderr=""
            ),
            "rev-parse HEAD": ExecuteResult(
                exit_code=0,
                stdout="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n",
                stderr="",
            ),
            "git checkout": ExecuteResult(exit_code=0, stdout="", stderr=""),
            "--absolute-git-dir": ExecuteResult(
                exit_code=0, stdout=f"{tmp_path}/.git\n", stderr="",
            ),
            "2>/dev/null || true": ExecuteResult(
                exit_code=0, stdout="", stderr="",
            ),
            "printf": ExecuteResult(exit_code=0, stdout="", stderr=""),
        }
        if responses:
            self._responses.update(responses)

    @property
    def root_dir(self) -> str:
        return self._inner.root_dir

    @property
    def platform_dir(self) -> str | None:
        return self._inner.platform_dir

    def write_file(self, rel_path, content):
        return self._inner.write_file(rel_path, content)

    def write_files(self, files):
        return self._inner.write_files(files)

    def read_file(self, rel_path):
        return self._inner.read_file(rel_path)

    def file_exists(self, rel_path):
        return self._inner.file_exists(rel_path)

    def mkdir(self, rel_path):
        return self._inner.mkdir(rel_path)

    def execute(self, command, *, cwd=None, timeout=30):
        self.commands.append(command)
        for key, response in self._responses.items():
            if key in command:
                return response
        return ExecuteResult(exit_code=1, stdout="", stderr=f"unmatched: {command}")


class _CloudGitBackend(_GitBackend):
    """_GitBackend pre-configured with responses for cloud mode.

    Adds responses for FUSE volume compat configuration,
    separate git-dir operations, and credential store commands
    that are only issued when ``is_local_mode=False``.
    """

    def __init__(self, tmp_path, *, clone_response=None, responses=None):
        cloud_responses: dict[str, ExecuteResult] = {
            "safe.directory": ExecuteResult(exit_code=0, stdout="", stderr=""),
            "mkdir -p /home/daytona/.git-repos": ExecuteResult(
                exit_code=0, stdout="", stderr="",
            ),
            "git remote set-url": ExecuteResult(
                exit_code=0, stdout="", stderr="",
            ),
            "credential.helper": ExecuteResult(
                exit_code=0, stdout="", stderr="",
            ),
        }
        if responses:
            cloud_responses.update(responses)
        super().__init__(
            tmp_path, clone_response=clone_response, responses=cloud_responses,
        )


# ---------------------------------------------------------------------------
# Clone command construction
# ---------------------------------------------------------------------------


class TestCloneCommand:
    """Verify the git clone command shape for various source configurations."""

    def test_default_depth_is_shallow(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--depth 1" in clone_cmd

    def test_depth_zero_means_full_clone(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git", depth=0
        )
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--depth" not in clone_cmd

    def test_explicit_depth(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git", depth=5
        )
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--depth 5" in clone_cmd

    def test_branch_specified(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git", branch="develop"
        )
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--branch develop" in clone_cmd

    def test_no_branch_omits_flag(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--branch" not in clone_cmd

    def test_commit_triggers_post_clone_checkout(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git", commit="deadbeef"
        )
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        checkout_cmd = _find_command(backend.commands, "git checkout")
        assert "deadbeef" in checkout_cmd

    def test_no_commit_skips_checkout(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        assert not any("git checkout" in c for c in backend.commands)

    def test_branch_and_commit_clones_then_checks_out(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git",
            branch="main",
            commit="abc123",
        )
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--branch main" in clone_cmd
        checkout_cmd = _find_command(backend.commands, "git checkout")
        assert "abc123" in checkout_cmd

    def test_clone_targets_root_dir(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert clone_cmd.endswith(backend.root_dir)

    def test_no_separate_git_dir_in_local_mode(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--separate-git-dir" not in clone_cmd


# ---------------------------------------------------------------------------
# Token handling and authentication
# ---------------------------------------------------------------------------


class TestAuthentication:
    """Token injection and consumed_keys."""

    def test_github_token_injected_for_github_url(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)
        env = {"GITHUB_TOKEN": "ghp_secret123"}

        git_source.provision(source, backend, env)

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "x-access-token:ghp_secret123@github.com" in clone_cmd

    def test_token_not_injected_for_non_github_host(self, tmp_path):
        source = _MockGitRepoSource(url="https://gitlab.com/org/repo.git")
        backend = _GitBackend(tmp_path)
        env = {"GITHUB_TOKEN": "ghp_secret123"}

        git_source.provision(source, backend, env)

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "ghp_secret123" not in clone_cmd
        assert "gitlab.com/org/repo.git" in clone_cmd

    def test_no_token_clones_without_auth(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "x-access-token" not in clone_cmd

    def test_consumed_keys_includes_token_when_present(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(source, backend, {"GITHUB_TOKEN": "t"})

        assert "GITHUB_TOKEN" in result.consumed_keys

    def test_consumed_keys_empty_when_no_token(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(source, backend, {})

        assert result.consumed_keys == ()


# ---------------------------------------------------------------------------
# Post-clone metadata
# ---------------------------------------------------------------------------


class TestMetadata:
    """GitMetadata populated correctly."""

    def test_metadata_has_repo_url_without_token(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_secret"}
        )

        assert result.git_metadata is not None
        assert result.git_metadata.repo_url == "https://github.com/org/repo.git"
        assert "ghp_secret" not in result.git_metadata.repo_url

    def test_metadata_branch_resolved(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(source, backend, {})

        assert result.git_metadata is not None
        assert result.git_metadata.branch == "main"

    def test_metadata_commit_sha(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(source, backend, {})

        assert result.git_metadata is not None
        assert result.git_metadata.base_commit == "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

    def test_detached_head_branch_is_HEAD(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git", commit="deadbeef"
        )
        backend = _GitBackend(
            tmp_path,
            responses={
                "rev-parse --abbrev-ref HEAD": ExecuteResult(
                    exit_code=0, stdout="HEAD\n", stderr=""
                ),
            },
        )

        result = git_source.provision(source, backend, {})

        assert result.git_metadata is not None
        assert result.git_metadata.branch == "HEAD"


class TestResult:
    """ProvisionResult shape."""

    def test_source_type_is_git_repo(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(source, backend, {})

        assert result.source_type is SourceType.GIT_REPO

    def test_root_dir_is_backend_root(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(source, backend, {})

        assert result.root_dir == backend.root_dir

    def test_workspace_description_contains_url_and_branch(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(source, backend, {})

        assert "https://github.com/org/repo.git" in result.workspace_description
        assert "main" in result.workspace_description


# ---------------------------------------------------------------------------
# Idempotent provisioning
# ---------------------------------------------------------------------------


class TestIdempotentProvisioning:
    """Subsequent executions reuse existing clone instead of re-cloning."""

    def test_existing_repo_returns_metadata_without_cloning(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        result = git_source.provision(source, backend, {})

        assert result.source_type is SourceType.GIT_REPO
        assert result.git_metadata is not None
        assert result.git_metadata.repo_url == "https://github.com/org/repo.git"
        assert result.git_metadata.branch == "main"
        assert not any("git clone" in c for c in backend.commands)

    def test_existing_repo_reports_consumed_keys_when_token_present(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        result = git_source.provision(source, backend, {"GITHUB_TOKEN": "tok"})

        assert "GITHUB_TOKEN" in result.consumed_keys

    def test_existing_repo_empty_consumed_keys_when_no_token(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        result = git_source.provision(source, backend, {})

        assert result.consumed_keys == ()

    def test_corrupted_workspace_cleaned_and_recloned(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="none\n", stderr="",
            ),
            "ls -A": ExecuteResult(
                exit_code=0, stdout="partial-data\n", stderr="",
            ),
            "rm -rf": ExecuteResult(exit_code=0, stdout="", stderr=""),
        })

        result = git_source.provision(source, backend, {})

        assert result.source_type is SourceType.GIT_REPO
        assert any("rm -rf" in c for c in backend.commands)
        assert any("git clone" in c for c in backend.commands)

    def test_empty_workspace_proceeds_to_clone(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="none\n", stderr="",
            ),
            "ls -A": ExecuteResult(exit_code=0, stdout="", stderr=""),
        })

        result = git_source.provision(source, backend, {})

        assert result.source_type is SourceType.GIT_REPO
        assert any("git clone" in c for c in backend.commands)
        assert not any("rm -rf" in c for c in backend.commands)


# ---------------------------------------------------------------------------
# Git excludes
# ---------------------------------------------------------------------------


class TestGitExcludes:
    """Platform directories added to git exclude file."""

    def test_excludes_written_after_fresh_clone(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        assert any("--absolute-git-dir" in c for c in backend.commands)
        printf_cmd = _find_command(backend.commands, "printf")
        assert ".stigmer" in printf_cmd

    def test_excludes_written_for_existing_repo(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        git_source.provision(source, backend, {})

        printf_cmd = _find_command(backend.commands, "printf")
        assert ".stigmer" in printf_cmd

    def test_excludes_idempotent_no_duplicates(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
            "2>/dev/null || true": ExecuteResult(
                exit_code=0, stdout=".stigmer\n", stderr="",
            ),
        })

        git_source.provision(source, backend, {})

        assert not any("printf" in c for c in backend.commands)

    def test_excludes_appended_to_existing_content(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
            "2>/dev/null || true": ExecuteResult(
                exit_code=0,
                stdout="# git default excludes\n*.pyc\n",
                stderr="",
            ),
        })

        git_source.provision(source, backend, {})

        printf_cmd = _find_command(backend.commands, "printf")
        assert ".stigmer" in printf_cmd

    def test_excludes_skipped_when_git_dir_unresolvable(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            "--absolute-git-dir": ExecuteResult(
                exit_code=128,
                stdout="",
                stderr="fatal: not a git repository",
            ),
        })

        git_source.provision(source, backend, {})

        assert not any("printf" in c for c in backend.commands)


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrors:
    """Git failures produce structured WorkspaceProvisionError."""

    def test_auth_failure(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=128,
                stdout="",
                stderr="fatal: Authentication failed for 'https://github.com/org/repo.git'",
            ),
        )

        with pytest.raises(WorkspaceProvisionError, match="authentication") as exc_info:
            git_source.provision(source, backend, {})

        assert exc_info.value.source_type is SourceType.GIT_REPO

    def test_repo_not_found(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=128,
                stdout="",
                stderr="fatal: repository 'https://github.com/org/repo.git/' not found",
            ),
        )

        with pytest.raises(WorkspaceProvisionError, match="not found"):
            git_source.provision(source, backend, {})

    def test_branch_not_found(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git", branch="nonexistent"
        )
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=128,
                stdout="",
                stderr="fatal: Remote branch nonexistent not found in upstream origin",
            ),
        )

        with pytest.raises(WorkspaceProvisionError, match="branch not found"):
            git_source.provision(source, backend, {})

    def test_network_error(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=128,
                stdout="",
                stderr="fatal: unable to access 'https://github.com/org/repo.git/': Could not resolve host: github.com",
            ),
        )

        with pytest.raises(WorkspaceProvisionError, match="network"):
            git_source.provision(source, backend, {})

    def test_function_not_implemented(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=128,
                stdout="",
                stderr="error: could not write config file .git/config: Function not implemented",
            ),
        )

        with pytest.raises(WorkspaceProvisionError, match="filesystem") as exc_info:
            git_source.provision(source, backend, {})

        assert "FUSE" in str(exc_info.value) or "separate-git-dir" in str(exc_info.value)

    def test_non_empty_no_git_recovers_and_clones(self, tmp_path):
        """Non-empty workspace without .git is cleaned and re-provisioned."""
        (tmp_path / "partial-file.txt").write_text("leftover from crash")
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="none\n", stderr="",
            ),
            "ls -A": ExecuteResult(
                exit_code=0, stdout="partial-file.txt\n", stderr="",
            ),
            "rm -rf": ExecuteResult(exit_code=0, stdout="", stderr=""),
        })

        result = git_source.provision(source, backend, {})

        assert result.source_type is SourceType.GIT_REPO
        assert any("rm -rf" in c for c in backend.commands)

    def test_generic_failure(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=1,
                stdout="",
                stderr="fatal: something completely unexpected",
            ),
        )

        with pytest.raises(WorkspaceProvisionError, match="failed"):
            git_source.provision(source, backend, {})


# ---------------------------------------------------------------------------
# Token scrubbing in errors
# ---------------------------------------------------------------------------


class TestTokenScrubbing:
    """Token must never appear in error messages."""

    def test_token_scrubbed_from_auth_error(self, tmp_path):
        token = "ghp_MySuperSecretToken123"
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=128,
                stdout="",
                stderr=f"fatal: Authentication failed for 'https://x-access-token:{token}@github.com/org/repo.git/'",
            ),
        )

        with pytest.raises(WorkspaceProvisionError) as exc_info:
            git_source.provision(source, backend, {"GITHUB_TOKEN": token})

        assert token not in str(exc_info.value)
        assert "***" in str(exc_info.value)

    def test_token_scrubbed_from_generic_error(self, tmp_path):
        token = "ghp_AnotherSecret"
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(
            tmp_path,
            clone_response=ExecuteResult(
                exit_code=1,
                stdout="",
                stderr=f"error: could not fetch https://x-access-token:{token}@github.com/org/repo.git",
            ),
        )

        with pytest.raises(WorkspaceProvisionError) as exc_info:
            git_source.provision(source, backend, {"GITHUB_TOKEN": token})

        assert token not in str(exc_info.value)


# ---------------------------------------------------------------------------
# Subdirectory provisioning (multi-entry cloud mode)
# ---------------------------------------------------------------------------


class _CwdTrackingGitBackend(_GitBackend):
    """Extends _GitBackend to record (command, cwd) pairs."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.command_records: list[tuple[str, str | None]] = []

    def execute(self, command, *, cwd=None, timeout=30):
        self.command_records.append((command, cwd))
        return super().execute(command, cwd=cwd, timeout=timeout)


class TestSubdirectoryClone:
    """When target_subdir is set, clone into a named subdirectory."""

    def test_clone_target_includes_subdirectory(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path)

        git_source.provision(source, backend, {}, target_subdir="my-app")

        clone_cmd = _find_command(backend.commands, "git clone")
        expected_target = str(tmp_path / "my-app")
        assert clone_cmd.endswith(expected_target)

    def test_root_dir_includes_subdirectory(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path)

        result = git_source.provision(source, backend, {}, target_subdir="my-app")

        assert result.root_dir == str(tmp_path / "my-app")

    def test_no_subdir_preserves_root_dir(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path)

        result = git_source.provision(source, backend, {})

        assert result.root_dir == str(tmp_path)

    def test_post_clone_commands_use_cwd(self, tmp_path):
        source = _MockGitRepoSource(
            url="https://github.com/org/repo.git", commit="abc123"
        )
        backend = _CwdTrackingGitBackend(tmp_path)

        git_source.provision(source, backend, {}, target_subdir="my-app")

        for cmd, cwd in backend.command_records:
            if "git checkout" in cmd or "rev-parse" in cmd:
                assert cwd == "my-app", (
                    f"Expected cwd='my-app' for '{cmd}', got {cwd!r}"
                )

    def test_clone_command_runs_from_root(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path)

        git_source.provision(source, backend, {}, target_subdir="my-app")

        for cmd, cwd in backend.command_records:
            if "git clone" in cmd:
                assert cwd is None, f"Clone should run from root, got cwd={cwd!r}"

    def test_metadata_populated_for_subdir_clone(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path)

        result = git_source.provision(source, backend, {}, target_subdir="my-app")

        assert result.source_type is SourceType.GIT_REPO
        assert result.git_metadata is not None
        assert result.git_metadata.repo_url == "https://github.com/org/repo.git"
        assert result.git_metadata.branch == "main"


class TestSubdirectoryIdempotency:
    """Idempotent detection scoped to subdirectory."""

    def test_existing_repo_in_subdir_detected(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        result = git_source.provision(
            source, backend, {}, target_subdir="my-app"
        )

        assert result.root_dir == str(tmp_path / "my-app")
        assert not any("git clone" in c for c in backend.commands)

    def test_detect_uses_cwd(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        git_source.provision(source, backend, {}, target_subdir="my-app")

        for cmd, cwd in backend.command_records:
            if _DETECT_CMD_KEY in cmd:
                assert cwd == "my-app"


class TestSubdirectoryRecovery:
    """Cleanup scoped to subdirectory."""

    def test_cleanup_uses_cwd(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="none\n", stderr="",
            ),
            "ls -A": ExecuteResult(
                exit_code=0, stdout="partial-data\n", stderr="",
            ),
            "rm -rf": ExecuteResult(exit_code=0, stdout="", stderr=""),
        })

        git_source.provision(source, backend, {}, target_subdir="my-app")

        for cmd, cwd in backend.command_records:
            if "rm -rf" in cmd:
                assert cwd == "my-app", (
                    f"Cleanup should be scoped, got cwd={cwd!r}"
                )

    def test_nonexistent_subdir_skips_cleanup(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=1, stdout="", stderr="",
            ),
            "ls -A": ExecuteResult(
                exit_code=1, stdout="", stderr="No such file or directory",
            ),
        })

        result = git_source.provision(
            source, backend, {}, target_subdir="new-entry"
        )

        assert not any("rm -rf" in c for c in backend.commands)
        assert result.source_type is SourceType.GIT_REPO


class TestSubdirectoryExcludes:
    """Git excludes resolved correctly with subdirectories."""

    def test_excludes_resolve_git_dir_in_subdirectory(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CwdTrackingGitBackend(tmp_path)

        git_source.provision(source, backend, {}, target_subdir="my-app")

        for cmd, cwd in backend.command_records:
            if "--absolute-git-dir" in cmd:
                assert cwd == "my-app", (
                    f"git rev-parse should use cwd='my-app', got {cwd!r}"
                )


# ---------------------------------------------------------------------------
# Cloud mode: FUSE+S3 volume compatibility
# ---------------------------------------------------------------------------


class TestCloudModeSeparateGitDir:
    """Cloud mode (is_local_mode=False) uses --separate-git-dir."""

    def test_clone_includes_separate_git_dir(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {}, is_local_mode=False,
        )

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "--separate-git-dir" in clone_cmd
        assert "/home/daytona/.git-repos/default" in clone_cmd

    def test_subdir_clone_uses_entry_name_in_git_dir(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {}, target_subdir="my-app", is_local_mode=False,
        )

        clone_cmd = _find_command(backend.commands, "git clone")
        assert "/home/daytona/.git-repos/my-app" in clone_cmd

    def test_fuse_compat_configured_before_clone(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {}, is_local_mode=False,
        )

        config_idx = None
        clone_idx = None
        for i, cmd in enumerate(backend.commands):
            if "safe.directory" in cmd and config_idx is None:
                config_idx = i
            if "git clone" in cmd and clone_idx is None:
                clone_idx = i

        assert config_idx is not None, "safe.directory config not found"
        assert clone_idx is not None, "git clone not found"
        assert config_idx < clone_idx, (
            "safe.directory must be configured before clone"
        )

    def test_git_dir_parent_created_before_clone(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {}, is_local_mode=False,
        )

        mkdir_cmd = _find_command(
            backend.commands, "mkdir -p /home/daytona/.git-repos",
        )
        assert mkdir_cmd is not None

        mkdir_idx = backend.commands.index(mkdir_cmd)
        clone_cmd = _find_command(backend.commands, "git clone")
        clone_idx = backend.commands.index(clone_cmd)
        assert mkdir_idx < clone_idx

    def test_local_mode_skips_fuse_compat(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {}, is_local_mode=True)

        assert not any("safe.directory" in c for c in backend.commands)
        assert not any(
            "mkdir -p /home/daytona/.git-repos" in c for c in backend.commands
        )

    def test_cloud_mode_configures_safe_directory_and_filemode(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {}, is_local_mode=False,
        )

        config_cmd = _find_command(backend.commands, "safe.directory")
        assert "core.fileMode false" in config_cmd


# ---------------------------------------------------------------------------
# Stale .git pointer detection (separate-git-dir recovery)
# ---------------------------------------------------------------------------


class TestStaleGitPointer:
    """When .git is a file but the target dir is gone, re-provision."""

    def test_stale_pointer_triggers_reclone(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="file\n", stderr="",
            ),
            "sed 's/gitdir: //'": ExecuteResult(
                exit_code=0, stdout="stale\n", stderr="",
            ),
            "ls -A": ExecuteResult(
                exit_code=0, stdout=".git\nREADME.md\n", stderr="",
            ),
            "rm -rf": ExecuteResult(exit_code=0, stdout="", stderr=""),
        })

        result = git_source.provision(
            source, backend, {}, is_local_mode=False,
        )

        assert result.source_type is SourceType.GIT_REPO
        assert any("git clone" in c for c in backend.commands)
        assert any("rm -rf" in c for c in backend.commands)

    def test_valid_pointer_reuses_existing_repo(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="file\n", stderr="",
            ),
            "sed 's/gitdir: //'": ExecuteResult(
                exit_code=0, stdout="valid\n", stderr="",
            ),
        })

        result = git_source.provision(
            source, backend, {}, is_local_mode=False,
        )

        assert result.source_type is SourceType.GIT_REPO
        assert not any("git clone" in c for c in backend.commands)

    def test_git_dir_detection_distinguishes_dir_and_file(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")

        dir_backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })
        git_source.provision(source, dir_backend, {})
        assert not any("git clone" in c for c in dir_backend.commands)

        file_backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="file\n", stderr="",
            ),
            "sed 's/gitdir: //'": ExecuteResult(
                exit_code=0, stdout="valid\n", stderr="",
            ),
        })
        git_source.provision(source, file_backend, {})
        assert not any("git clone" in c for c in file_backend.commands)
        assert any("sed 's/gitdir: //'" in c for c in file_backend.commands)


# ---------------------------------------------------------------------------
# Git credential persistence (cloud mode)
# ---------------------------------------------------------------------------


class TestCredentialHelper:
    """Credential store configuration when ``configure_credentials=True``."""

    def test_credential_commands_issued_in_cloud_mode(self, tmp_path):
        """configure_credentials + GitHub token -> remote URL, credential helper, and file write."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        assert any("git remote set-url" in c for c in backend.commands)
        assert any("credential.helper" in c for c in backend.commands)
        assert any(".git-credentials" in c for c in backend.commands)

    def test_remote_url_cleaned_to_tokenless_url(self, tmp_path):
        """git remote set-url uses the clean URL (no embedded token)."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        set_url_cmd = _find_command(backend.commands, "git remote set-url")
        assert "https://github.com/org/repo.git" in set_url_cmd
        assert "ghp_tok" not in set_url_cmd

    def test_credential_file_has_correct_format(self, tmp_path):
        """Credential file written with git-credential-store format."""
        token = "ghp_testtoken123"
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {"GITHUB_TOKEN": token},
            is_local_mode=False, configure_credentials=True,
        )

        cred_write_cmds = [
            c for c in backend.commands
            if ".git-credentials" in c and ">" in c
        ]
        assert cred_write_cmds, "No credential file write command found"
        cred_cmd = cred_write_cmds[0]
        assert f"x-access-token:{token}@github.com" in cred_cmd
        assert "chmod 600" in cred_cmd

    def test_git_credentials_configured_true_on_result(self, tmp_path):
        """GitMetadata.git_credentials_configured is True after successful setup."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        result = git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        assert result.git_metadata is not None
        assert result.git_metadata.git_credentials_configured is True

    def test_skipped_in_local_mode(self, tmp_path):
        """Local mode + token -> no credential commands, field is False."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        result = git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"}, is_local_mode=True,
        )

        assert not any("git remote set-url" in c for c in backend.commands)
        assert not any("credential.helper" in c for c in backend.commands)
        assert result.git_metadata is not None
        assert result.git_metadata.git_credentials_configured is False

    def test_skipped_without_token(self, tmp_path):
        """configure_credentials + no token -> no credential commands, field is False."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        result = git_source.provision(
            source, backend, {},
            is_local_mode=False, configure_credentials=True,
        )

        assert not any("git remote set-url" in c for c in backend.commands)
        assert result.git_metadata is not None
        assert result.git_metadata.git_credentials_configured is False

    def test_skipped_for_non_github_url(self, tmp_path):
        """Non-GitHub URL + token + configure_credentials -> no credential commands."""
        source = _MockGitRepoSource(url="https://gitlab.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        assert not any("git remote set-url" in c for c in backend.commands)
        assert not any("credential.helper" in c for c in backend.commands)

    def test_configured_on_existing_repo(self, tmp_path):
        """Idempotent path + configure_credentials + token -> credentials configured."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        result = git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        assert not any("git clone" in c for c in backend.commands)
        assert any("git remote set-url" in c for c in backend.commands)
        assert any("credential.helper" in c for c in backend.commands)
        assert result.git_metadata is not None
        assert result.git_metadata.git_credentials_configured is True

    def test_existing_repo_no_credentials_in_local_mode(self, tmp_path):
        """Idempotent + local mode + token -> no credential setup."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            _DETECT_CMD_KEY: ExecuteResult(
                exit_code=0, stdout="dir\n", stderr="",
            ),
        })

        result = git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"}, is_local_mode=True,
        )

        assert not any("git remote set-url" in c for c in backend.commands)
        assert result.git_metadata is not None
        assert result.git_metadata.git_credentials_configured is False

    def test_non_fatal_on_remote_url_cleanup_failure(self, tmp_path):
        """Remote URL cleanup failure -> clone succeeds, field is False."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path, responses={
            "git remote set-url": ExecuteResult(
                exit_code=1, stdout="", stderr="error: could not set url",
            ),
        })

        result = git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        assert result.source_type is SourceType.GIT_REPO
        assert result.git_metadata is not None
        assert result.git_metadata.git_credentials_configured is False

    def test_non_fatal_on_credential_config_failure(self, tmp_path):
        """Credential helper config failure -> clone succeeds, field is False."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path, responses={
            "credential.helper": ExecuteResult(
                exit_code=1, stdout="", stderr="error: could not lock config",
            ),
        })

        result = git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        assert result.source_type is SourceType.GIT_REPO
        assert result.git_metadata is not None
        assert result.git_metadata.git_credentials_configured is False

    def test_credential_setup_runs_after_clone_and_excludes(self, tmp_path):
        """Credential commands come after clone and excludes in command order."""
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _CloudGitBackend(tmp_path)

        git_source.provision(
            source, backend, {"GITHUB_TOKEN": "ghp_tok"},
            is_local_mode=False, configure_credentials=True,
        )

        clone_idx = None
        excludes_idx = None
        cred_idx = None
        for i, cmd in enumerate(backend.commands):
            if "git clone" in cmd and clone_idx is None:
                clone_idx = i
            if "--absolute-git-dir" in cmd and excludes_idx is None:
                excludes_idx = i
            if "git remote set-url" in cmd and cred_idx is None:
                cred_idx = i

        assert clone_idx is not None, "git clone not found"
        assert excludes_idx is not None, "excludes setup not found"
        assert cred_idx is not None, "credential setup not found"
        assert clone_idx < excludes_idx < cred_idx, (
            f"Expected clone ({clone_idx}) < excludes ({excludes_idx}) "
            f"< credentials ({cred_idx})"
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _find_command(commands: list[str], prefix: str) -> str:
    """Find the first command containing *prefix*."""
    for cmd in commands:
        if prefix in cmd:
            return cmd
    raise AssertionError(
        f"No command containing '{prefix}' found in: {commands}"
    )
