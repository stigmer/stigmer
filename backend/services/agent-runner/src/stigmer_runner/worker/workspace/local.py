"""Local filesystem adapter for ``WorkspaceBackend``.

All file and process operations are performed directly on the host
filesystem using ``pathlib`` and ``subprocess``.  Path resolution follows
chroot-like semantics identical to graphton's ``FilesystemBackend``:
absolute paths are treated as relative to ``root_dir`` so that
sandbox-internal paths (``/bin/skills``, ``/inputs/data.csv``) resolve
correctly in local mode.

Virtual platform mount (AD-01 v3):
    When ``platform_dir`` is provided, paths under ``.stigmer/`` are
    resolved against the platform directory instead of the workspace root.
    Both scopes use ``Path.resolve()`` with containment checks — no
    security relaxation.
"""

from __future__ import annotations

import logging
import os
import subprocess
from collections.abc import Sequence
from pathlib import Path

from stigmer_runner.worker.workspace.backend import ExecuteResult
from stigmer_runner.worker.workspace.platform_mount import (
    STIGMER_PLATFORM_DIR_ENV,
    classify_platform_path,
    resolve_platform_command,
)

logger = logging.getLogger(__name__)


class LocalWorkspaceBackend:
    """Workspace backend backed by the local filesystem.

    Invariants enforced at construction:
        - ``root_dir`` is non-empty, resolved to an absolute path, and
          created (``mkdir -p``) if it does not exist.
        - When ``platform_dir`` is provided it is also resolved and
          created.  Paths under ``.stigmer/`` route there instead of
          ``root_dir``.
    """

    def __init__(
        self,
        root_dir: str | Path,
        *,
        platform_dir: str | Path | None = None,
    ) -> None:
        if not root_dir:
            raise ValueError("root_dir must be a non-empty path")

        self._root = Path(root_dir).resolve()
        self._root.mkdir(parents=True, exist_ok=True)

        if platform_dir is not None:
            self._platform_root: Path | None = Path(platform_dir).resolve()
            self._platform_root.mkdir(parents=True, exist_ok=True)
        else:
            self._platform_root = None

    # -- Protocol properties --------------------------------------------------

    @property
    def root_dir(self) -> str:
        return str(self._root)

    @property
    def platform_dir(self) -> str | None:
        return str(self._platform_root) if self._platform_root else None

    # -- File operations ------------------------------------------------------

    def write_file(self, rel_path: str, content: bytes) -> None:
        dest = self._resolve(rel_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)

    def write_files(self, files: Sequence[tuple[str, bytes]]) -> None:
        for rel_path, content in files:
            self.write_file(rel_path, content)

    def read_file(self, rel_path: str) -> bytes:
        target = self._resolve(rel_path)
        if not target.exists():
            raise FileNotFoundError(
                f"File not found: '{rel_path}' "
                f"(resolved to '{target}', root='{self._root}')"
            )
        return target.read_bytes()

    def file_exists(self, rel_path: str) -> bool:
        return self._resolve(rel_path).exists()

    def mkdir(self, rel_path: str) -> None:
        self._resolve(rel_path).mkdir(parents=True, exist_ok=True)

    # -- Lifecycle -------------------------------------------------------------

    def close(self) -> None:
        pass

    # -- Process execution ----------------------------------------------------

    def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        timeout: int = 30,
    ) -> ExecuteResult:
        work_dir = self._root if cwd is None else self._resolve(cwd)

        if self._platform_root is not None:
            command = resolve_platform_command(command)

        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        if self._platform_root is not None:
            env[STIGMER_PLATFORM_DIR_ENV] = str(self._platform_root)
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            return ExecuteResult(
                exit_code=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout.decode("utf-8") if exc.stdout else ""
            stderr = exc.stderr.decode("utf-8") if exc.stderr else ""
            return ExecuteResult(
                exit_code=124,
                stdout=stdout,
                stderr=(
                    f"{stderr}\nCommand timed out after {timeout}s"
                    if stderr
                    else f"Command timed out after {timeout}s"
                ),
            )
        except Exception as exc:
            return ExecuteResult(
                exit_code=1,
                stdout="",
                stderr=f"Command execution failed: {type(exc).__name__}: {exc}",
            )

    # -- Internal helpers -----------------------------------------------------

    def _resolve(self, rel_path: str) -> Path:
        """Resolve *rel_path* relative to workspace root (chroot-like).

        Absolute paths are treated as relative to ``root_dir`` so that
        sandbox-internal references like ``/bin/skills`` map to
        ``{root_dir}/bin/skills``.

        When ``platform_dir`` is set, paths under ``.stigmer/`` are
        resolved against the platform directory with an independent
        containment check.

        Raises ``ValueError`` if the resolved path escapes its root.
        """
        root_str = str(self._root)

        # Strip root_dir prefix to avoid double-prefixing when the caller
        # already constructed an absolute path that starts with root_dir.
        if rel_path.startswith(root_str + "/"):
            rel_path = rel_path[len(root_str):]
        elif rel_path == root_str:
            rel_path = ""

        # Virtual platform mount: route .stigmer/* to platform_dir.
        if self._platform_root is not None:
            is_platform, remainder = classify_platform_path(rel_path)
            if is_platform:
                return self._resolve_platform(remainder)

        clean = rel_path.lstrip("/")
        resolved = (self._root / clean).resolve()

        if not str(resolved).startswith(root_str):
            raise ValueError(
                f"Path '{rel_path}' resolves outside workspace root "
                f"'{self._root}'"
            )
        return resolved

    def _resolve_platform(self, remainder: str) -> Path:
        """Resolve *remainder* within ``platform_dir`` with containment check."""
        assert self._platform_root is not None
        platform_str = str(self._platform_root)

        resolved = (self._platform_root / remainder).resolve()
        if not str(resolved).startswith(platform_str):
            raise ValueError(
                f"Path '.stigmer/{remainder}' resolves outside platform root "
                f"'{self._platform_root}'"
            )
        return resolved
