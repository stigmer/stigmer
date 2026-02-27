"""Tests for the git workspace source handler."""

from __future__ import annotations

import pytest

from worker.workspace.backend import ExecuteResult
from worker.workspace.local import LocalWorkspaceBackend
from worker.workspace.provisioner import (
    SourceType,
    WorkspaceProvisionError,
)
from worker.workspace.sources import git as git_source

# ---------------------------------------------------------------------------
# Mock proto + backend helpers
# ---------------------------------------------------------------------------


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

        self._responses: dict[str, ExecuteResult] = {
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="no\n", stderr="",
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
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="yes\n", stderr="",
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
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="yes\n", stderr="",
            ),
        })

        result = git_source.provision(source, backend, {"GITHUB_TOKEN": "tok"})

        assert "GITHUB_TOKEN" in result.consumed_keys

    def test_existing_repo_empty_consumed_keys_when_no_token(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="yes\n", stderr="",
            ),
        })

        result = git_source.provision(source, backend, {})

        assert result.consumed_keys == ()

    def test_corrupted_workspace_cleaned_and_recloned(self, tmp_path):
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="no\n", stderr="",
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
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="no\n", stderr="",
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
    """Platform directories added to .git/info/exclude."""

    def test_excludes_written_after_fresh_clone(self, tmp_path):
        (tmp_path / ".git" / "info").mkdir(parents=True)
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path)

        git_source.provision(source, backend, {})

        exclude_content = (tmp_path / ".git" / "info" / "exclude").read_text()
        assert ".stigmer" in exclude_content

    def test_excludes_written_for_existing_repo(self, tmp_path):
        (tmp_path / ".git" / "info").mkdir(parents=True)
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="yes\n", stderr="",
            ),
        })

        git_source.provision(source, backend, {})

        exclude_content = (tmp_path / ".git" / "info" / "exclude").read_text()
        assert ".stigmer" in exclude_content

    def test_excludes_idempotent_no_duplicates(self, tmp_path):
        git_info = tmp_path / ".git" / "info"
        git_info.mkdir(parents=True)
        (git_info / "exclude").write_text(".stigmer\n")

        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="yes\n", stderr="",
            ),
        })

        git_source.provision(source, backend, {})

        exclude_content = (git_info / "exclude").read_text()
        assert exclude_content.count(".stigmer") == 1

    def test_excludes_appended_to_existing_content(self, tmp_path):
        git_info = tmp_path / ".git" / "info"
        git_info.mkdir(parents=True)
        (git_info / "exclude").write_text("# git default excludes\n*.pyc\n")

        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="yes\n", stderr="",
            ),
        })

        git_source.provision(source, backend, {})

        exclude_content = (git_info / "exclude").read_text()
        assert "*.pyc" in exclude_content
        assert ".stigmer" in exclude_content


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

    def test_non_empty_no_git_recovers_and_clones(self, tmp_path):
        """Non-empty workspace without .git is cleaned and re-provisioned."""
        (tmp_path / "partial-file.txt").write_text("leftover from crash")
        source = _MockGitRepoSource(url="https://github.com/org/repo.git")
        backend = _GitBackend(tmp_path, responses={
            "test -d .git && echo yes || echo no": ExecuteResult(
                exit_code=0, stdout="no\n", stderr="",
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
# Helpers
# ---------------------------------------------------------------------------


def _find_command(commands: list[str], prefix: str) -> str:
    """Find the first command starting with *prefix*."""
    for cmd in commands:
        if cmd.startswith(prefix):
            return cmd
    raise AssertionError(
        f"No command starting with '{prefix}' found in: {commands}"
    )
