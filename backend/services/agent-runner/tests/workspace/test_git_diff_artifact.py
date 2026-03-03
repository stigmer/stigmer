"""Tests for _generate_git_diff_artifact — multi-entry cwd scoping and naming.

Covers Phase 4 changes:
- Per-entry cwd computation from provision_result.root_dir vs backend root
- Multi-entry patch artifact naming ({execution_id}-{entry_name}.patch)
- Backward-compatible single-entry naming ({execution_id}.patch)
- Non-git entries are skipped
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from worker.activities.execute_graphton import _generate_git_diff_artifact
from worker.workspace.provisioner import (
    GitMetadata,
    ProvisionResult,
    SourceType,
)

# ---------------------------------------------------------------------------
# Mock types (duck-typed, minimal surface)
# ---------------------------------------------------------------------------


@dataclass
class _MockExecuteResult:
    exit_code: int
    stdout: str
    stderr: str


class _MockBackend:
    """Minimal WorkspaceBackend tracking (command, cwd) pairs."""

    def __init__(self, root_dir: str, *, diff_output: str = "", platform_dir: str | None = None):
        self._root_dir = root_dir
        self._diff_output = diff_output
        self._platform_dir = platform_dir
        self.execute_records: list[tuple[str, str | None]] = []

    @property
    def root_dir(self) -> str:
        return self._root_dir

    @property
    def platform_dir(self) -> str | None:
        return self._platform_dir

    def execute(self, command: str, *, cwd: str | None = None, timeout: int = 30):
        self.execute_records.append((command, cwd))
        return _MockExecuteResult(
            exit_code=0, stdout=self._diff_output, stderr="",
        )


class _MockStorage:
    """Records upload calls."""

    def __init__(self):
        self.uploads: list[tuple[str, bytes, str]] = []

    def upload(self, key: str, content: bytes, content_type: str) -> str:
        self.uploads.append((key, content, content_type))
        return key

    def get_download_url(self, key: str, expires_in: int = 604800) -> str:
        return f"https://mock-storage/{key}"


class _MockStatusBuilder:
    """Records add_artifact calls."""

    def __init__(self):
        self.artifacts: list[object] = []

    def add_artifact(self, artifact: object) -> None:
        self.artifacts.append(artifact)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _git_result(
    root_dir: str = "/workspace",
    entry_name: str = "",
) -> ProvisionResult:
    return ProvisionResult(
        root_dir=root_dir,
        source_type=SourceType.GIT_REPO,
        consumed_keys=(),
        workspace_description="test workspace",
        git_metadata=GitMetadata(
            repo_url="https://github.com/org/repo.git",
            branch="main",
            base_commit="abc1234",
        ),
        entry_name=entry_name,
    )


_LOG = logging.getLogger("test_git_diff_artifact")


# ---------------------------------------------------------------------------
# cwd scoping
# ---------------------------------------------------------------------------


class TestGitDiffCwd:
    """git diff command receives correct cwd for subdirectory entries."""

    def test_same_root_passes_no_cwd(self):
        backend = _MockBackend("/workspace", diff_output="diff --git a/f b/f\n")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = _git_result(root_dir="/workspace")

        _generate_git_diff_artifact(
            backend, pr, "exec-1", storage, status, _LOG,
        )

        assert len(backend.execute_records) == 1
        _, cwd = backend.execute_records[0]
        assert cwd is None

    def test_subdirectory_passes_cwd(self):
        backend = _MockBackend("/workspace", diff_output="diff --git a/f b/f\n")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = _git_result(root_dir="/workspace/my-app", entry_name="my-app")

        _generate_git_diff_artifact(
            backend, pr, "exec-1", storage, status, _LOG,
        )

        assert len(backend.execute_records) == 1
        _, cwd = backend.execute_records[0]
        assert cwd == "my-app"

    def test_nested_subdirectory_cwd(self):
        backend = _MockBackend("/workspace", diff_output="diff --git a/f b/f\n")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = _git_result(
            root_dir="/workspace/services/api", entry_name="services-api",
        )

        _generate_git_diff_artifact(
            backend, pr, "exec-1", storage, status, _LOG,
        )

        assert len(backend.execute_records) == 1
        _, cwd = backend.execute_records[0]
        assert cwd == "services/api"


# ---------------------------------------------------------------------------
# Patch artifact naming
# ---------------------------------------------------------------------------


class TestGitDiffPatchNaming:
    """Patch filename includes entry_name for multi-entry sessions."""

    def test_no_entry_name_uses_plain_filename(self):
        backend = _MockBackend("/workspace", diff_output="diff --git a/f b/f\n")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = _git_result(entry_name="")

        _generate_git_diff_artifact(
            backend, pr, "exec-42", storage, status, _LOG,
        )

        assert len(storage.uploads) == 1
        key, _, _ = storage.uploads[0]
        assert key == "artifacts/exec-42/exec-42.patch"

    def test_entry_name_included_in_filename(self):
        backend = _MockBackend("/workspace", diff_output="diff --git a/f b/f\n")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = _git_result(
            root_dir="/workspace/frontend", entry_name="frontend",
        )

        _generate_git_diff_artifact(
            backend, pr, "exec-42", storage, status, _LOG,
        )

        assert len(storage.uploads) == 1
        key, _, _ = storage.uploads[0]
        assert key == "artifacts/exec-42/exec-42-frontend.patch"


# ---------------------------------------------------------------------------
# Non-git entries and empty diffs
# ---------------------------------------------------------------------------


class TestGitDiffSkipConditions:
    """Non-git entries and empty diffs are handled correctly."""

    def test_non_git_source_returns_false(self):
        backend = _MockBackend("/workspace")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = ProvisionResult(
            root_dir="/workspace",
            source_type=SourceType.LOCAL_PATH,
            consumed_keys=(),
            workspace_description="local",
        )

        result = _generate_git_diff_artifact(
            backend, pr, "exec-1", storage, status, _LOG,
        )

        assert result is False
        assert len(backend.execute_records) == 0

    def test_empty_diff_returns_false(self):
        backend = _MockBackend("/workspace", diff_output="")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = _git_result()

        result = _generate_git_diff_artifact(
            backend, pr, "exec-1", storage, status, _LOG,
        )

        assert result is False
        assert len(storage.uploads) == 0

    def test_successful_diff_returns_true(self):
        backend = _MockBackend("/workspace", diff_output="diff --git a/f b/f\n")
        storage = _MockStorage()
        status = _MockStatusBuilder()
        pr = _git_result()

        result = _generate_git_diff_artifact(
            backend, pr, "exec-1", storage, status, _LOG,
        )

        assert result is True
        assert len(storage.uploads) == 1
        assert len(status.artifacts) == 1
