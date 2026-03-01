"""Filesystem backend with shell execution support.

This module provides an enhanced FilesystemBackend that supports both file
operations and shell command execution for local agent runtime (ENV=local mode).

Virtual platform mount (AD-01 v3):
    When ``platform_dir`` is provided, paths under ``.stigmer/`` are resolved
    against the platform directory instead of the workspace root.  The
    ``list_files(".")`` call merges a virtual ``.stigmer`` entry into the
    workspace root listing.  Shell commands receive the platform path via
    the ``$STIGMER_PLATFORM_DIR`` environment variable.
"""

from __future__ import annotations

import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from graphton.core.backends.platform_mount import (
    PLATFORM_DIR_NAME,
    STIGMER_PLATFORM_DIR_ENV,
    classify_platform_path,
)

logger = logging.getLogger(__name__)


def _human_readable_size(size_bytes: int) -> str:
    """Format a byte count as a compact human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} bytes"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


@dataclass
class ExecutionResult:
    """Result of a shell command execution.

    Attributes:
        exit_code: Command exit code (0 for success)
        stdout: Standard output from the command
        stderr: Standard error from the command
    """
    exit_code: int
    stdout: str
    stderr: str


class FilesystemBackend:
    """Enhanced filesystem backend with shell execution support.

    This backend provides both file operations and shell command execution
    for local agent runtime. It executes commands directly on the host machine
    in a specified workspace directory.

    All paths are resolved relative to root_dir using chroot-like semantics:
    absolute paths (e.g. ``/bin/skills``) are treated as relative to root_dir,
    not as host filesystem paths. This ensures that sandbox-internal paths
    (used by skills, attachments, etc.) resolve correctly in local mode.

    When ``platform_dir`` is set, paths under ``.stigmer/`` are routed to
    the platform directory with an independent containment check.

    Attributes:
        root_dir: Root directory for file operations and command execution
    """

    def __init__(
        self,
        root_dir: str | Path = ".",
        *,
        platform_dir: str | Path | None = None,
    ) -> None:
        """Initialize filesystem backend.

        Args:
            root_dir: Root directory for operations (defaults to current directory)
            platform_dir: External directory for platform files (``.stigmer/``).
                When set, ``.stigmer/*`` paths resolve here instead of root_dir.
        """
        self.root_dir = Path(root_dir).resolve()
        self.root_dir.mkdir(parents=True, exist_ok=True)

        if platform_dir is not None:
            self._platform_root: Path | None = Path(platform_dir).resolve()
            self._platform_root.mkdir(parents=True, exist_ok=True)
        else:
            self._platform_root = None

    # -- Path resolution -------------------------------------------------------

    def _resolve_sandbox_path(self, path: str) -> Path:
        """Resolve a path relative to the sandbox root (chroot-like).

        Absolute paths are treated as relative to root_dir so that
        sandbox-internal paths like ``/bin/skills`` resolve to
        ``{root_dir}/bin/skills`` instead of the host filesystem.

        When ``platform_dir`` is set, ``.stigmer/*`` paths are resolved
        against the platform directory with a separate containment check.

        Args:
            path: Path to resolve. May be relative or absolute.
                  Absolute paths have their leading ``/`` stripped.

        Returns:
            Resolved Path within the appropriate root.

        Raises:
            ValueError: If the resolved path escapes its root
                (e.g. via ``../../`` traversal).
        """
        root_str = str(self.root_dir)
        if path.startswith(root_str + "/"):
            path = path[len(root_str):]
        elif path == root_str:
            path = ""

        # Virtual platform mount: route .stigmer/* to platform_dir.
        if self._platform_root is not None:
            is_platform, remainder = classify_platform_path(path)
            if is_platform:
                return self._resolve_platform(remainder)

        clean = path.lstrip("/")
        resolved = (self.root_dir / clean).resolve()

        if not str(resolved).startswith(str(self.root_dir)):
            raise ValueError(
                f"Path '{path}' resolves outside sandbox root '{self.root_dir}'"
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

    # -- Shell execution -------------------------------------------------------

    def execute(
        self,
        command: str,
        timeout: int = 120,
        **kwargs: Any,  # noqa: ANN401
    ) -> ExecutionResult:
        """Execute shell command on the host machine.

        Commands are executed in the workspace directory (self.root_dir) with
        environment variables inherited from the current process.  When
        ``platform_dir`` is configured, ``$STIGMER_PLATFORM_DIR`` is set so
        shell commands can access platform files.

        Args:
            command: Shell command to execute
            timeout: Command timeout in seconds (defaults to 120)
            **kwargs: Additional arguments (reserved for future use)

        Returns:
            ExecutionResult with exit code, stdout, and stderr
        """
        try:
            env = {**os.environ, "PYTHONUNBUFFERED": "1"}
            if self._platform_root is not None:
                env[STIGMER_PLATFORM_DIR_ENV] = str(self._platform_root)

            result = subprocess.run(
                command,
                shell=True,
                cwd=self.root_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )

            return ExecutionResult(
                exit_code=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
            )

        except subprocess.TimeoutExpired as e:
            stdout = e.stdout.decode("utf-8") if e.stdout else ""
            stderr = e.stderr.decode("utf-8") if e.stderr else ""
            error_msg = f"Command timed out after {timeout} seconds"

            return ExecutionResult(
                exit_code=124,
                stdout=stdout,
                stderr=f"{stderr}\n{error_msg}" if stderr else error_msg,
            )

        except Exception as e:
            return ExecutionResult(
                exit_code=1,
                stdout="",
                stderr=f"Command execution failed: {type(e).__name__}: {e}",
            )

    # -- File operations -------------------------------------------------------

    def read(self, path: str) -> str:
        """Read file contents (deepagents compatible interface)."""
        return self.read_file(path)

    def read_file(self, path: str) -> str:
        """Read file contents, or a structured listing for directories.

        When *path* points to a regular file the full text content is returned.
        When *path* points to a directory a human-readable listing is returned
        so the agent receives useful structural information instead of an error.

        Raises:
            ValueError: If path escapes sandbox root
            FileNotFoundError: If file does not exist (with diagnostic details)
        """
        file_path = self._resolve_sandbox_path(path)

        if not file_path.exists():
            diag = f"File not found: '{path}' (resolved to '{file_path}')"
            parent = file_path.parent
            if parent.exists():
                siblings = sorted(item.name for item in parent.iterdir())
                diag += f". Parent directory '{parent.name}/' contains: {siblings}"
            else:
                diag += f". Parent directory '{parent}' also does not exist"
            logger.warning(diag)
            raise FileNotFoundError(diag)

        if file_path.is_dir():
            return self._format_directory_listing(file_path, path)

        return file_path.read_text()

    # -- Directory listing helpers ---------------------------------------------

    _SKIP_DIR_NAMES: frozenset[str] = frozenset({
        ".git", "__pycache__", "node_modules", ".stigmer",
    })
    _MAX_LISTING_ENTRIES: int = 100

    def _format_directory_listing(
        self,
        dir_path: Path,
        display_path: str,
    ) -> str:
        """Build a structured listing when ``read`` is called on a directory.

        Directories are sorted before files.  Hidden entries (names starting
        with ``.``) and well-known noise directories are omitted.  Output is
        capped at ``_MAX_LISTING_ENTRIES`` entries with a truncation notice.
        """
        try:
            children = sorted(dir_path.iterdir(), key=lambda p: p.name)
        except OSError as exc:
            return f"[Directory: {display_path}]\n\n  (unable to list: {exc})"

        dirs: list[str] = []
        files: list[str] = []

        for child in children:
            name = child.name
            if name.startswith(".") or name in self._SKIP_DIR_NAMES:
                continue
            try:
                if child.is_dir():
                    item_count = sum(
                        1 for c in child.iterdir()
                        if not c.name.startswith(".")
                        and c.name not in self._SKIP_DIR_NAMES
                    )
                    label = "item" if item_count == 1 else "items"
                    dirs.append(f"  {name}/  ({item_count} {label})")
                else:
                    size = child.stat().st_size
                    files.append(f"  {name}  ({_human_readable_size(size)})")
            except OSError:
                files.append(f"  {name}")

        lines = dirs + files
        truncated = len(lines) > self._MAX_LISTING_ENTRIES
        if truncated:
            lines = lines[:self._MAX_LISTING_ENTRIES]

        header = f"[Directory: {display_path}]"
        body = "\n".join(lines) if lines else "  (empty)"
        result = f"{header}\n\n{body}"
        if truncated:
            result += f"\n\n  ... truncated (showing {self._MAX_LISTING_ENTRIES} of {len(dirs) + len(files)} entries)"
        return result

    def write(self, path: str, content: str) -> None:
        """Write content to file (deepagents compatible interface)."""
        self.write_file(path, content)

    def write_file(self, path: str, content: str) -> None:
        """Write content to file.

        Raises:
            ValueError: If path escapes sandbox root
        """
        file_path = self._resolve_sandbox_path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content)

    def is_directory(self, path: str) -> bool:
        """Check whether *path* points to a directory inside the sandbox.

        Returns ``False`` for files, non-existent paths, or paths that
        escape the sandbox root.  Never raises.
        """
        try:
            resolved = self._resolve_sandbox_path(path)
            return resolved.is_dir()
        except (ValueError, OSError):
            return False

    def list_files(self, path: str = ".") -> list[str]:
        """List files in directory.

        Hidden entries (names starting with ``"."``) and well-known noise
        directories (``.git``, ``__pycache__``, ``node_modules``) are
        excluded so that recursive tool traversals never descend into
        infrastructure directories.

        When ``platform_dir`` is set and *path* resolves to the workspace
        root, a virtual ``.stigmer`` entry is merged into the listing so
        the agent discovers the platform namespace.

        Raises:
            ValueError: If path escapes sandbox root
            NotADirectoryError: If path points to a file instead of a directory
        """
        dir_path = self._resolve_sandbox_path(path)

        if not dir_path.exists():
            logger.debug(
                "list_files: path '%s' does not exist (resolved to '%s')",
                path, dir_path,
            )
            return []

        if not dir_path.is_dir():
            msg = (
                f"Path '{path}' is a file, not a directory "
                f"(resolved to '{dir_path}'). Use read() to read files."
            )
            logger.debug(msg)
            raise NotADirectoryError(msg)

        entries = [
            item.name for item in dir_path.iterdir()
            if not item.name.startswith(".")
            and item.name not in self._SKIP_DIR_NAMES
        ]

        # Inject virtual .stigmer entry at the workspace root level.
        if (
            self._platform_root is not None
            and dir_path == self.root_dir
            and PLATFORM_DIR_NAME not in entries
        ):
            entries.append(PLATFORM_DIR_NAME)

        return entries
