"""Daytona sandbox backend creation and management.

This module encapsulates all Daytona-specific logic for creating and configuring
Daytona sandbox backends, keeping the main factory clean and focused.

It also provides :class:`WorkspaceNormalizingBackend`, a thin wrapper that
strips the workspace-root prefix from every path argument before delegating
to the inner backend.  This prevents the *double-prefix* bug where the agent
passes ``/workspace/bin/skills/...`` and the external ``DaytonaBackend``
resolves it to ``/workspace/workspace/bin/skills/...``.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from deepagents.backends.protocol import BackendProtocol  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# WorkspaceNormalizingBackend
# ---------------------------------------------------------------------------

class WorkspaceNormalizingBackend:
    """Wraps a backend to strip workspace-root prefixes from paths.

    The external ``DaytonaBackend`` (from ``deepagents_cli``) resolves every
    path relative to ``sandbox.get_work_dir()`` (typically ``/workspace``).
    If the agent constructs an absolute path like
    ``/workspace/bin/skills/abc/SKILL.md``, the inner backend resolves it to
    ``/workspace/workspace/bin/skills/abc/SKILL.md`` -- a double-prefix that
    does not exist.

    This wrapper normalises paths **before** they reach the inner backend,
    matching the chroot-like semantics already present in
    :class:`~graphton.core.backends.filesystem.FilesystemBackend`.

    Any method not explicitly overridden is forwarded transparently via
    ``__getattr__``, so the wrapper is fully compatible with
    ``BackendProtocol`` without hard-coding every method signature.
    """

    def __init__(self, inner: Any, workspace_root: str) -> None:  # noqa: ANN401
        self._inner = inner
        self._workspace_root = workspace_root.rstrip("/")

    # -- path helpers -------------------------------------------------------

    def _normalize(self, path: str) -> str:
        """Strip the workspace-root prefix if present.

        Examples (assuming *workspace_root* = ``/workspace``):

        >>> backend._normalize("/workspace/bin/skills/a/SKILL.md")
        'bin/skills/a/SKILL.md'
        >>> backend._normalize("/workspace")
        '.'
        >>> backend._normalize("bin/skills/a/SKILL.md")
        'bin/skills/a/SKILL.md'
        """
        prefix = self._workspace_root + "/"
        if path.startswith(prefix):
            stripped = path[len(prefix):]
            logger.debug(
                "Normalized path: '%s' -> '%s' (stripped workspace root '%s')",
                path, stripped, self._workspace_root,
            )
            return stripped
        if path == self._workspace_root:
            return "."
        return path

    # -- file-operation methods (path-normalised) ---------------------------

    def read(self, path: str) -> str:
        """Read file contents with path normalisation."""
        return self._inner.read(self._normalize(path))

    def read_file(self, path: str) -> str:
        """Read file contents with path normalisation (alias)."""
        return self._inner.read_file(self._normalize(path))

    def write(self, path: str, content: str) -> None:
        """Write content to file with path normalisation."""
        return self._inner.write(self._normalize(path), content)

    def write_file(self, path: str, content: str) -> None:
        """Write content to file with path normalisation (alias)."""
        return self._inner.write_file(self._normalize(path), content)

    def list_files(self, path: str = ".") -> list[str]:
        """List directory contents with path normalisation."""
        return self._inner.list_files(self._normalize(path))

    def execute(self, command: str, **kwargs: Any) -> Any:  # noqa: ANN401
        """Execute shell command -- no path normalisation needed."""
        return self._inner.execute(command, **kwargs)

    # -- transparent delegation for everything else -------------------------

    def __getattr__(self, name: str) -> Any:  # noqa: ANN401
        """Forward any attribute not explicitly defined to the inner backend."""
        return getattr(self._inner, name)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_daytona_backend(config: dict[str, Any]) -> BackendProtocol:
    """Create Daytona sandbox backend from configuration.

    Handles three sandbox creation modes:

    1. Reuse existing sandbox (via *sandbox_id*) -- fastest, preserves state
    2. Create from snapshot (via *snapshot_id*) -- fast, pre-configured
    3. Create vanilla sandbox -- clean slate

    The returned backend is wrapped in :class:`WorkspaceNormalizingBackend`
    so that workspace-root-prefixed paths (e.g. ``/workspace/bin/skills/…``)
    are normalised before reaching the inner ``DaytonaBackend``.

    Args:
        config: Configuration dictionary with optional keys:
            - api_key: Daytona API key (falls back to ``DAYTONA_API_KEY``
              env var)
            - sandbox_id: Existing sandbox ID to reuse
            - snapshot_id: Snapshot ID to create sandbox from

    Returns:
        A :class:`WorkspaceNormalizingBackend` wrapping a ``DaytonaBackend``.

    Raises:
        ValueError: If required dependencies are missing or API key not
            provided.
        RuntimeError: If sandbox creation/connection fails.
    """
    # Import Daytona dependencies only when needed
    try:
        from daytona import Daytona, DaytonaConfig  # type: ignore[import-not-found]
        from daytona.common.daytona import (  # type: ignore[import-not-found]
            CreateSandboxFromSnapshotParams,
        )
        from deepagents_cli.integrations.daytona import (  # type: ignore[import-not-found]
            DaytonaBackend,
        )
    except ImportError as e:
        raise ValueError(
            f"Daytona backend requires 'daytona' package. "
            f"Install with: pip install daytona>=0.113.0\nError: {e}"
        ) from e

    # Get API key from config or environment
    api_key = config.get("api_key") or os.environ.get("DAYTONA_API_KEY")
    if not api_key:
        raise ValueError(
            "Daytona API key required. Provide via config['api_key'] or "
            "DAYTONA_API_KEY environment variable."
        )

    # Get optional parameters from config
    sandbox_id = config.get("sandbox_id")  # Reuse existing sandbox
    snapshot_id = config.get("snapshot_id")  # Create from snapshot

    # Create Daytona client
    daytona = Daytona(DaytonaConfig(api_key=api_key))

    # Create or reuse sandbox based on config
    if sandbox_id:
        sandbox = _reuse_existing_sandbox(daytona, sandbox_id)
    elif snapshot_id:
        sandbox = _create_from_snapshot(daytona, snapshot_id)
    else:
        sandbox = _create_vanilla_sandbox(daytona)

    # Discover workspace root so the normalising wrapper can strip it
    try:
        workspace_root = sandbox.get_work_dir().rstrip("/")
        logger.info("Daytona workspace root: %s", workspace_root)
    except Exception as exc:
        workspace_root = "/workspace"
        logger.warning(
            "sandbox.get_work_dir() failed (%s); defaulting workspace root "
            "to %s for path normalisation",
            exc,
            workspace_root,
        )

    inner = DaytonaBackend(sandbox)
    return WorkspaceNormalizingBackend(inner, workspace_root)


def _reuse_existing_sandbox(daytona: Any, sandbox_id: str) -> Any:
    """Reuse existing sandbox (for skills, persistent state, etc.)."""
    try:
        sandbox = daytona.get(sandbox_id)
    except Exception as e:
        raise RuntimeError(
            f"Failed to retrieve existing sandbox {sandbox_id}: {e}"
        ) from e
    
    # Verify sandbox is alive and responsive
    try:
        result = sandbox.process.exec("echo ready", timeout=5)
        if result.exit_code != 0:
            raise RuntimeError(f"Sandbox {sandbox_id} is not responsive")
    except Exception as e:
        raise RuntimeError(
            f"Failed to connect to existing sandbox {sandbox_id}: {e}"
        ) from e
    
    return sandbox


def _create_from_snapshot(daytona: Any, snapshot_id: str) -> Any:
    """Create sandbox from pre-built snapshot for instant spin-up."""
    from daytona.common.daytona import (  # type: ignore[import-not-found]
        CreateSandboxFromSnapshotParams,
    )
    
    params = CreateSandboxFromSnapshotParams(snapshot=snapshot_id)
    sandbox = daytona.create(params=params)
    
    _wait_for_sandbox_ready(sandbox)
    return sandbox


def _create_vanilla_sandbox(daytona: Any) -> Any:
    """Create vanilla sandbox from scratch."""
    sandbox = daytona.create()
    _wait_for_sandbox_ready(sandbox)
    return sandbox


def _wait_for_sandbox_ready(sandbox: Any, timeout_seconds: int = 180) -> None:
    """Poll until sandbox is ready or timeout.
    
    Args:
        sandbox: Daytona sandbox instance.
        timeout_seconds: Maximum time to wait (default: 180s).
    
    Raises:
        RuntimeError: If sandbox fails to start within timeout.
    """
    poll_interval = 2  # seconds
    max_attempts = timeout_seconds // poll_interval
    
    for _ in range(max_attempts):
        try:
            result = sandbox.process.exec("echo ready", timeout=5)
            if result.exit_code == 0:
                return  # Sandbox is ready
        except Exception:
            pass  # Continue polling
        time.sleep(poll_interval)
    
    # Timeout - cleanup and raise
    try:
        sandbox.delete()
    finally:
        raise RuntimeError(
            f"Daytona sandbox failed to start within {timeout_seconds} seconds"
        )
