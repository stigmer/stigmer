"""Adapter bridging graphton backends to deepagents' SandboxBackendProtocol.

deepagents' ``FilesystemMiddleware`` actively strips the ``execute`` tool from
the model's tool set when its backend does not implement
``SandboxBackendProtocol``.  When graphton creates its own sandbox-backed
``execute`` tool and passes it to deepagents via the ``tools`` parameter,
the middleware still removes it because graphton does not pass a backend,
so deepagents defaults to ``StateBackend`` (in-memory, no execution support).

This adapter wraps graphton's ``FilesystemBackend`` (or any backend that
provides ``execute``, ``read``, ``write``, ``list_files``, and
``is_directory``) and presents the ``SandboxBackendProtocol`` interface
that deepagents expects.  Passing an adapter instance as ``backend`` to
``deepagents.create_deep_agent()`` ensures:

1. ``FilesystemMiddleware._supports_execution()`` returns ``True``
2. The ``execute`` tool is **not** filtered from the model's tool set
3. Sub-agents inherit the same backend through deepagents' middleware stack
4. deepagents' own filesystem tools are backed by the real workspace
   instead of ephemeral in-memory storage
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import os
import re
import uuid
from typing import Any

from deepagents.backends.protocol import (  # type: ignore[import-untyped]
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileInfo,
    FileUploadResponse,
    GrepMatch,
    SandboxBackendProtocol,
    WriteResult,
)

logger = logging.getLogger(__name__)


class DeepAgentsBackendAdapter(SandboxBackendProtocol):
    """Adapts a graphton backend to deepagents' ``SandboxBackendProtocol``.

    Explicit inheritance from ``SandboxBackendProtocol`` guarantees that
    ``isinstance(adapter, SandboxBackendProtocol)`` is always ``True``
    via normal MRO — no reliance on ``@runtime_checkable`` structural
    subtyping, which is fragile across Python versions (CPython changed
    the check semantics in 3.12 via ``inspect.getmembers_static``).

    The adapter delegates file and execution operations to the inner
    backend, translating between graphton's interface (``list_files``,
    ``read_file``, ``write_file``, ``execute`` → ``ExecutionResult``) and
    deepagents' protocol (``ls_info``, ``read``, ``write`` → ``WriteResult``,
    ``execute`` → ``ExecuteResponse``).

    This is intentionally a thin translation layer — no business logic,
    no caching, no filtering.  Those responsibilities remain with the
    inner backend.
    """

    def __init__(self, inner: Any) -> None:  # noqa: ANN401
        """Wrap a graphton backend.

        Args:
            inner: A graphton ``FilesystemBackend``, ``DaytonaBackend``,
                or any object that provides ``execute()``, ``read()``,
                ``write()``, ``list_files()``, and ``is_directory()``.
        """
        self._inner = inner
        self._id = f"graphton-{uuid.uuid4().hex[:12]}"

    @property
    def id(self) -> str:
        if hasattr(self._inner, "id"):
            return self._inner.id  # type: ignore[no-any-return]
        return self._id

    # ------------------------------------------------------------------
    # SandboxBackendProtocol.execute
    # ------------------------------------------------------------------

    def execute(self, command: str) -> ExecuteResponse:
        result = self._inner.execute(command)
        output_parts: list[str] = []
        if hasattr(result, "stdout") and result.stdout:
            output_parts.append(result.stdout)
        if hasattr(result, "stderr") and result.stderr:
            output_parts.append(result.stderr)
        if hasattr(result, "output"):
            output_parts.append(result.output)

        exit_code = getattr(result, "exit_code", None)
        truncated = getattr(result, "truncated", False)

        return ExecuteResponse(
            output="\n".join(output_parts) if output_parts else "(no output)",
            exit_code=exit_code,
            truncated=truncated,
        )

    async def aexecute(
        self, command: str, *, timeout: int | None = None,
    ) -> ExecuteResponse:
        """Async execute that prefers the inner backend's streaming path.

        When the inner backend provides ``execute_streaming`` (native
        ``asyncio.create_subprocess_shell``), use it directly instead of
        offloading the sync ``subprocess.run`` to a thread.  This avoids
        occupying a thread-pool slot for the duration of the command and
        preserves true async I/O.
        """
        effective_timeout = timeout if timeout is not None else 120
        if callable(getattr(self._inner, "execute_streaming", None)):
            result = await self._inner.execute_streaming(
                command, timeout=effective_timeout,
            )
        else:
            result = await asyncio.to_thread(
                self._inner.execute, command, timeout=effective_timeout,
            )

        output_parts: list[str] = []
        if hasattr(result, "stdout") and result.stdout:
            output_parts.append(result.stdout)
        if hasattr(result, "stderr") and result.stderr:
            output_parts.append(result.stderr)
        if hasattr(result, "output"):
            output_parts.append(result.output)

        exit_code = getattr(result, "exit_code", None)
        truncated = getattr(result, "truncated", False)

        return ExecuteResponse(
            output="\n".join(output_parts) if output_parts else "(no output)",
            exit_code=exit_code,
            truncated=truncated,
        )

    # ------------------------------------------------------------------
    # BackendProtocol — directory listing
    # ------------------------------------------------------------------

    def ls_info(self, path: str) -> list[FileInfo]:
        if callable(getattr(self._inner, "execute", None)):
            fast = self._ls_info_via_execute(path)
            if fast is not None:
                return fast

        entries = self._inner.list_files(path)
        result: list[FileInfo] = []
        for name in entries:
            child_path = os.path.join(path, name) if path not in (".", "/", "") else name
            is_dir = False
            if hasattr(self._inner, "is_directory"):
                try:
                    is_dir = self._inner.is_directory(child_path)
                except Exception:
                    pass
            result.append(FileInfo(path=child_path, is_dir=is_dir))
        return result

    def _ls_info_via_execute(self, path: str) -> list[FileInfo] | None:
        """List directory with type info in a single shell command.

        Returns ``None`` if the fast path is unavailable, in which case
        the caller falls back to per-entry ``is_directory`` calls.
        """
        import shlex

        sp = shlex.quote(path)
        cmd = (
            f"("
            f"find {sp} -maxdepth 1 -mindepth 1 -type d 2>/dev/null"
            f" | sed 's/^/d /' ; "
            f"find {sp} -maxdepth 1 -mindepth 1 -not -type d 2>/dev/null"
            f" | sed 's/^/f /'"
            f") | sort -k2"
        )
        try:
            result = self._inner.execute(cmd)
        except Exception:
            return None

        stdout = result.stdout if hasattr(result, "stdout") else ""

        if not stdout or not stdout.strip():
            return None

        items: list[FileInfo] = []
        prefix = path.rstrip("/") + "/" if path not in (".", "/", "") else ""
        for line in stdout.strip().splitlines():
            parts = line.strip().split(" ", 1)
            if len(parts) != 2:
                continue
            file_type, full_path = parts
            name = full_path
            if prefix and full_path.startswith(prefix):
                name = full_path[len(prefix):]
            elif full_path.startswith("./"):
                name = full_path[2:]
            child_path = (
                os.path.join(path, name) if path not in (".", "/", "") else name
            )
            items.append(FileInfo(path=child_path, is_dir=(file_type == "d")))
        return items

    # ------------------------------------------------------------------
    # BackendProtocol — read
    # ------------------------------------------------------------------

    def read(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> str:
        try:
            content = self._inner.read(file_path)
        except (FileNotFoundError, ValueError, OSError) as exc:
            return f"Error: {exc}"

        lines = content.splitlines(keepends=True)
        total = len(lines)

        if offset > 0 or limit < total:
            start = max(offset, 0)
            end = min(start + limit, total) if limit > 0 else total
            sliced = lines[start:end]
            numbered = []
            for i, line in enumerate(sliced, start=start + 1):
                numbered.append(f"{i:>6}\t{line.rstrip()}")
            return "\n".join(numbered)

        numbered = []
        for i, line in enumerate(lines, start=1):
            numbered.append(f"{i:>6}\t{line.rstrip()}")
        return "\n".join(numbered)

    # ------------------------------------------------------------------
    # BackendProtocol — write
    # ------------------------------------------------------------------

    def write(self, file_path: str, content: str) -> WriteResult:
        try:
            self._inner.write(file_path, content)
            return WriteResult(path=file_path)
        except Exception as exc:
            return WriteResult(error=str(exc))

    # ------------------------------------------------------------------
    # BackendProtocol — edit
    # ------------------------------------------------------------------

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        try:
            content = self._inner.read(file_path)
        except (FileNotFoundError, ValueError, OSError) as exc:
            return EditResult(error=str(exc))

        if old_string not in content:
            return EditResult(error=f"Text to replace not found in '{file_path}'")

        if replace_all:
            count = content.count(old_string)
            new_content = content.replace(old_string, new_string)
        else:
            count = 1
            new_content = content.replace(old_string, new_string, 1)

        try:
            self._inner.write(file_path, new_content)
            return EditResult(path=file_path, occurrences=count)
        except Exception as exc:
            return EditResult(error=str(exc))

    # ------------------------------------------------------------------
    # BackendProtocol — grep
    # ------------------------------------------------------------------

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        try:
            re.compile(pattern)
        except re.error as exc:
            return f"Invalid regex pattern: {exc}"

        if callable(getattr(self._inner, "execute", None)):
            return self._grep_raw_via_execute(pattern, path, glob)
        return self._grep_raw_via_walk(pattern, path, glob)

    def _grep_raw_via_execute(
        self,
        pattern: str,
        path: str | None,
        glob_pattern: str | None,
    ) -> list[GrepMatch]:
        import shlex

        search_root = path or "."
        max_matches = 500

        include_flag = (
            f" --include={shlex.quote(glob_pattern)}"
            if glob_pattern
            else ""
        )
        cmd = (
            f"grep -rn{include_flag}"
            f" --exclude-dir=.git"
            f" -E {shlex.quote(pattern)}"
            f" {shlex.quote(search_root)}"
            f" 2>/dev/null | head -n {max_matches}"
        )
        result = self._inner.execute(cmd)
        stdout = result.stdout if hasattr(result, "stdout") else ""

        if not stdout or not stdout.strip():
            return []

        matches: list[GrepMatch] = []
        for raw_line in stdout.strip().splitlines():
            colon1 = raw_line.find(":")
            if colon1 < 0:
                continue
            colon2 = raw_line.find(":", colon1 + 1)
            if colon2 < 0:
                continue

            file_path = raw_line[:colon1]
            if file_path.startswith("./"):
                file_path = file_path[2:]

            try:
                line_num = int(raw_line[colon1 + 1 : colon2])
            except ValueError:
                continue

            text = raw_line[colon2 + 1 :]
            matches.append(GrepMatch(path=file_path, line=line_num, text=text))

        return matches

    def _grep_raw_via_walk(
        self,
        pattern: str,
        path: str | None,
        glob_pattern: str | None,
    ) -> list[GrepMatch]:
        regex = re.compile(pattern)
        search_root = path or "."
        matches: list[GrepMatch] = []
        max_matches = 500

        def walk(dir_path: str, depth: int) -> None:
            if depth > 10 or len(matches) >= max_matches:
                return
            try:
                entries = self._inner.list_files(dir_path)
            except Exception:
                return
            for name in entries:
                if len(matches) >= max_matches:
                    return
                child = (
                    os.path.join(dir_path, name)
                    if dir_path not in (".", "/")
                    else name
                )
                is_dir = False
                if hasattr(self._inner, "is_directory"):
                    try:
                        is_dir = self._inner.is_directory(child)
                    except Exception:
                        pass
                if is_dir:
                    walk(child, depth + 1)
                else:
                    if glob_pattern and not fnmatch.fnmatch(name, glob_pattern):
                        continue
                    try:
                        content = self._inner.read(child)
                    except Exception:
                        continue
                    for line_num, line in enumerate(content.splitlines(), 1):
                        if len(matches) >= max_matches:
                            return
                        if regex.search(line):
                            matches.append(
                                GrepMatch(path=child, line=line_num, text=line)
                            )

        walk(search_root, depth=0)
        return matches

    # ------------------------------------------------------------------
    # BackendProtocol — glob
    # ------------------------------------------------------------------

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        if callable(getattr(self._inner, "execute", None)):
            return self._glob_info_via_execute(pattern, path)
        return self._glob_info_via_walk(pattern, path)

    def _glob_info_via_execute(
        self, pattern: str, path: str,
    ) -> list[FileInfo]:
        import shlex

        search_path = "." if path in ("/", "") else path
        has_path_component = "/" in pattern or "**" in pattern
        name_part = pattern.rsplit("/", 1)[-1] if "/" in pattern else pattern

        sp = shlex.quote(search_path)
        np = shlex.quote(name_part)
        cmd = (
            f"("
            f"find {sp} -maxdepth 10 -name {np}"
            f" -not -path '*/.git/*' -type d 2>/dev/null | sed 's/^/d /' ; "
            f"find {sp} -maxdepth 10 -name {np}"
            f" -not -path '*/.git/*' -type f 2>/dev/null | sed 's/^/f /'"
            f") | sort -k2 | head -n 5000"
        )
        result = self._inner.execute(cmd)
        stdout = result.stdout if hasattr(result, "stdout") else ""

        if not stdout or not stdout.strip():
            return []

        matched: list[FileInfo] = []
        for line in stdout.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split(" ", 1)
            if len(parts) != 2:
                continue
            file_type, file_path = parts
            if file_path.startswith("./"):
                file_path = file_path[2:]

            if has_path_component and not fnmatch.fnmatch(file_path, pattern):
                continue

            matched.append(FileInfo(path=file_path, is_dir=(file_type == "d")))

        return matched

    def _glob_info_via_walk(
        self, pattern: str, path: str,
    ) -> list[FileInfo]:
        all_files: list[FileInfo] = []

        def walk(dir_path: str, depth: int) -> None:
            if depth > 10 or len(all_files) > 5000:
                return
            try:
                entries = self._inner.list_files(dir_path)
            except Exception:
                return
            for name in entries:
                child = (
                    os.path.join(dir_path, name)
                    if dir_path not in (".", "/")
                    else name
                )
                is_dir = False
                if hasattr(self._inner, "is_directory"):
                    try:
                        is_dir = self._inner.is_directory(child)
                    except Exception:
                        pass
                all_files.append(FileInfo(path=child, is_dir=is_dir))
                if is_dir:
                    walk(child, depth + 1)

        walk(path, depth=0)

        matched: list[FileInfo] = []
        for fi in all_files:
            file_path = fi["path"]
            basename = os.path.basename(file_path)
            if "/" in pattern or "**" in pattern:
                if fnmatch.fnmatch(file_path, pattern):
                    matched.append(fi)
            else:
                if fnmatch.fnmatch(basename, pattern):
                    matched.append(fi)
        return matched

    # ------------------------------------------------------------------
    # BackendProtocol — upload / download
    # ------------------------------------------------------------------

    def upload_files(
        self, files: list[tuple[str, bytes]]
    ) -> list[FileUploadResponse]:
        if hasattr(self._inner, "upload_files"):
            return self._inner.upload_files(files)  # type: ignore[no-any-return]

        responses: list[FileUploadResponse] = []
        for file_path, content in files:
            try:
                self._inner.write(file_path, content.decode("utf-8", errors="replace"))
                responses.append(FileUploadResponse(path=file_path))
            except Exception as exc:
                responses.append(
                    FileUploadResponse(path=file_path, error="permission_denied")
                )
                logger.warning("upload_files failed for '%s': %s", file_path, exc)
        return responses

    def download_files(
        self, paths: list[str]
    ) -> list[FileDownloadResponse]:
        if hasattr(self._inner, "download_files"):
            return self._inner.download_files(paths)  # type: ignore[no-any-return]

        responses: list[FileDownloadResponse] = []
        for file_path in paths:
            try:
                content = self._inner.read(file_path)
                responses.append(
                    FileDownloadResponse(
                        path=file_path,
                        content=content.encode("utf-8"),
                    )
                )
            except FileNotFoundError:
                responses.append(
                    FileDownloadResponse(path=file_path, error="file_not_found")
                )
            except Exception:
                responses.append(
                    FileDownloadResponse(path=file_path, error="permission_denied")
                )
        return responses
