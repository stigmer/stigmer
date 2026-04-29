"""Incremental git write-back coordinator for workspace entries.

During agent execution, each file-modifying tool call (write, edit)
triggers an incremental commit-and-push cycle for the affected git
workspace.  The first cycle creates the branch and PR; subsequent
cycles add commits to the same branch — the PR updates automatically
on GitHub.

This replaces the batch ``writeback.py`` approach where all git
operations happened after the LangGraph stream ended.  The user now
sees the PR link the moment the first file is written, and watches
the diff grow in real time.

Lifecycle:
    1.  Created after workspace provisioning in ``execute_graphton``.
    2.  ``on_file_modified(path)`` called from ``StreamExecutor`` on
        each ``on_tool_end`` for file-modifying tools.
    3.  ``finalize()`` called from ``post_stream`` as a safety net.

Concurrency: one ``asyncio.Lock`` per workspace entry serializes
git operations.  Background tasks spawned by ``StreamExecutor``
are tracked in ``pending_tasks`` so ``post_stream`` can drain them
before calling ``finalize()``.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
from typing import TYPE_CHECKING, Any

import httpx
from ai.stigmer.agentic.agentexecution.v1.writeback_pb2 import (
    WorkspaceWriteBack,
    WorkspaceWriteBackPhase,
)
from ai.stigmer.agentic.session.v1.enum_pb2 import (
    GIT_WRITE_BACK_BRANCH_AND_PR,
    GIT_WRITE_BACK_MODE_UNSPECIFIED,
)
from graphton.core.github_api import (
    github_create_pr,
    parse_github_repo,
    parse_token_from_credentials,
)

from stigmer_runner.worker.workspace.backend import ExecuteResult

# Write-back modes treated as "enabled" by the platform.
# UNSPECIFIED = platform decides (currently: enabled when credentials exist).
# BRANCH_AND_PR = explicit opt-in.
# Any future opt-out enum (e.g. DISABLED = 2) is excluded automatically.
_WRITE_BACK_ENABLED_MODES: frozenset[int] = frozenset({
    GIT_WRITE_BACK_MODE_UNSPECIFIED,
    GIT_WRITE_BACK_BRANCH_AND_PR,
})

if TYPE_CHECKING:
    from stigmer_runner.worker.activities.graphton.status_builder import StatusBuilder
    from stigmer_runner.worker.workspace import ProvisionResult

_CREDENTIAL_FILE = "/home/daytona/.git-credentials"


@dataclasses.dataclass
class _EntryState:
    """Mutable per-workspace state tracked across incremental cycles."""

    branch_created: bool = False
    pr_created: bool = False
    pr_url: str = ""
    pr_number: int = 0
    commit_count: int = 0
    last_commit_sha: str = ""
    github_token: str = ""
    github_owner: str = ""
    github_repo: str = ""


@dataclasses.dataclass(frozen=True)
class _EligibleEntry:
    """Immutable descriptor for a workspace entry eligible for write-back."""

    provision_result: Any  # ProvisionResult
    base_branch: str
    root_dir: str
    entry_name: str


class WriteBackCoordinator:
    """Manages incremental git write-back for workspace entries during execution.

    Thread-safe (via asyncio locks) and idempotent: calling
    ``on_file_modified`` when there are no uncommitted changes is a no-op.
    """

    def __init__(
        self,
        *,
        status_builder: StatusBuilder,
        execution_id: str,
        provision_results: list[ProvisionResult],
        workspace_entries: list[Any],
        sandbox: Any,
        workspace_backend: Any,
        logger: logging.Logger,
    ) -> None:
        self._sb = status_builder
        self._execution_id = execution_id
        self._sandbox = sandbox
        self._workspace_backend = workspace_backend
        self._log = logger
        self._short_id = execution_id[:8]
        self._branch_name = f"stigmer/{self._short_id}"

        self._eligible: dict[str, _EligibleEntry] = {}
        self._state: dict[str, _EntryState] = {}
        self._locks: dict[str, asyncio.Lock] = {}

        self._pending: set[asyncio.Task[None]] = set()

        self._init_eligible_entries(provision_results, workspace_entries)

    @property
    def has_eligible_entries(self) -> bool:
        """True when at least one workspace entry is configured for write-back."""
        return len(self._eligible) > 0

    @property
    def pending_tasks(self) -> set[asyncio.Task[None]]:
        """Background write-back tasks not yet completed."""
        self._pending = {t for t in self._pending if not t.done()}
        return set(self._pending)

    def track_task(self, task: asyncio.Task[None]) -> None:
        """Register a background task for later draining."""
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def on_file_modified(self, path: str) -> None:
        """Called after a file-modifying tool completes.

        Resolves *path* to a workspace entry and runs an incremental
        commit/push cycle.  No-op if the path is not in an eligible
        workspace or there are no uncommitted changes.
        """
        entry_name = self._resolve_entry(path)
        if entry_name is None:
            return

        async with self._locks[entry_name]:
            await self._incremental_write_back(entry_name)

    async def finalize(self) -> None:
        """Post-execution safety net.

        Checks every eligible workspace entry for remaining uncommitted
        changes and commits/pushes them.  Catches files modified by
        shell commands or other paths not triggered by ``on_file_modified``.
        """
        for entry_name in self._eligible:
            try:
                async with self._locks[entry_name]:
                    await self._incremental_write_back(entry_name)
            except Exception as exc:
                self._log.warning(
                    "[WRITE_BACK] execution=%s entry=%s — finalize error: %s",
                    self._execution_id, entry_name, exc,
                )

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def _init_eligible_entries(
        self,
        provision_results: list[Any],
        workspace_entries: list[Any],
    ) -> None:
        """Build the lookup of eligible workspace entries."""
        mode_map: dict[str, int] = {}
        for entry in workspace_entries:
            source = entry.source
            if source.HasField("git_repo"):
                mode_map[entry.name] = source.git_repo.write_back_mode

        for pr in provision_results:
            if pr.source_type.value != "git_repo":
                continue
            if pr.git_metadata is None:
                continue
            if not pr.git_metadata.git_credentials_configured:
                continue
            if mode_map.get(pr.entry_name, 0) not in _WRITE_BACK_ENABLED_MODES:
                continue

            self._eligible[pr.entry_name] = _EligibleEntry(
                provision_result=pr,
                base_branch=pr.git_metadata.branch,
                root_dir=pr.root_dir,
                entry_name=pr.entry_name,
            )
            self._state[pr.entry_name] = _EntryState()
            self._locks[pr.entry_name] = asyncio.Lock()

        if self._eligible:
            self._log.info(
                "[WRITE_BACK] execution=%s — coordinator initialized with "
                "%d eligible workspace(s): %s",
                self._execution_id,
                len(self._eligible),
                list(self._eligible.keys()),
            )

    # ------------------------------------------------------------------
    # Path resolution
    # ------------------------------------------------------------------

    def _resolve_entry(self, path: str) -> str | None:
        """Map a tool-call path to the owning workspace entry name.

        For single-entry sessions the tool path is relative to the
        backend root which equals the entry's ``root_dir``.  For
        multi-entry sessions each entry sits under
        ``{backend_root}/{entry_name}/``, so the path prefix determines
        ownership.

        Returns ``None`` when the path does not fall inside any eligible
        workspace or when there is only one eligible entry (skip the
        resolution and return it directly).
        """
        if not self._eligible:
            return None

        if len(self._eligible) == 1:
            return next(iter(self._eligible))

        normalized = path.lstrip("/")
        for entry_name in self._eligible:
            prefix = entry_name + "/"
            if normalized.startswith(prefix) or normalized == entry_name:
                return entry_name

        return None

    # ------------------------------------------------------------------
    # Core incremental write-back
    # ------------------------------------------------------------------

    async def _incremental_write_back(self, entry_name: str) -> None:
        """Run one commit/push cycle for a single workspace entry.

        Creates branch and PR on first invocation; subsequent calls add
        commits to the existing branch.
        """
        eligible = self._eligible[entry_name]
        state = self._state[entry_name]
        root_dir = eligible.root_dir

        def _exec(cmd: str, timeout: int = 15) -> ExecuteResult:
            full_cmd = f"cd {root_dir} && {cmd}"
            if self._sandbox is not None:
                raw = self._sandbox.process.exec(full_cmd, timeout=timeout)
                return ExecuteResult(
                    exit_code=getattr(raw, "exit_code", 1),
                    stdout=getattr(raw, "stdout", None) or getattr(raw, "output", None) or "",
                    stderr=getattr(raw, "stderr", "") or "",
                )
            return self._workspace_backend.execute(full_cmd, timeout=timeout)

        mutation_started = False
        try:
            if not self._has_changes(_exec):
                return

            mutation_started = True

            if not state.branch_created:
                await self._create_branch(entry_name, state, _exec)

            commit_msg = f"agent changes ({state.commit_count + 1})"
            await self._commit_and_push(entry_name, state, _exec, commit_msg)

            if not state.pr_created:
                await self._create_pr(entry_name, state, eligible, _exec)

            self._update_status(entry_name, state, eligible, _exec)

        except Exception as exc:
            self._log.warning(
                "[WRITE_BACK] execution=%s entry=%s — incremental error: %s",
                self._execution_id, entry_name, exc,
            )
            if not mutation_started:
                return
            wb = WorkspaceWriteBack(
                workspace_entry_name=entry_name,
                base_branch=eligible.base_branch,
                branch_name=self._branch_name if state.branch_created else "",
                phase=WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED,
                error=str(exc),
            )
            if state.pr_created:
                wb.pull_request_url = state.pr_url
                wb.pull_request_number = state.pr_number
            self._sb.add_workspace_write_back(wb)

    # ------------------------------------------------------------------
    # Git operations
    # ------------------------------------------------------------------

    @staticmethod
    def _has_changes(exec_fn: Any) -> bool:
        """Return True when the working tree has uncommitted changes."""
        diff = exec_fn("git diff --stat")
        staged = exec_fn("git diff --cached --stat")

        if (diff.stdout and diff.stdout.strip()) or (
            staged.stdout and staged.stdout.strip()
        ):
            return True

        untracked = exec_fn("git ls-files --others --exclude-standard")
        return bool(untracked.stdout and untracked.stdout.strip())

    async def _create_branch(
        self,
        entry_name: str,
        state: _EntryState,
        exec_fn: Any,
    ) -> None:
        result = exec_fn(f"git checkout -b {self._branch_name}")
        if result.exit_code != 0:
            raise RuntimeError(f"Failed to create branch: {result.stderr}")
        state.branch_created = True
        self._log.info(
            "[WRITE_BACK] execution=%s entry=%s — created branch %s",
            self._execution_id, entry_name, self._branch_name,
        )

    async def _commit_and_push(
        self,
        entry_name: str,
        state: _EntryState,
        exec_fn: Any,
        commit_msg: str,
    ) -> None:
        exec_fn("git add -A")

        commit_result = exec_fn(
            f'git commit -m "{commit_msg}"',
            timeout=30,
        )
        if commit_result.exit_code != 0:
            raise RuntimeError(f"Failed to commit: {commit_result.stderr}")

        state.commit_count += 1

        sha_result = exec_fn("git rev-parse HEAD")
        state.last_commit_sha = (sha_result.stdout or "").strip()

        if state.commit_count == 1:
            push_result = exec_fn(
                f"git push -u origin {self._branch_name}",
                timeout=60,
            )
        else:
            push_result = exec_fn("git push", timeout=60)

        if push_result.exit_code != 0:
            raise RuntimeError(f"Failed to push: {push_result.stderr}")

        self._log.info(
            "[WRITE_BACK] execution=%s entry=%s — commit #%d pushed "
            "(sha=%s)",
            self._execution_id,
            entry_name,
            state.commit_count,
            state.last_commit_sha[:12],
        )

    async def _create_pr(
        self,
        entry_name: str,
        state: _EntryState,
        eligible: _EligibleEntry,
        exec_fn: Any,
    ) -> None:
        meta = eligible.provision_result.git_metadata

        try:
            owner, repo = parse_github_repo(meta.repo_url)
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc

        if not state.github_token:
            cred_result = exec_fn(f"cat {_CREDENTIAL_FILE}", timeout=5)
            if cred_result.exit_code != 0:
                raise RuntimeError("Git credentials not available for PR creation")
            state.github_token = parse_token_from_credentials(cred_result.stdout)
            state.github_owner = owner
            state.github_repo = repo

        pr_title = f"Agent changes ({self._short_id})"
        pr_body = (
            f"Automated pull request from Stigmer agent execution.\n\n"
            f"**Execution:** `{self._execution_id}`\n"
            f"**Workspace:** `{entry_name}`\n"
        )

        try:
            pr_data = await github_create_pr(
                token=state.github_token,
                owner=state.github_owner,
                repo=state.github_repo,
                title=pr_title,
                body=pr_body,
                head=self._branch_name,
                base=eligible.base_branch,
            )
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            try:
                error_body = exc.response.json()
                message = error_body.get("message", str(exc))
            except Exception:
                message = str(exc)
            raise RuntimeError(
                f"GitHub API error (HTTP {status_code}): {message}"
            ) from exc
        except httpx.TimeoutException as exc:
            raise RuntimeError("GitHub API request timed out") from exc

        state.pr_created = True
        state.pr_url = pr_data.get("html_url", "")
        state.pr_number = pr_data.get("number", 0)

        self._log.info(
            "[WRITE_BACK] execution=%s entry=%s — PR #%d created: %s",
            self._execution_id,
            entry_name,
            state.pr_number,
            state.pr_url,
        )

    def _update_status(
        self,
        entry_name: str,
        state: _EntryState,
        eligible: _EligibleEntry,
        exec_fn: Any,
    ) -> None:
        """Build and publish a WorkspaceWriteBack proto to the status builder."""
        summary_result = exec_fn(
            f"git diff --stat {eligible.base_branch}...HEAD"
        )

        phase = (
            WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED
            if state.pr_created
            else WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED
        )

        wb = WorkspaceWriteBack(
            workspace_entry_name=entry_name,
            branch_name=self._branch_name,
            base_branch=eligible.base_branch,
            commit_sha=state.last_commit_sha,
            pull_request_url=state.pr_url,
            pull_request_number=state.pr_number,
            diff_summary=(summary_result.stdout or "").strip(),
            phase=phase,
        )
        self._sb.add_workspace_write_back(wb)
