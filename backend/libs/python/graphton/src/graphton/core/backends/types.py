"""Shared types and normalizers for graphton backend implementations.

Defines the canonical result types that all graphton backends must return
from execution and file operations.  Keeping these in a standalone module
avoids circular imports and provides a single import target for both
backend implementations and consumers (e.g. tool wrappers).

Normalizer functions bridge the contract gap between graphton's internal
API (``list_files``, ``is_directory``, ``execute`` → ``ExecutionResult``)
and deepagents' ``SandboxBackendProtocol`` (``ls_info``, ``execute`` →
``ExecuteResponse``).  Each normalizer probes the backend for the method
it supports and translates the response into graphton's canonical form.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ExecutionResult:
    """Result of a shell command execution.

    This is graphton's canonical execution result type.  All backend
    ``execute()`` implementations must return an ``ExecutionResult``
    (or the adapter layer must translate into one) so that downstream
    consumers — particularly ``_create_execute_tool`` in tool_wrappers —
    can rely on a stable, typed contract.

    Attributes:
        exit_code: Command exit code (0 for success).
        stdout: Standard output from the command.
        stderr: Standard error from the command.
    """

    exit_code: int
    stdout: str
    stderr: str


def to_execution_result(raw: Any) -> ExecutionResult:  # noqa: ANN401
    """Normalise an arbitrary execution response into an ``ExecutionResult``.

    Handles three shapes transparently:

    1. Already an ``ExecutionResult`` — returned as-is.
    2. Has ``.stdout`` / ``.stderr`` (e.g. graphton's ``FilesystemBackend``)
       — fields are read directly.
    3. Has ``.output`` but no ``.stdout`` (e.g. deepagents'
       ``ExecuteResponse``) — ``.output`` is mapped to ``stdout`` and
       ``stderr`` is left empty.

    This keeps the translation logic in one place so every adapter that
    wraps a third-party backend can call ``to_execution_result()``
    instead of duplicating attribute-sniffing code.
    """
    if isinstance(raw, ExecutionResult):
        return raw

    exit_code: int = getattr(raw, "exit_code", 1) or 0

    stdout = getattr(raw, "stdout", None) or ""
    if not stdout:
        stdout = getattr(raw, "output", None) or ""

    stderr = getattr(raw, "stderr", None) or ""

    return ExecutionResult(exit_code=exit_code, stdout=stdout, stderr=stderr)


# ---------------------------------------------------------------------------
# File-listing normalizer
# ---------------------------------------------------------------------------


def _extract_entry_name(fi: Any) -> str:  # noqa: ANN401
    """Extract the bare entry name from a ``FileInfo``-like object.

    ``FileInfo`` from deepagents may be a ``TypedDict`` (dict) or a
    dataclass/namedtuple with a ``path`` attribute.  The ``path`` value
    may be a full relative path (``src/main.py``) or just a name
    (``main.py``); we always return the basename so the result matches
    graphton's ``list_files`` contract (bare entry names only).
    """
    if isinstance(fi, dict):
        raw_path: str = fi.get("path", "")
    else:
        raw_path = getattr(fi, "path", "")
    return os.path.basename(raw_path)


def to_file_list(inner: Any, path: str) -> list[str]:  # noqa: ANN401
    """List directory entries using whichever method the backend provides.

    Bridges between graphton's ``list_files(path) -> list[str]`` and
    deepagents' ``ls_info(path) -> list[FileInfo]``.

    Preference order:

    1. ``inner.list_files(path)`` — graphton's native method.
    2. ``inner.ls_info(path)``    — deepagents' ``SandboxBackendProtocol``.

    When falling back to ``ls_info``, each ``FileInfo`` is reduced to its
    basename so the return type matches ``list[str]``.
    """
    if hasattr(inner, "list_files"):
        return inner.list_files(path)

    if hasattr(inner, "ls_info"):
        raw = inner.ls_info(path)
        return [_extract_entry_name(fi) for fi in raw]

    raise AttributeError(
        f"{type(inner).__name__} provides neither list_files() nor "
        f"ls_info() — cannot list directory contents"
    )


# ---------------------------------------------------------------------------
# is_directory normalizer
# ---------------------------------------------------------------------------


def _extract_is_dir(fi: Any) -> bool:  # noqa: ANN401
    """Extract the ``is_dir`` flag from a ``FileInfo``-like object."""
    if isinstance(fi, dict):
        return bool(fi.get("is_dir", False))
    return bool(getattr(fi, "is_dir", False))


def to_is_directory(inner: Any, path: str) -> bool:  # noqa: ANN401
    """Check whether *path* is a directory using whichever method the backend provides.

    Preference order:

    1. ``inner.is_directory(path)`` — graphton's native method.
    2. ``inner.ls_info(parent)``    — list the parent directory via
       deepagents' protocol and inspect the matching entry's ``is_dir``
       flag.

    Returns ``False`` when neither method is available or the entry is
    not found in the parent listing (defensive — avoids crashes in
    non-critical display logic).
    """
    if hasattr(inner, "is_directory"):
        return inner.is_directory(path)

    if hasattr(inner, "ls_info"):
        parent = os.path.dirname(path) or "."
        name = os.path.basename(path)
        try:
            for fi in inner.ls_info(parent):
                if _extract_entry_name(fi) == name:
                    return _extract_is_dir(fi)
        except Exception:
            pass

    return False
