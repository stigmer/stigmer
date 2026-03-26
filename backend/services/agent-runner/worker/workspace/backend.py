"""WorkspaceBackend protocol — the domain port for workspace file operations.

This module defines the interface that all workspace backends must implement.
It abstracts over local filesystem and Daytona sandbox operations so that
the agent-runner's pre-agent setup code (skill writing, attachment injection,
workspace provisioning) operates through a single interface without branching
on deployment mode.

Two layers of backend abstraction exist in the platform:

    Agent Runner (pre-agent setup)
        WorkspaceBackend  <-- this module
            LocalWorkspaceBackend   (worker.workspace.local)
            DaytonaWorkspaceBackend (worker.workspace.daytona)

    Agent Runtime (graphton)
        BackendProtocol   (deepagents.backends.protocol)
            FilesystemBackend  (graphton.core.backends.filesystem)
            DaytonaBackend     (graphton.core.backends.daytona)

WorkspaceBackend is used *before* the agent starts — for provisioning
workspaces, writing skills, and injecting attachments.  BackendProtocol is
used *during* agent execution for tool-driven file I/O.

Virtual platform mount (AD-01 v3):
    When ``platform_dir`` is set, paths under ``.stigmer/`` are routed to
    an external platform directory instead of the workspace root.  This
    isolates platform files (skills, inputs) from the user's project
    without modifying the workspace filesystem.  See
    ``worker.workspace.platform_mount`` for the path classifier.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class ExecuteResult:
    """Result of a shell command executed inside the workspace.

    Mirrors graphton's ``ExecutionResult`` (same fields, same semantics)
    but is our own type to avoid a cross-layer dependency.

    Attributes:
        exit_code: Process exit code (0 = success).
        stdout: Captured standard output.
        stderr: Captured standard error.
    """

    exit_code: int
    stdout: str
    stderr: str


@runtime_checkable
class WorkspaceBackend(Protocol):
    """Unified interface for workspace file and process operations.

    Abstracts over local filesystem (pathlib + subprocess) and Daytona
    sandbox (SDK) backends.  All paths accepted by file methods are
    **relative to the workspace root** — implementations resolve them
    against ``root_dir``.

    Invariants enforced by implementations:
        - ``root_dir`` is an absolute path, set at construction time.
        - ``write_file`` / ``write_files`` auto-create parent directories.
        - Path-traversal attempts (``../`` escaping root) raise
          ``ValueError``.
    """

    @property
    def root_dir(self) -> str:
        """Absolute path to the workspace root directory."""
        ...

    @property
    def platform_dir(self) -> str | None:
        """Absolute path to the platform directory, or ``None``.

        When set, paths under ``.stigmer/`` are resolved against this
        directory instead of ``root_dir``.  Shell commands receive the
        path via the ``$STIGMER_PLATFORM_DIR`` environment variable.
        """
        return None

    def write_file(self, rel_path: str, content: bytes) -> None:
        """Write *content* to a file, creating parent directories as needed.

        Args:
            rel_path: Path relative to ``root_dir``.
            content: Raw bytes to write.
        """
        ...

    def write_files(self, files: Sequence[tuple[str, bytes]]) -> None:
        """Write multiple files in a single operation.

        More efficient than individual ``write_file`` calls in cloud mode
        (batches uploads into one HTTP round-trip).  In local mode this is
        equivalent to looping over ``write_file``.

        Args:
            files: Sequence of ``(rel_path, content)`` tuples.
        """
        ...

    def read_file(self, rel_path: str) -> bytes:
        """Read file contents.

        Args:
            rel_path: Path relative to ``root_dir``.

        Returns:
            File content as raw bytes.

        Raises:
            FileNotFoundError: If the file does not exist.
        """
        ...

    def file_exists(self, rel_path: str) -> bool:
        """Check whether a file or directory exists.

        Args:
            rel_path: Path relative to ``root_dir``.
        """
        ...

    def mkdir(self, rel_path: str) -> None:
        """Create a directory (and all parents) relative to ``root_dir``.

        No-op if the directory already exists.

        Args:
            rel_path: Directory path relative to ``root_dir``.
        """
        ...

    def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        timeout: int = 30,
    ) -> ExecuteResult:
        """Execute a shell command inside the workspace.

        Args:
            command: Shell command string.
            cwd: Working directory relative to ``root_dir``.
                 ``None`` means the workspace root itself.
            timeout: Maximum seconds to wait before killing the process.

        Returns:
            An ``ExecuteResult`` with exit code, stdout, and stderr.
        """
        ...

    def close(self) -> None:
        """Release resources held by the backend.

        Called when the backend is no longer needed.  Implementations that
        allocate external resources (e.g. Daytona process sessions) override
        this to clean up.  The default is a no-op.
        """
        return
