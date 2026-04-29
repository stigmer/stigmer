"""Daytona sandbox backend creation and management.

This module encapsulates all Daytona-specific logic for creating and configuring
Daytona sandbox backends, keeping the main factory clean and focused.

It provides :class:`WorkspaceNormalizingBackend`, a wrapper that translates
agent-space paths into sandbox-relative paths before delegating to the inner
backend.  This serves two purposes:

1. **Double-prefix prevention** -- the agent may pass absolute paths like
   ``/workspace/bin/skills/...`` which the inner ``DaytonaBackend`` would
   resolve to ``/workspace/workspace/bin/skills/...``.  The normaliser
   strips the workspace-root prefix to prevent this.

2. **Volume-mount rebasing** -- when a persistent Daytona volume is mounted
   at a subdirectory of the sandbox home (e.g. ``/home/daytona/workspace``
   while ``get_work_dir()`` returns ``/home/daytona``), the normaliser
   computes a *rebase prefix* (``workspace``) and prepends it to every
   normalised path so the inner backend resolves to the volume mount
   rather than the sandbox home directory.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
import time
from collections.abc import Callable
from typing import Any

from deepagents.backends.protocol import BackendProtocol  # type: ignore[import-untyped]

from graphton.core.backends.gitignore_filter import GitIgnoreFilter
from graphton.core.backends.platform_mount import (
    STIGMER_PLATFORM_DIR_ENV,
    resolve_platform_command,
)
from graphton.core.backends.types import (
    ExecutionResult,
    to_execution_result,
    to_file_list,
    to_is_directory,
)

logger = logging.getLogger(__name__)

_UNSET = object()


# ---------------------------------------------------------------------------
# WorkspaceNormalizingBackend
# ---------------------------------------------------------------------------

class WorkspaceNormalizingBackend:
    """Wraps a backend to normalise paths between agent-space and sandbox-space.

    The external ``DaytonaBackend`` (from ``deepagents_cli``) resolves every
    path relative to ``sandbox.get_work_dir()`` (the *sandbox root*).  If the
    agent constructs an absolute path like ``/workspace/bin/skills/abc/SKILL.md``,
    the inner backend resolves it to ``/workspace/workspace/bin/skills/abc/SKILL.md``
    -- a double-prefix that does not exist.

    This wrapper normalises paths **before** they reach the inner backend,
    matching the chroot-like semantics already present in
    :class:`~graphton.core.backends.filesystem.FilesystemBackend`.

    **Rebase support** (for volume-mounted workspaces):

    When a persistent Daytona volume is mounted at a subdirectory of the
    sandbox root (e.g. ``/home/daytona/workspace`` while the sandbox root is
    ``/home/daytona``), the agent's workspace root differs from the inner
    backend's root.  In this case the wrapper computes a *rebase prefix* --
    the relative path from the sandbox root to the workspace root (e.g.
    ``workspace``) -- and prepends it to every normalised path so the inner
    backend resolves to the volume mount, not the sandbox home.

    When ``sandbox_root`` is not provided (or equals ``workspace_root``), the
    rebase prefix is empty and behaviour is identical to the original
    strip-only normalisation -- fully backward-compatible.

    **Sealed attribute access** — ``__getattr__`` raises ``AttributeError``
    for any attribute not explicitly defined on this class.  The inner
    ``DaytonaBackend`` inherits many methods from ``BaseSandbox``
    (``ls_info``, ``edit``, ``grep_raw``, ``glob_info``, ``aexecute``, etc.)
    that call ``self.execute()`` internally on the *inner* backend, bypassing
    the wrapper's ``cd`` preamble and env-var injection.  Transparent
    forwarding would silently break path normalization for any such method.
    If a new method is needed, add an explicit override here.
    """

    def __init__(
        self,
        inner: Any,  # noqa: ANN401
        workspace_root: str,
        sandbox_root: str | None = None,
        env_vars: dict[str, str] | None = None,
    ) -> None:
        self._inner = inner
        self._workspace_root = workspace_root.rstrip("/")
        self._sandbox_root = (sandbox_root or workspace_root).rstrip("/")
        self._env_vars: dict[str, str] | None = (
            dict(env_vars) if env_vars else None
        )

        # Compute rebase prefix: the relative path from the sandbox root to
        # the workspace root.  When the workspace root is a subdirectory of
        # the sandbox root, paths normalised by stripping the workspace-root
        # prefix need this prefix prepended so the inner backend (which
        # resolves relative to sandbox_root) reaches the correct location.
        #
        # Example:
        #   workspace_root = /home/daytona/workspace
        #   sandbox_root   = /home/daytona
        #   _rebase_prefix = "workspace"
        #
        # When workspace_root == sandbox_root the prefix is empty and
        # behaviour is identical to the original strip-only normalisation.
        if (
            self._workspace_root != self._sandbox_root
            and self._workspace_root.startswith(self._sandbox_root + "/")
        ):
            self._rebase_prefix = self._workspace_root[
                len(self._sandbox_root) + 1 :
            ]
        else:
            self._rebase_prefix = ""

        self._gitignore: GitIgnoreFilter | None | object = _UNSET

        self._dir_cache: dict[str, list[str]] = {}
        self._path_type_cache: dict[str, bool] = {}

        if self._rebase_prefix:
            logger.info(
                "WorkspaceNormalizingBackend: rebase prefix = '%s' "
                "(workspace_root='%s', sandbox_root='%s')",
                self._rebase_prefix,
                self._workspace_root,
                self._sandbox_root,
            )

    # -- identity -----------------------------------------------------------

    @property
    def id(self) -> str:  # noqa: A003
        """Sandbox identifier, forwarded from the inner backend."""
        return self._inner.id  # type: ignore[no-any-return]

    # -- cache management ---------------------------------------------------

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

    # -- gitignore helpers --------------------------------------------------

    def _get_gitignore(self) -> GitIgnoreFilter | None:
        """Return the cached gitignore filter, loading lazily on first call.

        Lazy because the Daytona sandbox may not have a provisioned
        workspace at construction time — ``create_daytona_backend()``
        runs before ``provisioner.provision()``.  By the first
        ``list_files()`` call the workspace is fully provisioned.
        """
        if self._gitignore is _UNSET:
            try:
                content = self._inner.read(self._normalize(".gitignore"))
                self._gitignore = GitIgnoreFilter.from_content(content)
            except Exception:
                self._gitignore = None
        return self._gitignore  # type: ignore[return-value]

    def _workspace_relative(self, path: str) -> str:
        """Extract the workspace-relative portion of *path*.

        Used to build correct relative paths for gitignore matching
        *before* the rebase/normalisation step transforms them into
        sandbox-space coordinates.
        """
        prefix = self._workspace_root + "/"
        if path.startswith(prefix):
            return path[len(prefix):]
        if path == self._workspace_root:
            return "."
        return path.lstrip("/") or "."

    # -- path helpers -------------------------------------------------------

    def _normalize(self, path: str) -> str:
        """Translate an agent-space path into a sandbox-relative path.

        1. Strip the *workspace_root* prefix (prevents double-prefix bug).
        2. Strip leading ``/`` (defense-in-depth).
        3. Prepend the *rebase prefix* when the workspace root is a
           subdirectory of the sandbox root, so the inner backend resolves
           to the volume mount rather than the sandbox home.

        Examples (workspace_root = ``/home/daytona/workspace``,
        sandbox_root = ``/home/daytona``, rebase_prefix = ``workspace``):

        >>> backend._normalize("/home/daytona/workspace/bin/skills/a/SKILL.md")
        'workspace/bin/skills/a/SKILL.md'
        >>> backend._normalize("/home/daytona/workspace")
        'workspace'
        >>> backend._normalize("bin/skills/a/SKILL.md")
        'workspace/bin/skills/a/SKILL.md'
        >>> backend._normalize("/bin/skills/a/SKILL.md")
        'workspace/bin/skills/a/SKILL.md'

        When workspace_root == sandbox_root (no rebase), behaviour is
        identical to the original strip-only normalisation:

        >>> backend._normalize("/workspace/bin/skills/a/SKILL.md")
        'bin/skills/a/SKILL.md'
        >>> backend._normalize("/workspace")
        '.'
        """
        # Step 1 & 2: strip workspace-root prefix or leading slashes.
        prefix = self._workspace_root + "/"
        if path.startswith(prefix):
            relative = path[len(prefix):]
        elif path == self._workspace_root:
            relative = ""
        else:
            # Defense-in-depth: strip leading "/" so ALL paths resolve
            # relative to the workspace root, not the filesystem root.
            relative = path.lstrip("/")

        # Step 3: prepend rebase prefix when workspace root is a
        # subdirectory of the sandbox root.
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

    # -- file-operation methods (path-normalised) ---------------------------

    def read(self, path: str) -> str:
        """Read file contents with path normalisation."""
        return self._inner.read(self._normalize(path))

    def read_file(self, path: str) -> str:
        """Read file contents with path normalisation (alias)."""
        return self._inner.read_file(self._normalize(path))

    def write(self, path: str, content: str) -> None:
        """Write content to file with path normalisation.

        The inner ``DaytonaBackend.write`` has **create-only** semantics:
        it returns ``WriteResult(error="... already exists")`` instead of
        raising when the file exists.  This wrapper detects that error,
        deletes the file, and retries — giving the ``write`` tool the
        overwrite behaviour that agents (and ``FilesystemBackend``) expect.
        """
        self._invalidate_cache()
        norm = self._normalize(path)
        result = self._inner.write(norm, content)
        error = getattr(result, "error", None)
        if error and "already exists" in str(error):
            logger.debug(
                "Inner write returned 'already exists' for '%s'; "
                "deleting and retrying",
                norm,
            )
            safe = shlex.quote(norm)
            self._inner.execute(f"rm -f {safe}")
            result = self._inner.write(norm, content)
            error = getattr(result, "error", None)
        if error:
            raise RuntimeError(f"Failed to write '{path}': {error}")

    def write_file(self, path: str, content: str) -> None:
        """Write content to file with path normalisation (alias)."""
        self.write(path, content)

    def list_files(self, path: str = ".") -> list[str]:
        """List directory contents with path normalisation and gitignore filtering.

        Results are cached per-instance; ``write()``, ``write_file()``,
        and ``execute()`` invalidate the cache.
        """
        norm_path = self._normalize(path)
        cached = self._dir_cache.get(norm_path)
        if cached is not None:
            return list(cached)

        entries = to_file_list(self._inner, norm_path)
        gitignore = self._get_gitignore()
        if gitignore is not None:
            ws_rel = self._workspace_relative(path)
            entries = [
                name for name in entries
                if not gitignore.is_ignored(
                    f"{ws_rel}/{name}" if ws_rel not in (".", "") else name,
                    is_dir=None,
                )
            ]

        self._dir_cache[norm_path] = entries
        return list(entries)

    def is_directory(self, path: str) -> bool:
        """Check whether path is a directory, with path normalisation.

        Results are cached per-instance; ``write()``, ``write_file()``,
        and ``execute()`` invalidate the cache.
        """
        norm_path = self._normalize(path)
        cached = self._path_type_cache.get(norm_path)
        if cached is not None:
            return cached
        result = to_is_directory(self._inner, norm_path)
        self._path_type_cache[norm_path] = result
        return result

    def delete(self, path: str) -> str:
        """Delete a file with path normalisation.

        Only regular files may be deleted. The path is normalised to
        sandbox-relative form before delegating to the inner backend via
        ``execute("rm ...")``.  Using ``rm`` (not ``rm -rf``) ensures
        directories are rejected at the shell level, matching the
        files-only semantics of :class:`FilesystemBackend.delete`.

        Args:
            path: Agent-space path to the file.

        Returns:
            Confirmation message.

        Raises:
            RuntimeError: If the file does not exist or the rm command fails.
        """
        self._invalidate_cache()
        norm_path = self._normalize(path)
        safe_path = shlex.quote(norm_path)
        result = to_execution_result(
            self._inner.execute(f"rm {safe_path}"),
        )
        if result.exit_code != 0:
            stderr = result.stderr.strip() if result.stderr else ""
            if "No such file" in stderr or "cannot remove" in stderr:
                raise FileNotFoundError(
                    f"File not found: '{path}' (normalised to '{norm_path}')"
                )
            raise RuntimeError(
                f"Failed to delete '{path}': {stderr or 'unknown error'}"
            )
        return f"Deleted '{path}'"

    def execute(self, command: str, **kwargs: Any) -> ExecutionResult:
        """Execute shell command from the workspace root with injected env vars.

        The inner ``DaytonaBackend`` runs commands from the *sandbox* root
        (e.g. ``/home/daytona``), not the *workspace* root (e.g.
        ``/home/daytona/workspace``).  This method prepends
        ``cd <workspace_root> &&`` so that user commands, as well as
        shell-based tools (``glob``, ``grep``, ``search``), resolve
        relative paths against the workspace — matching the behaviour of
        :class:`~graphton.core.backends.filesystem.FilesystemBackend`
        which uses ``subprocess.run(cwd=self.root_dir)``.

        ``.stigmer/`` virtual-mount references are resolved to
        ``$STIGMER_PLATFORM_DIR`` when platform files have been deployed
        (parity with :meth:`FilesystemBackend.execute`).

        Final shell shape::

            export FOO='bar'; cd '/home/daytona/workspace' && <user_command>

        Exports run unconditionally (```;```), then ``cd`` gates the user
        command via ``&&`` — if ``cd`` fails the user command does not run.
        """
        self._invalidate_cache()
        if self._env_vars and STIGMER_PLATFORM_DIR_ENV in self._env_vars:
            command = resolve_platform_command(command)
        command = f"cd {shlex.quote(self._workspace_root)} && {command}"
        if self._env_vars:
            exports = "; ".join(
                f"export {k}={shlex.quote(v)}"
                for k, v in self._env_vars.items()
            )
            command = f"{exports}; {command}"
        raw = self._inner.execute(command, **kwargs)
        return to_execution_result(raw)

    async def execute_streaming(
        self,
        command: str,
        timeout: int = 120,
        on_chunk: Callable[[str], None] | None = None,
    ) -> ExecutionResult:
        """Execute shell command with live streaming from the workspace root.

        Applies the same ``cd`` preamble and env-var injection as
        :meth:`execute`, then delegates to the inner backend's
        ``execute_streaming`` if available.  Falls back to the sync
        :meth:`execute` via ``asyncio.to_thread`` when the inner backend
        does not support streaming.

        Without this explicit override, ``__getattr__`` would forward
        ``execute_streaming`` directly to the inner backend, bypassing
        the ``cd`` preamble — the same bug that :meth:`execute` fixes.
        """
        self._invalidate_cache()
        if self._env_vars and STIGMER_PLATFORM_DIR_ENV in self._env_vars:
            command = resolve_platform_command(command)
        command = f"cd {shlex.quote(self._workspace_root)} && {command}"
        if self._env_vars:
            exports = "; ".join(
                f"export {k}={shlex.quote(v)}"
                for k, v in self._env_vars.items()
            )
            command = f"{exports}; {command}"

        inner_streaming = getattr(self._inner, "execute_streaming", None)
        if callable(inner_streaming):
            raw = await inner_streaming(
                command, timeout=timeout, on_chunk=on_chunk,
            )
            return to_execution_result(raw)

        raw = await asyncio.to_thread(
            self._inner.execute, command, timeout=timeout,
        )
        return to_execution_result(raw)

    # -- sealed attribute access ---------------------------------------------

    def __getattr__(self, name: str) -> Any:  # noqa: ANN401
        """Raise ``AttributeError`` for any attribute not explicitly defined.

        Previous versions forwarded unknown attributes to the inner backend
        via ``getattr(self._inner, name)``.  This was an escape hatch that
        silently bypassed path normalization and the ``cd`` preamble for
        methods inherited by the inner ``DaytonaBackend`` from
        ``BaseSandbox`` (``ls_info``, ``edit``, ``grep_raw``, ``glob_info``,
        ``aexecute``, etc.) — all of which call ``self.execute()`` on the
        *inner* backend, not the wrapper.

        If a new method on the inner backend needs to be accessible, add an
        explicit override here with appropriate path normalization / ``cd``
        preamble rather than reopening the forwarding escape hatch.
        """
        raise AttributeError(
            f"'{type(self).__name__}' has no attribute '{name}'. "
            f"If '{name}' is a method on the inner backend that should be "
            f"accessible, add an explicit override with path normalization."
        )


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

    When a ``workspace_root`` is provided in *config* (typically the volume
    mount path such as ``/home/daytona/workspace``), it is used as the
    agent-facing workspace root for path normalisation.  The sandbox's own
    working directory (``sandbox.get_work_dir()``) is passed as
    *sandbox_root* to :class:`WorkspaceNormalizingBackend`, enabling the
    rebase logic that translates between the two roots.

    Args:
        config: Configuration dictionary with optional keys:
            - api_key: Daytona API key (falls back to ``DAYTONA_API_KEY``
              env var)
            - sandbox_id: Existing sandbox ID to reuse
            - snapshot_id: Snapshot ID to create sandbox from
            - workspace_root: Agent-facing workspace root (e.g. the
              volume mount path).  When omitted the sandbox's working
              directory is used (backward-compatible).

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

    # Discover sandbox root -- what the inner DaytonaBackend resolves
    # paths relative to.
    try:
        sandbox_root = sandbox.get_work_dir().rstrip("/")
        logger.info("Daytona sandbox root (get_work_dir): %s", sandbox_root)
    except Exception as exc:
        sandbox_root = "/home/daytona"
        logger.warning(
            "sandbox.get_work_dir() failed (%s); defaulting sandbox root "
            "to %s",
            exc,
            sandbox_root,
        )

    # Determine agent-facing workspace root.  When a volume is mounted the
    # caller passes workspace_root via config (e.g. "/home/daytona/workspace").
    # Otherwise fall back to the sandbox root for backward compatibility.
    configured_workspace_root = config.get("workspace_root")
    if configured_workspace_root:
        workspace_root = configured_workspace_root.rstrip("/")
        logger.info(
            "Using configured workspace root: %s (sandbox root: %s)",
            workspace_root,
            sandbox_root,
        )
    else:
        workspace_root = sandbox_root
        logger.info("Using sandbox root as workspace root: %s", workspace_root)

    env_vars = config.get("env_vars")

    inner = DaytonaBackend(sandbox)
    return WorkspaceNormalizingBackend(
        inner,
        workspace_root,
        sandbox_root=sandbox_root,
        env_vars=env_vars,
    )


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
    
    params = CreateSandboxFromSnapshotParams(
        snapshot=snapshot_id,
        auto_stop_interval=5,
        auto_archive_interval=5,
        auto_delete_interval=-1,
    )
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
