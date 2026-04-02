"""Sandbox manager for Daytona-based execution.

This module manages the Daytona sandbox lifecycle: creation, reuse via
session persistence, state-aware recovery, and cleanup.
"""

import logging
import time
from collections.abc import Callable
from typing import Any

try:
    from daytona import (
        Daytona,
        DaytonaConfig,
        DaytonaNotFoundError,
        SandboxState,
    )
    from daytona.common.daytona import CreateSandboxFromSnapshotParams
    DAYTONA_AVAILABLE = True
except ImportError:
    DAYTONA_AVAILABLE = False

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Daytona workspace constants
# ---------------------------------------------------------------------------
# DAYTONA_WORKSPACE_MOUNT_PATH is the absolute path inside the sandbox used
# as the workspace root for all agent file operations (skills, attachments,
# git clones, agent work products).  The directory lives on the sandbox's
# local overlay filesystem — volume mounts were removed because FUSE+S3
# throughput (~1 file/s) made git checkout infeasible for large repos.
# DaytonaWorkspaceBackend creates this directory at construction time.
# Consumers that need the agent's workspace root should import this
# constant rather than hard-coding paths.
# ---------------------------------------------------------------------------

DAYTONA_WORKSPACE_MOUNT_PATH: str = "/home/daytona/workspace"
"""Absolute workspace root path inside Daytona sandboxes (local overlay)."""


# ---------------------------------------------------------------------------
# Worker-level Daytona volume state (DEAD CODE — preserved for future use)
# ---------------------------------------------------------------------------
# Volume mounts are disabled in production.  The functions below are retained
# so volume support can be re-enabled without reimplementation if a concrete
# use case arises.  See _create_daytona_sandbox() for the disable rationale.
# ---------------------------------------------------------------------------

_daytona_volume_id: str | None = None


def get_daytona_volume_id() -> str | None:
    """Return the Daytona volume ID set at worker startup, or *None*."""
    return _daytona_volume_id


def set_daytona_volume_id(volume_id: str) -> None:
    """Store the Daytona volume ID (called once at worker startup)."""
    global _daytona_volume_id
    _daytona_volume_id = volume_id


def initialize_daytona_volume(
    api_key: str,
    volume_name: str = "stigmer-workspaces",
) -> str:
    """Create or retrieve the global Daytona persistent volume.

    Called **once** at worker startup.  Uses Daytona's idempotent
    ``volume.get(name, create=True)`` so the call is safe to retry on
    worker restarts.  The resulting volume ID is stored in the
    module-level store for activities to read via
    :func:`get_daytona_volume_id`.

    Args:
        api_key: Daytona API key.
        volume_name: Human-readable volume name.  Configurable via the
            ``DAYTONA_VOLUME_NAME`` environment variable (default:
            ``"stigmer-workspaces"``).

    Returns:
        The volume ID string.

    Raises:
        RuntimeError: If the Daytona SDK is not installed.
        Exception: Any error from the Daytona Volume API (propagated).
    """
    if not DAYTONA_AVAILABLE:
        raise RuntimeError(
            "Daytona SDK not available. Install with: pip install daytona"
        )

    daytona = Daytona(DaytonaConfig(api_key=api_key))
    volume = daytona.volume.get(volume_name, create=True)
    set_daytona_volume_id(volume.id)

    logger.info(
        "Daytona volume initialized: name='%s', id='%s'",
        volume_name,
        volume.id,
    )
    return volume.id


class SandboxManager:
    """Manages Daytona sandbox lifecycle: creation, session-based reuse,
    state-aware recovery (restart/restore/recover), and cleanup.
    """

    def __init__(
        self,
        daytona_api_key: str | None = None,
        volume_id: str | None = None,
    ):
        """Initialize SandboxManager.

        Args:
            daytona_api_key: Daytona API key.
            volume_id: Daytona volume ID for persistent workspace mounting.
                Initialized at worker startup via :func:`initialize_daytona_volume`
                and passed here by the activity.  When set, new sandboxes are
                created with a ``VolumeMount`` using a per-session subpath.
        """
        self._daytona: Any = None
        self._daytona_api_key = daytona_api_key
        self._volume_id = volume_id

        logger.info("SandboxManager initialized")

    async def get_or_create_daytona_sandbox(
        self,
        sandbox_config: dict,
        session_id: str | None,
        session_client: Any | None,
        heartbeat_fn: Callable[[str], None] | None = None,
    ) -> tuple[Any, bool]:
        """Get or create Daytona sandbox (legacy cloud mode).
        
        This method maintains backward compatibility with existing Daytona-based
        cloud deployments.
        
        Args:
            sandbox_config: Sandbox configuration dict
            session_id: Session ID for persistence
            session_client: Session client for updates
            heartbeat_fn: Optional callback invoked periodically during sandbox
                creation to keep the Temporal activity alive.  Receives a short
                status string describing the current phase.
            
        Returns:
            (sandbox, is_new): Tuple of sandbox instance and whether it was newly created
        """
        if not DAYTONA_AVAILABLE:
            raise RuntimeError("Daytona library not available. Install with: pip install daytona")
        
        # Initialize Daytona client if needed
        if self._daytona is None:
            if not self._daytona_api_key:
                raise ValueError("DAYTONA_API_KEY required for cloud mode")
            self._daytona = Daytona(DaytonaConfig(api_key=self._daytona_api_key))
        
        # Try to reuse existing sandbox if session exists
        if session_id and session_client:
            logger.info(f"Checking for existing Daytona sandbox in session {session_id}")
            
            try:
                session = await session_client.get(session_id)
                existing_sandbox_id = session.spec.sandbox_id
                
                if existing_sandbox_id:
                    logger.info(f"Found existing sandbox_id: {existing_sandbox_id}")

                    try:
                        sandbox = self._daytona.get(existing_sandbox_id)
                    except DaytonaNotFoundError:
                        logger.info(
                            "Sandbox %s no longer exists "
                            "(deleted/expired), will create new",
                            existing_sandbox_id,
                        )
                    except Exception as e:
                        logger.warning(
                            "Failed to fetch sandbox %s: %s. "
                            "Creating new sandbox.",
                            existing_sandbox_id,
                            e,
                        )
                    else:
                        # Sandbox object retrieved — attempt state-aware
                        # recovery (restart / restore / recover).
                        if self._try_revive_daytona_sandbox(sandbox):
                            logger.info(
                                "Reusing revived Daytona sandbox %s "
                                "for session %s",
                                existing_sandbox_id,
                                session_id,
                            )
                            return (sandbox, False)
                        else:
                            logger.warning(
                                "Sandbox %s could not be revived "
                                "(state: %s), creating new sandbox",
                                existing_sandbox_id,
                                sandbox.state.value
                                if hasattr(sandbox.state, "value")
                                else sandbox.state,
                            )
                else:
                    logger.info(f"Session {session_id} has no sandbox_id, creating new sandbox")
                    
            except Exception as e:
                logger.error(f"Failed to fetch session {session_id}: {e}")
        else:
            logger.info("No session_id provided - creating ephemeral Daytona sandbox")
        
        # Create new Daytona sandbox
        logger.info(f"Creating new Daytona sandbox with config: {sandbox_config}")
        sandbox = self._create_daytona_sandbox(
            sandbox_config, session_id=session_id, heartbeat_fn=heartbeat_fn,
        )
        logger.info(f"✨ Created new Daytona sandbox: {sandbox.id}")
        
        # Store sandbox_id in session via field-level RPC (race-safe).
        # This atomically sets only spec.sandbox_id on the server, avoiding
        # the lost-update race with GenerateSessionSubject which concurrently
        # updates spec.subject on the same session.
        if session_id and session_client:
            try:
                await session_client.update_sandbox_id(session_id, sandbox.id)
                logger.info(f"💾 Stored sandbox {sandbox.id} in session {session_id}")
            except Exception as e:
                logger.error(
                    f"Failed to store sandbox_id in session {session_id}: {e}. "
                    "Continuing with execution."
                )
        
        return (sandbox, True)
    
    def _create_daytona_sandbox(
        self,
        config: dict,
        session_id: str | None = None,
        heartbeat_fn: Callable[[str], None] | None = None,
    ) -> Any:
        """Create new Daytona sandbox with polling for readiness.
        
        When a ``volume_id`` was provided at construction time **and** a
        ``session_id`` is given, the sandbox is created with a
        :class:`VolumeMount` that maps the persistent volume into
        :data:`DAYTONA_WORKSPACE_MOUNT_PATH` using the subpath
        ``sessions/{session_id}``.  This ensures workspace files survive
        sandbox lifecycle events.
        
        Args:
            config: Sandbox configuration dict (must have ``type: "daytona"``).
            session_id: Session identifier for volume subpath isolation.
                When *None*, the sandbox is created without a volume mount
                (ephemeral).
            heartbeat_fn: Optional callback invoked every ~30 s during the
                readiness polling loop to keep the Temporal activity alive.
            
        Returns:
            Daytona Sandbox instance
        """
        if not isinstance(config, dict):
            raise ValueError(f"sandbox_config must be a dictionary, got {type(config).__name__}")
        
        sandbox_type = config.get("type")
        if sandbox_type != "daytona":
            raise ValueError(f"Only 'daytona' sandbox type supported, got: {sandbox_type}")
        
        snapshot_id = config.get("snapshot_id")
        
        # Volume mounts disabled — sandbox uses local overlay filesystem.
        # FUSE+S3 volumes have ~1 file/s write throughput which causes
        # git checkout to take ~149 min for repos with thousands of files,
        # exceeding the 300s clone timeout.  Cloning to local overlay
        # completes in ~4s.
        if not session_id:
            logger.info(
                "No session_id -- creating ephemeral sandbox"
            )
        
        try:
            # Create sandbox (with optional snapshot and/or volume mount)
            if snapshot_id:
                logger.info(f"Creating Daytona sandbox from snapshot: {snapshot_id}")
                params = CreateSandboxFromSnapshotParams(
                    snapshot=snapshot_id,
                    auto_stop_interval=5,
                    auto_archive_interval=5,
                    auto_delete_interval=-1,
                )
                sandbox = self._daytona.create(params=params)
            else:
                logger.info("Creating vanilla Daytona sandbox (no snapshot)")
                sandbox = self._daytona.create()
            
            logger.info(f"Daytona sandbox created: {sandbox.id}, waiting for readiness...")
            
            if heartbeat_fn:
                heartbeat_fn(f"sandbox_created:{sandbox.id}")

            # Poll until ready (max 180 seconds).
            # Heartbeat every ~30 s (every 15th iteration of the 2 s loop)
            # to keep the Temporal activity alive during this synchronous wait.
            heartbeat_every = 15  # 15 × 2 s = 30 s
            for attempt in range(90):
                try:
                    result = sandbox.process.exec("echo ready", timeout=5)
                    if result.exit_code == 0:
                        logger.info(f"Daytona sandbox {sandbox.id} ready after {attempt * 2}s")
                        return sandbox
                except Exception as e:
                    if attempt % 10 == 0:
                        logger.debug(f"Daytona sandbox not ready yet (attempt {attempt}/90): {e}")
                
                if heartbeat_fn and attempt > 0 and attempt % heartbeat_every == 0:
                    heartbeat_fn(f"sandbox_polling:{sandbox.id}:{attempt * 2}s")

                time.sleep(2)
            
            # Timeout - cleanup and raise
            logger.error(f"Daytona sandbox {sandbox.id} failed to become ready within 180 seconds")
            try:
                sandbox.delete()
                logger.info(f"Cleaned up failed Daytona sandbox {sandbox.id}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup Daytona sandbox {sandbox.id}: {cleanup_error}")
            
            raise RuntimeError(
                f"Daytona sandbox {sandbox.id} failed to start within 180 seconds"
            )
            
        except Exception as e:
            logger.error(f"Daytona sandbox creation failed: {e}")
            raise RuntimeError(f"Failed to create Daytona sandbox: {e}") from e
    
    def _is_daytona_sandbox_alive(self, sandbox: Any) -> bool:
        """Check if Daytona sandbox is alive and responsive.
        
        Args:
            sandbox: Daytona Sandbox instance
            
        Returns:
            True if sandbox is responsive
        """
        try:
            result = sandbox.process.exec("echo alive", timeout=5)
            is_alive = result.exit_code == 0
            
            if is_alive:
                logger.debug(f"Daytona sandbox {sandbox.id} health check: ✅ ALIVE")
            else:
                logger.warning(f"Daytona sandbox {sandbox.id} health check: ❌ FAILED (exit code {result.exit_code})")
            
            return is_alive
        except Exception as e:
            logger.warning(f"Daytona sandbox {sandbox.id} health check: ❌ ERROR: {e}")
            return False
    
    def _try_revive_daytona_sandbox(self, sandbox: Any) -> bool:
        """Attempt to bring an existing Daytona sandbox to a ready state.

        Inspects ``sandbox.state`` and takes the appropriate recovery action:

        1. **STARTED** -- verify responsiveness via health check, reuse.
        2. **STOPPED** -- ``sandbox.start()`` (~1-2 s).
        3. **ARCHIVING** -- ``sandbox.start()`` cancels the in-flight archive
           and resumes in ~1 s with all data preserved (verified by
           benchmark_sandbox_lifecycle.py ``TestArchivingRaceCondition``).
        4. **ARCHIVED** -- ``sandbox.start()`` restores from cold storage
           (~3-10 s for 0-500 MB workspaces).
        5. **ERROR + recoverable** -- ``sandbox.recover()``.
        6. **DESTROYED / non-recoverable ERROR / other transitional** --
           cannot revive; caller should create a new sandbox.

        Each recovery action gets **one attempt** with a generous timeout.
        If it fails the method returns ``False`` and the caller falls through
        to sandbox creation.

        Args:
            sandbox: Daytona ``Sandbox`` instance obtained via
                ``self._daytona.get(sandbox_id)``.

        Returns:
            ``True`` if the sandbox is now in a usable (STARTED) state,
            ``False`` if a new sandbox must be created.
        """
        state = sandbox.state
        sandbox_id = sandbox.id

        # ── STARTED: sandbox claims to be running ──────────────────────
        if state == SandboxState.STARTED:
            if self._is_daytona_sandbox_alive(sandbox):
                logger.info(
                    "Sandbox %s is STARTED and responsive — reusing",
                    sandbox_id,
                )
                return True

            logger.warning(
                "Sandbox %s reports STARTED but failed health check — "
                "treating as unrecoverable",
                sandbox_id,
            )
            return False

        # ── STOPPED: auto-stopped after idle period ────────────────────
        if state == SandboxState.STOPPED:
            logger.info(
                "Sandbox %s is STOPPED, attempting restart…", sandbox_id,
            )
            start_time = time.monotonic()
            try:
                sandbox.start(timeout=60)
                elapsed = time.monotonic() - start_time
                logger.info(
                    "Sandbox %s restarted from STOPPED in %.1fs "
                    "(runtime packages preserved)",
                    sandbox_id,
                    elapsed,
                )
                return True
            except Exception as e:
                elapsed = time.monotonic() - start_time
                logger.warning(
                    "Failed to restart STOPPED sandbox %s after %.1fs: %s",
                    sandbox_id,
                    elapsed,
                    e,
                )
                return False

        # ── ARCHIVED: filesystem moved to object storage ───────────────
        if state == SandboxState.ARCHIVED:
            logger.info(
                "Sandbox %s is ARCHIVED, attempting restore + start "
                "(this may take up to 2 min)…",
                sandbox_id,
            )
            start_time = time.monotonic()
            try:
                sandbox.start(timeout=120)
                elapsed = time.monotonic() - start_time
                logger.info(
                    "Sandbox %s restored from ARCHIVED in %.1fs "
                    "(runtime packages preserved)",
                    sandbox_id,
                    elapsed,
                )
                return True
            except Exception as e:
                elapsed = time.monotonic() - start_time
                logger.warning(
                    "Failed to restore ARCHIVED sandbox %s after %.1fs: %s",
                    sandbox_id,
                    elapsed,
                    e,
                )
                return False

        # ── ERROR: check if the SDK considers it recoverable ───────────
        if state == SandboxState.ERROR:
            if sandbox.recoverable:
                logger.info(
                    "Sandbox %s is in ERROR (recoverable), "
                    "error_reason='%s' — attempting recover…",
                    sandbox_id,
                    sandbox.error_reason,
                )
                start_time = time.monotonic()
                try:
                    sandbox.recover(timeout=60)
                    elapsed = time.monotonic() - start_time
                    logger.info(
                        "Sandbox %s recovered from ERROR in %.1fs",
                        sandbox_id,
                        elapsed,
                    )
                    return True
                except Exception as e:
                    elapsed = time.monotonic() - start_time
                    logger.warning(
                        "Failed to recover sandbox %s after %.1fs: %s",
                        sandbox_id,
                        elapsed,
                        e,
                    )
                    return False

            logger.warning(
                "Sandbox %s is in non-recoverable ERROR "
                "(reason='%s') — will create new sandbox",
                sandbox_id,
                sandbox.error_reason,
            )
            return False

        # ── DESTROYED: sandbox no longer exists on infrastructure ──────
        if state == SandboxState.DESTROYED:
            logger.info(
                "Sandbox %s is DESTROYED — will create new sandbox",
                sandbox_id,
            )
            return False

        # ── ARCHIVING: mid-transition to cold storage ──────────────────
        # Benchmark evidence: start() during ARCHIVING cancels the archive
        # and resumes the sandbox in ~1s with full data preservation.
        if state == SandboxState.ARCHIVING:
            logger.info(
                "Sandbox %s is ARCHIVING, calling start() to cancel "
                "archive and resume…",
                sandbox_id,
            )
            start_time = time.monotonic()
            try:
                sandbox.start(timeout=60)
                elapsed = time.monotonic() - start_time
                logger.info(
                    "Sandbox %s resumed from ARCHIVING in %.1fs",
                    sandbox_id,
                    elapsed,
                )
                return True
            except Exception as e:
                elapsed = time.monotonic() - start_time
                logger.warning(
                    "Failed to resume ARCHIVING sandbox %s after %.1fs: %s",
                    sandbox_id,
                    elapsed,
                    e,
                )
                return False

        # ── Transitional or unknown state ──────────────────────────────
        # States like STARTING, STOPPING, CREATING, RESTORING,
        # DESTROYING, BUILD_FAILED, PENDING_BUILD, BUILDING_SNAPSHOT,
        # PULLING_SNAPSHOT, UNKNOWN.  These are either short-lived
        # transitions or terminal failures.  Rather than adding complex
        # wait/retry logic for rare edge cases, we fall through to sandbox
        # creation.
        logger.warning(
            "Sandbox %s is in state '%s' (transitional/unsupported) — "
            "will create new sandbox",
            sandbox_id,
            state.value if hasattr(state, 'value') else state,
        )
        return False

    async def cleanup_daytona_sandbox(self, sandbox_id: str) -> None:
        """Delete Daytona sandbox (best-effort cleanup).
        
        Args:
            sandbox_id: Daytona sandbox ID to delete
        """
        try:
            logger.info(f"Cleaning up Daytona sandbox: {sandbox_id}")
            sandbox = self._daytona.get(sandbox_id)
            sandbox.delete()
            logger.info(f"🗑️  Successfully deleted Daytona sandbox {sandbox_id}")
        except Exception as e:
            logger.error(
                f"Failed to delete Daytona sandbox {sandbox_id}: {e}. "
                "Orphaned sandbox may need manual cleanup."
            )
