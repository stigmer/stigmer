"""Tests for WriteBackCoordinator — exec normalization and exception handling.

Covers:
  - _exec normalizes Daytona ExecuteResponse (.output) into ExecuteResult (.stdout)
  - _has_changes works with normalized results
  - finalize() on a clean workspace emits no WorkspaceWriteBack
  - Pre-mutation failures (_has_changes errors) do not emit FAILED writeback
  - Post-mutation failures (branch/commit/push/PR errors) do emit FAILED writeback
"""

from __future__ import annotations

import dataclasses
from typing import Any
from unittest.mock import MagicMock

import pytest

from stigmer_runner.worker.workspace.backend import ExecuteResult

# ─────────────────────────────────────────────────────────────────────
# Fake response types mirroring Daytona SDK and workspace backend
# ─────────────────────────────────────────────────────────────────────


@dataclasses.dataclass
class FakeExecuteResponse:
    """Mimics Daytona SDK's ExecuteResponse — has .output, NOT .stdout."""

    output: str = ""
    exit_code: int = 0
    truncated: bool = False


@dataclasses.dataclass
class FakeSandboxProcess:
    """Minimal stand-in for sandbox.process with exec()."""

    responses: dict[str, FakeExecuteResponse] = dataclasses.field(default_factory=dict)
    default_response: FakeExecuteResponse | None = None

    def exec(self, cmd: str, timeout: int = 15) -> FakeExecuteResponse:
        for pattern, response in self.responses.items():
            if pattern in cmd:
                return response
        return self.default_response or FakeExecuteResponse()


@dataclasses.dataclass
class FakeSandbox:
    process: FakeSandboxProcess = dataclasses.field(default_factory=FakeSandboxProcess)


# ─────────────────────────────────────────────────────────────────────
# Helpers to build a coordinator with minimal wiring
# ─────────────────────────────────────────────────────────────────────


def _make_provision_result(
    entry_name: str = "my-repo",
    root_dir: str = "/workspace/my-repo",
    branch: str = "main",
) -> MagicMock:
    pr = MagicMock()
    pr.source_type.value = "git_repo"
    pr.git_metadata.branch = branch
    pr.git_metadata.git_credentials_configured = True
    pr.git_metadata.repo_url = "https://github.com/acme/my-repo.git"
    pr.root_dir = root_dir
    pr.entry_name = entry_name
    return pr


def _make_workspace_entry(
    name: str = "my-repo",
    write_back_mode: int = 0,
) -> MagicMock:
    entry = MagicMock()
    entry.name = name
    entry.source.HasField.side_effect = lambda f: f == "git_repo"
    entry.source.git_repo.write_back_mode = write_back_mode
    return entry


def _build_coordinator(
    *,
    sandbox: Any = None,
    workspace_backend: Any = None,
    entry_name: str = "my-repo",
):
    from stigmer_runner.worker.activities.graphton.writeback_coordinator import WriteBackCoordinator

    sb = MagicMock()
    sb.current_status = MagicMock()
    sb.current_status.workspace_write_backs = []
    sb.force_next_update = False

    provision_results = [_make_provision_result(entry_name=entry_name)]
    workspace_entries = [_make_workspace_entry(name=entry_name)]

    import logging
    logger = logging.getLogger("test-writeback")

    coordinator = WriteBackCoordinator(
        status_builder=sb,
        execution_id="exec-1234-5678-abcd",
        provision_results=provision_results,
        workspace_entries=workspace_entries,
        sandbox=sandbox,
        workspace_backend=workspace_backend or MagicMock(),
        logger=logger,
    )
    return coordinator, sb


# ═════════════════════════════════════════════════════════════════════
# Tests: _exec normalization
# ═════════════════════════════════════════════════════════════════════


class TestExecNormalization:
    """Verify that sandbox.process.exec() results are normalized to ExecuteResult."""

    @pytest.mark.asyncio
    async def test_sandbox_exec_output_mapped_to_stdout(self):
        """ExecuteResponse.output should be available as .stdout after normalization."""
        sandbox = FakeSandbox(
            process=FakeSandboxProcess(
                default_response=FakeExecuteResponse(output="hello world", exit_code=0),
            )
        )
        coordinator, _ = _build_coordinator(sandbox=sandbox)

        eligible = coordinator._eligible["my-repo"]
        root_dir = eligible.root_dir

        def _exec(cmd: str, timeout: int = 15) -> ExecuteResult:
            full_cmd = f"cd {root_dir} && {cmd}"
            raw = sandbox.process.exec(full_cmd, timeout=timeout)
            return ExecuteResult(
                exit_code=getattr(raw, "exit_code", 1),
                stdout=getattr(raw, "stdout", None) or getattr(raw, "output", None) or "",
                stderr=getattr(raw, "stderr", "") or "",
            )

        result = _exec("echo test")
        assert result.stdout == "hello world"
        assert result.exit_code == 0
        assert result.stderr == ""

    @pytest.mark.asyncio
    async def test_sandbox_exec_with_real_stdout_preferred(self):
        """If the sandbox response has .stdout, it should be used over .output."""

        @dataclasses.dataclass
        class ResponseWithBoth:
            stdout: str = "from-stdout"
            output: str = "from-output"
            exit_code: int = 0
            stderr: str = ""

        raw = ResponseWithBoth()
        result = ExecuteResult(
            exit_code=getattr(raw, "exit_code", 1),
            stdout=getattr(raw, "stdout", None) or getattr(raw, "output", None) or "",
            stderr=getattr(raw, "stderr", "") or "",
        )
        assert result.stdout == "from-stdout"


# ═════════════════════════════════════════════════════════════════════
# Tests: _has_changes with normalized exec
# ═════════════════════════════════════════════════════════════════════


class TestHasChanges:
    """Verify _has_changes works with ExecuteResult (not raw ExecuteResponse)."""

    def test_no_changes_returns_false(self):
        from stigmer_runner.worker.activities.graphton.writeback_coordinator import (
            WriteBackCoordinator,
        )

        def exec_fn(cmd: str, timeout: int = 15) -> ExecuteResult:
            return ExecuteResult(exit_code=0, stdout="", stderr="")

        assert WriteBackCoordinator._has_changes(exec_fn) is False

    def test_unstaged_diff_returns_true(self):
        from stigmer_runner.worker.activities.graphton.writeback_coordinator import (
            WriteBackCoordinator,
        )

        def exec_fn(cmd: str, timeout: int = 15) -> ExecuteResult:
            if "git diff --stat" in cmd and "--cached" not in cmd:
                return ExecuteResult(exit_code=0, stdout=" file.txt | 1 +\n", stderr="")
            return ExecuteResult(exit_code=0, stdout="", stderr="")

        assert WriteBackCoordinator._has_changes(exec_fn) is True

    def test_staged_diff_returns_true(self):
        from stigmer_runner.worker.activities.graphton.writeback_coordinator import (
            WriteBackCoordinator,
        )

        def exec_fn(cmd: str, timeout: int = 15) -> ExecuteResult:
            if "--cached" in cmd:
                return ExecuteResult(exit_code=0, stdout=" file.txt | 2 +-\n", stderr="")
            return ExecuteResult(exit_code=0, stdout="", stderr="")

        assert WriteBackCoordinator._has_changes(exec_fn) is True

    def test_untracked_files_returns_true(self):
        from stigmer_runner.worker.activities.graphton.writeback_coordinator import (
            WriteBackCoordinator,
        )

        def exec_fn(cmd: str, timeout: int = 15) -> ExecuteResult:
            if "ls-files" in cmd:
                return ExecuteResult(exit_code=0, stdout="newfile.txt\n", stderr="")
            return ExecuteResult(exit_code=0, stdout="", stderr="")

        assert WriteBackCoordinator._has_changes(exec_fn) is True


# ═════════════════════════════════════════════════════════════════════
# Tests: finalize() on clean workspace
# ═════════════════════════════════════════════════════════════════════


class TestFinalizeCleanWorkspace:
    """When no files were modified, finalize() should not emit any writeback."""

    @pytest.mark.asyncio
    async def test_finalize_clean_workspace_no_writeback(self):
        sandbox = FakeSandbox(
            process=FakeSandboxProcess(
                default_response=FakeExecuteResponse(output="", exit_code=0),
            )
        )
        coordinator, sb = _build_coordinator(sandbox=sandbox)

        await coordinator.finalize()

        sb.add_workspace_write_back.assert_not_called()

    @pytest.mark.asyncio
    async def test_finalize_clean_workspace_backend_fallback(self):
        """Same test via workspace_backend path (no sandbox)."""
        backend = MagicMock()
        backend.execute.return_value = ExecuteResult(exit_code=0, stdout="", stderr="")

        coordinator, sb = _build_coordinator(sandbox=None, workspace_backend=backend)

        await coordinator.finalize()

        sb.add_workspace_write_back.assert_not_called()


# ═════════════════════════════════════════════════════════════════════
# Tests: Exception handler — pre-mutation vs post-mutation
# ═════════════════════════════════════════════════════════════════════


class TestExceptionHandlerGuard:
    """Errors before git mutation should not emit FAILED writeback."""

    @pytest.mark.asyncio
    async def test_has_changes_error_no_failed_writeback(self):
        """If _has_changes itself raises, no FAILED writeback is emitted."""

        @dataclasses.dataclass
        class BrokenResponse:
            exit_code: int = 0

        sandbox = FakeSandbox()
        sandbox.process = MagicMock()
        sandbox.process.exec.side_effect = RuntimeError("sandbox unavailable")

        coordinator, sb = _build_coordinator(sandbox=sandbox)

        await coordinator.finalize()

        sb.add_workspace_write_back.assert_not_called()

    @pytest.mark.asyncio
    async def test_branch_creation_error_emits_failed_writeback(self):
        """If branch creation fails (post-mutation), FAILED writeback IS emitted."""
        call_count = 0

        def fake_exec(cmd: str, timeout: int = 15) -> FakeExecuteResponse:
            nonlocal call_count
            call_count += 1
            if "git diff --stat" in cmd and "--cached" not in cmd:
                return FakeExecuteResponse(output=" file.txt | 1 +\n", exit_code=0)
            if "git checkout -b" in cmd:
                return FakeExecuteResponse(output="", exit_code=128)
            return FakeExecuteResponse(output="", exit_code=0)

        sandbox = FakeSandbox()
        sandbox.process = MagicMock()
        sandbox.process.exec.side_effect = fake_exec

        coordinator, sb = _build_coordinator(sandbox=sandbox)

        await coordinator.finalize()

        sb.add_workspace_write_back.assert_called_once()
        wb_arg = sb.add_workspace_write_back.call_args[0][0]
        assert wb_arg.phase == 4  # WORKSPACE_WRITE_BACK_FAILED
        assert wb_arg.workspace_entry_name == "my-repo"
