"""Manages Daytona sandbox lifecycle for agent executions."""

from daytona import Daytona, DaytonaConfig
from daytona.common.daytona import CreateSandboxFromSnapshotParams
from grpc_client.session_client import SessionClient
from typing import Any
import logging
import time

logger = logging.getLogger(__name__)


class SandboxManager:
    """Manages sandbox creation, reuse, and cleanup for agent executions.
    
    This manager provides:
    - Sandbox lifecycle tied to session lifecycle
    - Automatic sandbox reuse for multi-turn conversations
    - Health checking and fallback to new sandbox creation
    - Persistent file storage across conversation turns
    """
    
    def __init__(self, api_key: str):
        """Initialize SandboxManager with Daytona API key.
        
        Args:
            api_key: Daytona API key for authentication
        """
        self.daytona = Daytona(DaytonaConfig(api_key=api_key))
        logger.info("SandboxManager initialized")
    
    async def get_or_create_sandbox(
        self,
        sandbox_config: dict,
        session_id: str | None,
        session_client: SessionClient | None,
    ) -> tuple[Any, bool]:
        """Get existing sandbox or create new one.
        
        For session-based executions:
        1. Checks if session has existing sandbox_id
        2. Attempts to reuse existing sandbox if healthy
        3. Falls back to creating new sandbox if reuse fails
        4. Stores new sandbox_id in session
        
        For session-less executions:
        - Always creates ephemeral sandbox
        - Not stored anywhere
        
        Args:
            sandbox_config: Sandbox configuration dict (type, snapshot_id, etc.)
            session_id: Optional session ID for persistence
            session_client: Optional session client for session updates
            
        Returns:
            (sandbox, is_new): Tuple of sandbox instance and whether it was newly created
            
        Raises:
            ValueError: If sandbox creation fails
        """
        # Try to reuse existing sandbox if session exists
        if session_id and session_client:
            logger.info(f"Checking for existing sandbox in session {session_id}")
            
            try:
                session = await session_client.get(session_id)
                existing_sandbox_id = session.spec.sandbox_id
                
                if existing_sandbox_id:
                    logger.info(f"Found existing sandbox_id: {existing_sandbox_id}")
                    
                    try:
                        sandbox = self._get_sandbox(existing_sandbox_id)
                        
                        if self._is_sandbox_alive(sandbox):
                            logger.info(
                                f"✅ Reusing healthy sandbox {existing_sandbox_id} for session {session_id}"
                            )
                            return (sandbox, False)
                        else:
                            logger.warning(
                                f"Sandbox {existing_sandbox_id} not responsive, creating new one"
                            )
                    except Exception as e:
                        logger.warning(
                            f"Failed to reuse sandbox {existing_sandbox_id}: {e}. "
                            "Creating new sandbox."
                        )
                else:
                    logger.info(f"Session {session_id} has no sandbox_id, creating new sandbox")
                    
            except Exception as e:
                logger.error(f"Failed to fetch session {session_id}: {e}")
                # Continue to create new sandbox
        else:
            logger.info("No session_id provided - creating ephemeral sandbox")
        
        # Create new sandbox
        logger.info(f"Creating new sandbox with config: {sandbox_config}")
        sandbox = self._create_sandbox(sandbox_config)
        logger.info(f"✨ Created new sandbox: {sandbox.id}")
        
        # Store in session if exists
        if session_id and session_client:
            try:
                session = await session_client.get(session_id)
                session.spec.sandbox_id = sandbox.id
                await session_client.update(session)
                logger.info(f"💾 Stored sandbox {sandbox.id} in session {session_id}")
            except Exception as e:
                logger.error(
                    f"Failed to store sandbox_id in session {session_id}: {e}. "
                    "Continuing with execution."
                )
        
        return (sandbox, True)
    
    def _create_sandbox(self, config: dict) -> Any:
        """Create new Daytona sandbox with polling for readiness.
        
        Args:
            config: Sandbox configuration dict with 'type' and optional 'snapshot_id'
            
        Returns:
            Daytona Sandbox instance
            
        Raises:
            ValueError: If config is invalid
            RuntimeError: If sandbox creation or readiness check fails
        """
        if not isinstance(config, dict):
            raise ValueError(f"sandbox_config must be a dictionary, got {type(config).__name__}")
        
        sandbox_type = config.get("type")
        if sandbox_type != "daytona":
            raise ValueError(f"Only 'daytona' sandbox type supported, got: {sandbox_type}")
        
        # Get optional snapshot_id
        snapshot_id = config.get("snapshot_id")
        
        try:
            # Create sandbox with or without snapshot
            if snapshot_id:
                logger.info(f"Creating sandbox from snapshot: {snapshot_id}")
                params = CreateSandboxFromSnapshotParams(snapshot=snapshot_id)
                sandbox = self.daytona.create(params=params)
            else:
                logger.info("Creating vanilla sandbox (no snapshot)")
                sandbox = self.daytona.create()
            
            logger.info(f"Sandbox created: {sandbox.id}, waiting for readiness...")
            
            # Poll until sandbox is ready (max 180 seconds)
            for attempt in range(90):  # 90 * 2s = 180s timeout
                try:
                    result = sandbox.process.exec("echo ready", timeout=5)
                    if result.exit_code == 0:
                        logger.info(f"Sandbox {sandbox.id} ready after {attempt * 2}s")
                        return sandbox
                except Exception as e:
                    if attempt % 10 == 0:  # Log every 20 seconds
                        logger.debug(f"Sandbox not ready yet (attempt {attempt}/90): {e}")
                
                time.sleep(2)
            
            # Timeout reached - cleanup and raise error
            logger.error(f"Sandbox {sandbox.id} failed to become ready within 180 seconds")
            try:
                sandbox.delete()
                logger.info(f"Cleaned up failed sandbox {sandbox.id}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup sandbox {sandbox.id}: {cleanup_error}")
            
            raise RuntimeError(
                f"Daytona sandbox {sandbox.id} failed to start within 180 seconds"
            )
            
        except Exception as e:
            logger.error(f"Sandbox creation failed: {e}")
            raise RuntimeError(f"Failed to create Daytona sandbox: {e}") from e
    
    def _get_sandbox(self, sandbox_id: str) -> Any:
        """Get existing sandbox by ID.
        
        Args:
            sandbox_id: Daytona sandbox ID
            
        Returns:
            Daytona Sandbox instance
            
        Raises:
            Exception: If sandbox not found or API call fails
        """
        logger.debug(f"Fetching sandbox: {sandbox_id}")
        return self.daytona.get(sandbox_id)
    
    def _is_sandbox_alive(self, sandbox: Any) -> bool:
        """Check if sandbox is alive and responsive.
        
        Executes a simple echo command to verify the sandbox can execute commands.
        
        Args:
            sandbox: Daytona Sandbox instance
            
        Returns:
            True if sandbox is responsive, False otherwise
        """
        try:
            result = sandbox.process.exec("echo alive", timeout=5)
            is_alive = result.exit_code == 0
            
            if is_alive:
                logger.debug(f"Sandbox {sandbox.id} health check: ✅ ALIVE")
            else:
                logger.warning(f"Sandbox {sandbox.id} health check: ❌ FAILED (exit code {result.exit_code})")
            
            return is_alive
        except Exception as e:
            logger.warning(f"Sandbox {sandbox.id} health check: ❌ ERROR: {e}")
            return False
    
    async def cleanup_sandbox(self, sandbox_id: str) -> None:
        """Delete sandbox (called on session deletion or timeout).
        
        This is a best-effort cleanup operation. Failures are logged but not raised.
        
        Args:
            sandbox_id: Daytona sandbox ID to delete
        """
        try:
            logger.info(f"Cleaning up sandbox: {sandbox_id}")
            sandbox = self.daytona.get(sandbox_id)
            sandbox.delete()
            logger.info(f"🗑️  Successfully deleted sandbox {sandbox_id}")
        except Exception as e:
            logger.error(
                f"Failed to delete sandbox {sandbox_id}: {e}. "
                "Orphaned sandbox may need manual cleanup."
            )
