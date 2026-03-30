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

import asyncio
import logging
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from graphton.core.backends.gitignore_filter import GitIgnoreFilter
from graphton.core.backends.platform_mount import (
    PLATFORM_DIR_NAME,
    STIGMER_PLATFORM_DIR_ENV,
    classify_platform_path,
    resolve_platform_command,
)
from graphton.core.backends.types import ExecutionResult

logger = logging.getLogger(__name__)

__all__ = ["ExecutionResult", "FilesystemBackend"]


def _human_readable_size(size_bytes: int) -> str:
    """Format a byte count as a compact human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} bytes"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


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
        env_vars: dict[str, str] | None = None,
        allowed_roots: Mapping[str, str | Path] | Sequence[str | Path] | None = None,
    ) -> None:
        """Initialize filesystem backend.

        Args:
            root_dir: Root directory for operations (defaults to current directory)
            platform_dir: External directory for platform files (``.stigmer/``).
                When set, ``.stigmer/*`` paths resolve here instead of root_dir.
            env_vars: Extra environment variables injected into every
                ``execute()`` subprocess.  Sourced from the agent's
                ``env_spec`` and CLI ``--env`` overrides.
            allowed_roots: Additional filesystem roots that the sandbox
                may access (typically symlink targets for multi-workspace
                local-path entries).  Accepts either a mapping of
                ``{entry_name: host_path}`` for path rewriting support,
                or a flat sequence of paths for containment-only checks.
                When a mapping is provided, absolute host paths in tool
                calls are rewritten to entry-relative form before
                resolution.
        """
        self.root_dir = Path(root_dir).resolve()
        self.root_dir.mkdir(parents=True, exist_ok=True)

        if platform_dir is not None:
            self._platform_root: Path | None = Path(platform_dir).resolve()
            self._platform_root.mkdir(parents=True, exist_ok=True)
        else:
            self._platform_root = None

        self._env_vars: dict[str, str] | None = (
            dict(env_vars) if env_vars else None
        )

        self._allowed_roots, self._allowed_root_map = _parse_allowed_roots(
            allowed_roots,
        )

        self._gitignore: GitIgnoreFilter | None = GitIgnoreFilter.from_file(
            self.root_dir / ".gitignore",
        )
        self._entry_gitignores = self._discover_entry_gitignores()

        self._dir_cache: dict[str, list[str]] = {}
        self._path_type_cache: dict[str, bool] = {}

    # -- Cache management ------------------------------------------------------

    def _invalidate_cache(self) -> None:
        """Clear directory listing and path type caches.

        Called before any filesystem mutation (write, execute) to ensure
        subsequent reads see fresh data.
        """
        if self._dir_cache or self._path_type_cache:
            logger.debug(
                "Cache invalidated (%d dir entries, %d type entries)",
                len(self._dir_cache),
                len(self._path_type_cache),
            )
        self._dir_cache.clear()
        self._path_type_cache.clear()

    # -- Gitignore discovery ----------------------------------------------------

    def _discover_entry_gitignores(self) -> dict[str, GitIgnoreFilter]:
        """Scan immediate subdirectories for ``.gitignore`` files.

        In multi-workspace sessions ``root_dir`` is a container directory
        whose children are workspace entries (e.g. git clones).  Each entry
        may carry its own ``.gitignore`` that should govern filtering within
        that subtree.

        Returns a mapping from subdirectory name to its compiled filter.
        Subdirectories without a ``.gitignore`` (or with an empty one) are
        omitted.  Hidden directories (starting with ``"."``) are skipped
        because they are already excluded by ``_should_include``.
        """
        result: dict[str, GitIgnoreFilter] = {}
        try:
            children = self.root_dir.iterdir()
        except OSError:
            return result
        for child in children:
            if not child.is_dir() or child.name.startswith("."):
                continue
            gi_path = child / ".gitignore"
            if gi_path.is_file():
                gi = GitIgnoreFilter.from_file(gi_path)
                if gi is not None:
                    result[child.name] = gi
        if result:
            logger.debug(
                "Discovered entry-level .gitignore filters: %s",
                ", ".join(sorted(result)),
            )
        return result

    # -- Entry filtering -------------------------------------------------------

    def _should_include(
        self,
        parent_dir: Path,
        name: str,
        *,
        is_dir: bool,
    ) -> bool:
        """Decide whether a directory entry should be visible to agent tools.

        Consolidates the filtering layers into a single predicate so that
        ``list_files`` and ``_format_directory_listing`` share one source of
        truth.

        Layers checked in order (first rejection wins):

        1. Hidden entries (names starting with ``"."``) and well-known
           noise directories (``_SKIP_DIR_NAMES``).
        2. Root-level ``.gitignore`` patterns (checked against the full
           workspace-relative path).
        3. Entry-level ``.gitignore`` patterns (checked against the path
           relative to the entry subdirectory).  Only applies to paths
           *within* a subdirectory that has a discovered ``.gitignore``,
           never to the subdirectory name itself.
        """
        if name.startswith(".") or name in self._SKIP_DIR_NAMES:
            return False

        try:
            rel_path = str(parent_dir.relative_to(self.root_dir) / name)
        except ValueError:
            return True

        if self._gitignore is not None:
            if self._gitignore.is_ignored(rel_path, is_dir=is_dir):
                return False

        if self._entry_gitignores:
            parts = rel_path.split("/", 1)
            if len(parts) == 2 and parts[0] in self._entry_gitignores:
                if self._entry_gitignores[parts[0]].is_ignored(
                    parts[1], is_dir=is_dir,
                ):
                    return False

        return True

    # -- Path resolution -------------------------------------------------------

    def _resolve_sandbox_path(self, path: str) -> Path:
        """Resolve a path relative to the sandbox root (chroot-like).

        Absolute paths are treated as relative to root_dir so that
        sandbox-internal paths like ``/bin/skills`` resolve to
        ``{root_dir}/bin/skills`` instead of the host filesystem.

        When ``platform_dir`` is set, ``.stigmer/*`` paths are resolved
        against the platform directory with a separate containment check.

        When ``allowed_roots`` was provided with a mapping, absolute host
        paths that match an allowed root are rewritten to entry-relative
        form before resolution (e.g. ``/Users/dev/repo-a/foo.py`` becomes
        ``repo-a/foo.py`` when ``repo-a`` maps to ``/Users/dev/repo-a``).

        After resolution (which follows symlinks), the containment check
        accepts paths under ``root_dir`` *or* under any allowed root.

        Args:
            path: Path to resolve. May be relative or absolute.
                  Absolute paths have their leading ``/`` stripped.

        Returns:
            Resolved Path within the appropriate root.

        Raises:
            ValueError: If the resolved path escapes all trusted roots
                (e.g. via ``../../`` traversal).
        """
        root_str = str(self.root_dir)
        if path.startswith(root_str + "/"):
            path = path[len(root_str):]
        elif path == root_str:
            path = ""

        # Rewrite absolute host paths that match an allowed root to
        # entry-relative form so they resolve through the symlinks.
        if self._allowed_root_map:
            path = self._rewrite_allowed_root_path(path)

        # Virtual platform mount: route .stigmer/* to platform_dir.
        if self._platform_root is not None:
            is_platform, remainder = classify_platform_path(path)
            if is_platform:
                return self._resolve_platform(remainder)

        clean = path.lstrip("/")
        resolved = (self.root_dir / clean).resolve()

        if not self._is_within_trusted_roots(resolved):
            raise ValueError(
                f"Path '{path}' resolves outside sandbox root '{self.root_dir}'"
            )

        return resolved

    def _rewrite_allowed_root_path(self, path: str) -> str:
        """Rewrite an absolute host path to entry-relative if it matches
        an allowed root.

        For example, if ``allowed_root_map`` contains
        ``{"repo-a": Path("/Users/dev/repo-a")}``, then
        ``/Users/dev/repo-a/src/main.py`` is rewritten to
        ``repo-a/src/main.py``.
        """
        for entry_name, host_path in self._allowed_root_map.items():
            host_str = str(host_path)
            if path.startswith(host_str + "/"):
                return entry_name + path[len(host_str):]
            if path == host_str:
                return entry_name
        return path

    def _is_within_trusted_roots(self, resolved: Path) -> bool:
        """Check whether *resolved* falls under root_dir or any allowed root."""
        resolved_str = str(resolved)
        if resolved_str.startswith(str(self.root_dir)):
            return True
        return any(
            resolved_str.startswith(str(ar))
            for ar in self._allowed_roots
        )

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
        self._invalidate_cache()

        if self._platform_root is not None:
            command = resolve_platform_command(command)

        try:
            env = self._build_execute_env()

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

    async def execute_streaming(
        self,
        command: str,
        timeout: int = 120,
        on_chunk: Callable[[str], None] | None = None,
    ) -> ExecutionResult:
        """Execute shell command with live output streaming.

        Runs the command asynchronously and invokes *on_chunk* for each
        line of output as it arrives from stdout and stderr.  Both streams
        are read concurrently so the caller sees a natural interleaving
        (identical to a real terminal).

        The *on_chunk* callback is invoked synchronously from within the
        event loop — keep it lightweight (e.g. ``dispatch_custom_event``).
        The backend itself has no knowledge of LangGraph; the caller
        decides what to do with each chunk.

        After the process terminates, the method returns an
        ``ExecutionResult`` with separated stdout/stderr (same contract
        as :meth:`execute`) so the final formatted result is identical.

        Falls back to :meth:`execute` via ``asyncio.to_thread`` when the
        subprocess cannot be created (e.g. platform restrictions).

        Args:
            command: Shell command to execute.
            timeout: Command timeout in seconds (defaults to 120).
            on_chunk: Called with each line of output (stdout or stderr)
                as it is produced.  ``None`` disables streaming callbacks
                (the method still returns the full result).

        Returns:
            ExecutionResult with exit code, stdout, and stderr.
        """
        self._invalidate_cache()

        if self._platform_root is not None:
            command = resolve_platform_command(command)

        env = self._build_execute_env()

        try:
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.root_dir,
                env=env,
            )
        except OSError as exc:
            logger.warning(
                "execute_streaming: subprocess creation failed, "
                "falling back to sync execute: %s", exc,
            )
            return await asyncio.to_thread(self.execute, command, timeout)

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        async def _read_stream(
            stream: asyncio.StreamReader,
            collector: list[str],
        ) -> None:
            async for raw_line in stream:
                line = raw_line.decode("utf-8", errors="replace")
                collector.append(line)
                if on_chunk is not None:
                    on_chunk(line)

        try:
            await asyncio.wait_for(
                asyncio.gather(
                    _read_stream(process.stdout, stdout_lines),
                    _read_stream(process.stderr, stderr_lines),
                ),
                timeout=timeout,
            )
            await process.wait()
        except TimeoutError:
            process.kill()
            await process.wait()
            stdout = "".join(stdout_lines)
            stderr_text = "".join(stderr_lines)
            error_msg = f"Command timed out after {timeout} seconds"
            return ExecutionResult(
                exit_code=124,
                stdout=stdout,
                stderr=(
                    f"{stderr_text}\n{error_msg}"
                    if stderr_text
                    else error_msg
                ),
            )
        except Exception as exc:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
            return ExecutionResult(
                exit_code=1,
                stdout="".join(stdout_lines),
                stderr=f"Command execution failed: {type(exc).__name__}: {exc}",
            )

        return ExecutionResult(
            exit_code=process.returncode or 0,
            stdout="".join(stdout_lines),
            stderr="".join(stderr_lines),
        )

    def _build_execute_env(self) -> dict[str, str]:
        """Build the environment dict shared by execute() and execute_streaming()."""
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}

        managed_bin = str(Path(sys.executable).parent)
        current_path = env.get("PATH", "")
        if managed_bin not in current_path.split(os.pathsep):
            env["PATH"] = f"{managed_bin}{os.pathsep}{current_path}"

        if self._env_vars:
            env.update(self._env_vars)
        if self._platform_root is not None:
            env[STIGMER_PLATFORM_DIR_ENV] = str(self._platform_root)

        return env

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

    # Well-known directories that should never be traversed by agent tools.
    # Entries starting with "." are already caught by the hidden-entry filter
    # in list_files() and _format_directory_listing(); the remaining entries
    # here cover non-hidden noise directories (build output, vendored deps).
    #
    # NOTE: agent-runner's _TREE_SKIP_DIRS (execute_graphton.py) mirrors this
    # set for the system-prompt directory tree.  Keep them aligned.
    _SKIP_DIR_NAMES: frozenset[str] = frozenset({
        ".git", "__pycache__", "node_modules", ".stigmer",
        "venv", "dist", "target", "vendor", "coverage", "bower_components",
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
            child_is_dir = child.is_dir()
            if not self._should_include(dir_path, name, is_dir=child_is_dir):
                continue
            try:
                if child_is_dir:
                    item_count = sum(
                        1 for c in child.iterdir()
                        if self._should_include(child, c.name, is_dir=c.is_dir())
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

    def delete(self, path: str) -> str:
        """Delete a file from the workspace.

        Only regular files may be deleted. Attempting to delete a directory
        raises ``IsADirectoryError`` — use shell commands for recursive
        directory removal (which carries its own approval gate via the
        ``execute`` tool).

        Args:
            path: Relative path to the file within the workspace.

        Returns:
            Confirmation message including the deleted path.

        Raises:
            ValueError: If path escapes sandbox root.
            FileNotFoundError: If the file does not exist.
            IsADirectoryError: If the path points to a directory.
        """
        self._invalidate_cache()
        file_path = self._resolve_sandbox_path(path)

        if not file_path.exists():
            diag = f"File not found: '{path}' (resolved to '{file_path}')"
            parent = file_path.parent
            if parent.exists():
                siblings = sorted(item.name for item in parent.iterdir())
                diag += f". Parent directory '{parent.name}/' contains: {siblings}"
            else:
                diag += f". Parent directory '{parent}' also does not exist"
            raise FileNotFoundError(diag)

        if file_path.is_dir():
            raise IsADirectoryError(
                f"Cannot delete '{path}': is a directory, not a file. "
                "Use the execute tool with 'rm -rf' for directory removal."
            )

        file_path.unlink()
        return f"Deleted '{path}'"

    def write(self, path: str, content: str) -> None:
        """Write content to file (deepagents compatible interface)."""
        self.write_file(path, content)

    def write_file(self, path: str, content: str) -> None:
        """Write content to file.

        Raises:
            ValueError: If path escapes sandbox root
        """
        self._invalidate_cache()
        file_path = self._resolve_sandbox_path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content)

    def is_directory(self, path: str) -> bool:
        """Check whether *path* points to a directory inside the sandbox.

        Returns ``False`` for files, non-existent paths, or paths that
        escape the sandbox root.  Never raises.

        Results are cached per-instance; cache is invalidated by
        ``write_file()`` and ``execute()``.
        """
        try:
            resolved = self._resolve_sandbox_path(path)
            cache_key = str(resolved)
            cached = self._path_type_cache.get(cache_key)
            if cached is not None:
                return cached
            result = resolved.is_dir()
            self._path_type_cache[cache_key] = result
            return result
        except (ValueError, OSError):
            return False

    def list_files(self, path: str = ".") -> list[str]:
        """List files in directory.

        Hidden entries (names starting with ``"."``) and directories listed
        in ``_SKIP_DIR_NAMES`` are excluded so that recursive tool traversals
        never descend into infrastructure or generated-output directories.

        When ``platform_dir`` is set and *path* resolves to the workspace
        root, a virtual ``.stigmer`` entry is merged into the listing so
        the agent discovers the platform namespace.

        Results are cached per-instance; the first call for a directory does
        real I/O and populates the cache, subsequent calls return the cached
        result.  ``write_file()`` and ``execute()`` invalidate the cache.

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

        cache_key = str(dir_path)
        cached = self._dir_cache.get(cache_key)
        if cached is not None:
            return list(cached)

        entries: list[str] = []
        for item in dir_path.iterdir():
            child_is_dir = item.is_dir()
            self._path_type_cache[str(item)] = child_is_dir
            if self._should_include(dir_path, item.name, is_dir=child_is_dir):
                entries.append(item.name)

        # Inject virtual .stigmer entry at the workspace root level.
        if (
            self._platform_root is not None
            and dir_path == self.root_dir
            and PLATFORM_DIR_NAME not in entries
        ):
            entries.append(PLATFORM_DIR_NAME)

        self._dir_cache[cache_key] = entries
        return list(entries)


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _parse_allowed_roots(
    allowed_roots: Mapping[str, str | Path] | Sequence[str | Path] | None,
) -> tuple[list[Path], dict[str, Path]]:
    """Normalize *allowed_roots* into a resolved list and an optional mapping.

    Returns:
        A tuple of ``(allowed_list, allowed_map)``.  ``allowed_list``
        contains resolved ``Path`` objects for the containment check.
        ``allowed_map`` maps entry names to resolved ``Path`` objects
        for absolute-path rewriting; empty when the input was a flat
        sequence (no entry names available).
    """
    if not allowed_roots:
        return [], {}

    if isinstance(allowed_roots, Mapping):
        resolved_map: dict[str, Path] = {
            name: Path(p).resolve() for name, p in allowed_roots.items()
        }
        return list(resolved_map.values()), resolved_map

    return [Path(p).resolve() for p in allowed_roots], {}
