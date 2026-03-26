"""Shared types for graphton backend implementations.

Defines the canonical result types that all graphton backends must return
from execution operations.  Keeping these in a standalone module avoids
circular imports and provides a single import target for both backend
implementations and consumers (e.g. tool wrappers).
"""

from __future__ import annotations

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
