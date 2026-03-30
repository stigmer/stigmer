"""Daytona sandbox adapter for ``WorkspaceBackend``.

All file and process operations are delegated to the Daytona SDK
(``sandbox.fs`` for files, ``sandbox.process`` for commands).

Process execution uses Daytona's *session* API
(``process.execute_session_command``) rather than the simpler
``process.exec``, because the session API returns separate ``stdout``
and ``stderr`` streams.  ``process.exec`` only returns stdout (via the
``result`` attribute on ``ExecuteResponse``) and discards stderr
entirely, making command failures undiagnosable.

A lightweight Daytona process session is created lazily on the first
``execute()`` call and deleted when ``close()`` is called.

The adapter does NOT expose the underlying ``sandbox`` object.  Code that
still needs raw sandbox access (agent configuration via ``sandbox.id``,
auto-publish, lifecycle cleanup) should keep its own reference — the
factory function ``initialize_workspace`` returns the sandbox alongside
the backend for exactly this purpose.
"""

from __future__ import annotations

import logging
import os
import shlex
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from worker.workspace.backend import ExecuteResult
from worker.workspace.platform_mount import (
    STIGMER_PLATFORM_DIR_ENV,
    resolve_platform_command,
)

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class DaytonaWorkspaceBackend:
    """Workspace backend backed by a Daytona cloud sandbox.

    Invariants enforced at construction:
        - ``sandbox`` is not ``None``.
        - ``workspace_root`` is a non-empty absolute path inside the
          sandbox (e.g. ``/home/daytona/workspace``).
        - ``workspace_root`` directory exists in the sandbox (created
          via ``mkdir -p`` if absent).

    Lifecycle:
        Callers **must** call :meth:`close` when the backend is no longer
        needed.  This deletes the Daytona process session created for
        ``execute()`` calls.  Failing to close is non-catastrophic — the
        session is cleaned up when the sandbox itself is destroyed — but
        explicit cleanup is preferred.
    """

    def __init__(
        self,
        sandbox: Any,
        workspace_root: str,
        sandbox_root: str | None = None,
        env_vars: dict[str, str] | None = None,
    ) -> None:
        if sandbox is None:
            raise ValueError("sandbox must not be None")
        if not workspace_root or not workspace_root.startswith("/"):
            raise ValueError(
                f"workspace_root must be a non-empty absolute path, "
                f"got: {workspace_root!r}"
            )

        self._sandbox = sandbox
        self._workspace_root = workspace_root.rstrip("/")
        self._sandbox_root = (sandbox_root or workspace_root).rstrip("/")
        self._env_vars: dict[str, str] = dict(env_vars) if env_vars else {}

        # Rebase prefix: the relative path from sandbox root to workspace
        # root.  When the workspace root is a subdirectory of the sandbox
        # root (e.g. /home/daytona/workspace under /home/daytona), paths
        # normalised by stripping the workspace-root prefix need this
        # prefix prepended so sandbox.fs resolves to the correct location.
        if (
            self._workspace_root != self._sandbox_root
            and self._workspace_root.startswith(self._sandbox_root + "/")
        ):
            self._rebase_prefix = self._workspace_root[
                len(self._sandbox_root) + 1 :
            ]
        else:
            self._rebase_prefix = ""

        if self._rebase_prefix:
            logger.info(
                "DaytonaWorkspaceBackend: rebase prefix = '%s' "
                "(workspace_root='%s', sandbox_root='%s')",
                self._rebase_prefix,
                self._workspace_root,
                self._sandbox_root,
            )

        self._ensure_workspace_root()

        self._session_id = f"ws-provision-{uuid4().hex[:12]}"
        self._session_created = False

    # -- Protocol properties --------------------------------------------------

    @property
    def root_dir(self) -> str:
        return self._workspace_root

    @property
    def platform_dir(self) -> str | None:
        # Cloud-mode virtual mount deferred to Phase B.
        return None

    # -- File operations ------------------------------------------------------

    def write_file(self, rel_path: str, content: bytes) -> None:
        abs_path = self._abs(rel_path)
        parent = os.path.dirname(abs_path)
        self._sandbox.process.exec(f"mkdir -p {parent}", timeout=5)

        from daytona import FileUpload  # type: ignore[import-untyped]

        self._sandbox.fs.upload_files(
            [FileUpload(source=content, destination=abs_path)]
        )

    def write_files(self, files: Sequence[tuple[str, bytes]]) -> None:
        if not files:
            return

        from daytona import FileUpload  # type: ignore[import-untyped]

        # Collect unique parent directories and create them in one shot.
        parents: set[str] = set()
        for rel_path, _ in files:
            parents.add(os.path.dirname(self._abs(rel_path)))

        if parents:
            dirs = " ".join(sorted(parents))
            self._sandbox.process.exec(f"mkdir -p {dirs}", timeout=10)

        uploads = [
            FileUpload(source=content, destination=self._abs(rel_path))
            for rel_path, content in files
        ]
        self._sandbox.fs.upload_files(uploads)

    def read_file(self, rel_path: str) -> bytes:
        abs_path = self._abs(rel_path)
        try:
            data = self._sandbox.fs.download_file(abs_path)
        except Exception as exc:
            raise FileNotFoundError(
                f"File not found in sandbox: '{rel_path}' "
                f"(abs='{abs_path}')"
            ) from exc

        if isinstance(data, str):
            return data.encode("utf-8")
        return data

    def file_exists(self, rel_path: str) -> bool:
        abs_path = self._abs(rel_path)
        try:
            result = self._sandbox.process.exec(
                f"test -e {abs_path}", timeout=5,
            )
            return result.exit_code == 0
        except Exception:
            return False

    def mkdir(self, rel_path: str) -> None:
        abs_path = self._abs(rel_path)
        self._sandbox.process.exec(f"mkdir -p {abs_path}", timeout=5)

    # -- Lifecycle -------------------------------------------------------------

    def close(self) -> None:
        """Delete the Daytona process session, if one was created."""
        if not self._session_created:
            return
        try:
            self._sandbox.process.delete_session(self._session_id)
            logger.debug("Deleted Daytona process session: %s", self._session_id)
        except Exception as exc:
            logger.warning(
                "Failed to delete Daytona process session %s (non-fatal): %s",
                self._session_id,
                exc,
            )
        finally:
            self._session_created = False

    # -- Process execution ----------------------------------------------------

    def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        timeout: int = 30,
    ) -> ExecuteResult:
        self._ensure_session()

        if self._env_vars and STIGMER_PLATFORM_DIR_ENV in self._env_vars:
            command = resolve_platform_command(command)

        abs_target = self._abs(cwd) if cwd is not None else self._workspace_root
        full_cmd = f"cd {shlex.quote(abs_target)} && {command}"

        all_env: dict[str, str] = {"PYTHONUNBUFFERED": "1"}
        all_env.update(self._env_vars)
        exports = "; ".join(
            f"export {k}={shlex.quote(v)}" for k, v in all_env.items()
        )
        full_cmd = f"{exports}; {full_cmd}"

        try:
            from daytona import SessionExecuteRequest  # type: ignore[import-untyped]

            req = SessionExecuteRequest(command=full_cmd)
            result = self._sandbox.process.execute_session_command(
                self._session_id, req, timeout=timeout,
            )
            return ExecuteResult(
                exit_code=result.exit_code,
                stdout=result.stdout or "",
                stderr=result.stderr or "",
            )
        except Exception as exc:
            return ExecuteResult(
                exit_code=1,
                stdout="",
                stderr=f"Sandbox command failed: {type(exc).__name__}: {exc}",
            )

    # -- Internal helpers -----------------------------------------------------

    def _ensure_workspace_root(self) -> None:
        """Guarantee the workspace root directory exists in the sandbox.

        Previously this directory was created implicitly by a Daytona
        volume mount.  With volumes removed (local overlay is ~2,360x
        faster for file-creation workloads), the backend must create it
        explicitly.  Uses ``sandbox.process.exec`` (not the session API)
        because the process session has not been created yet at this point.
        """
        self._sandbox.process.exec(
            f"mkdir -p {self._workspace_root}", timeout=5,
        )
        logger.debug(
            "Ensured workspace root exists: %s", self._workspace_root,
        )

    def _ensure_session(self) -> None:
        """Create the Daytona process session on first use.

        Raises immediately if session creation fails — a broken sandbox
        cannot execute commands regardless of API choice.
        """
        if self._session_created:
            return
        self._sandbox.process.create_session(self._session_id)
        self._session_created = True
        logger.debug("Created Daytona process session: %s", self._session_id)

    def _normalize(self, path: str) -> str:
        """Translate an agent-space path into a sandbox-relative path.

        The artifact publisher calls ``sandbox.fs.get_file_info(path)``
        which resolves *path* relative to the **sandbox root**, not the
        workspace root.  When the workspace root is a subdirectory of
        the sandbox root (e.g. ``/home/daytona/workspace`` under
        ``/home/daytona``), a bare relative path like
        ``mcp-server-stigmer.yaml`` must be rebased to
        ``workspace/mcp-server-stigmer.yaml``.

        Steps:
            1. Strip workspace-root prefix (prevents double-prefix).
            2. Strip leading ``/`` (defense-in-depth).
            3. Prepend rebase prefix when workspace root is a
               subdirectory of sandbox root.

        Examples (workspace_root = ``/home/daytona/workspace``,
        sandbox_root = ``/home/daytona``, rebase_prefix = ``workspace``):

        >>> backend._normalize("mcp-server-stigmer.yaml")
        'workspace/mcp-server-stigmer.yaml'
        >>> backend._normalize("/home/daytona/workspace/bin/skills/a/SKILL.md")
        'workspace/bin/skills/a/SKILL.md'
        >>> backend._normalize("/bin/skills/a/SKILL.md")
        'workspace/bin/skills/a/SKILL.md'
        """
        prefix = self._workspace_root + "/"
        if path.startswith(prefix):
            relative = path[len(prefix):]
        elif path == self._workspace_root:
            relative = ""
        else:
            relative = path.lstrip("/")

        if self._rebase_prefix:
            result = (
                f"{self._rebase_prefix}/{relative}" if relative else self._rebase_prefix
            )
        else:
            result = relative or "."

        if result != path:
            logger.debug(
                "Normalized path: '%s' -> '%s' "
                "(workspace_root='%s', sandbox_root='%s')",
                path,
                result,
                self._workspace_root,
                self._sandbox_root,
            )
        return result

    def _abs(self, rel_path: str) -> str:
        """Resolve *rel_path* to an absolute sandbox path.

        Strips leading ``/`` so callers can pass workspace-relative or
        absolute-looking paths interchangeably.
        """
        clean = rel_path.lstrip("/")
        return f"{self._workspace_root}/{clean}"
