"""Daytona sandbox adapter for ``WorkspaceBackend``.

All file and process operations are delegated to the Daytona SDK
(``sandbox.fs`` for files, ``sandbox.process`` for commands).

The adapter does NOT expose the underlying ``sandbox`` object.  Code that
still needs raw sandbox access (agent configuration via ``sandbox.id``,
auto-publish, lifecycle cleanup) should keep its own reference — the
factory function ``initialize_workspace`` returns the sandbox alongside
the backend for exactly this purpose.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from worker.workspace.backend import ExecuteResult

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class DaytonaWorkspaceBackend:
    """Workspace backend backed by a Daytona cloud sandbox.

    Invariants enforced at construction:
        - ``sandbox`` is not ``None``.
        - ``workspace_root`` is a non-empty absolute path inside the
          sandbox (e.g. ``/home/daytona/workspace``).
    """

    def __init__(self, sandbox: Any, workspace_root: str) -> None:
        if sandbox is None:
            raise ValueError("sandbox must not be None")
        if not workspace_root or not workspace_root.startswith("/"):
            raise ValueError(
                f"workspace_root must be a non-empty absolute path, "
                f"got: {workspace_root!r}"
            )

        self._sandbox = sandbox
        self._workspace_root = workspace_root.rstrip("/")

    # -- Protocol properties --------------------------------------------------

    @property
    def root_dir(self) -> str:
        return self._workspace_root

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

    # -- Process execution ----------------------------------------------------

    def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        timeout: int = 30,
    ) -> ExecuteResult:
        if cwd is not None:
            abs_cwd = self._abs(cwd)
            full_cmd = f"cd {abs_cwd} && {command}"
        else:
            full_cmd = f"cd {self._workspace_root} && {command}"

        try:
            result = self._sandbox.process.exec(full_cmd, timeout=timeout)
            return ExecuteResult(
                exit_code=result.exit_code,
                stdout=getattr(result, "output", "") or "",
                stderr=getattr(result, "stderr", "") or "",
            )
        except Exception as exc:
            return ExecuteResult(
                exit_code=1,
                stdout="",
                stderr=f"Sandbox command failed: {type(exc).__name__}: {exc}",
            )

    # -- Internal helpers -----------------------------------------------------

    def _abs(self, rel_path: str) -> str:
        """Resolve *rel_path* to an absolute sandbox path.

        Strips leading ``/`` so callers can pass workspace-relative or
        absolute-looking paths interchangeably.
        """
        clean = rel_path.lstrip("/")
        return f"{self._workspace_root}/{clean}"
