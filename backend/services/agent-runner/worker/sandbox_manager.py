"""Unified sandbox manager supporting local, Docker, and Daytona execution modes.

This module provides three execution strategies:
1. LOCAL MODE (default): Execute directly on host machine
2. DOCKER SANDBOX MODE: Execute in isolated Docker container
3. DAYTONA MODE (cloud): Execute in Daytona sandbox (legacy/cloud mode)

The execution mode is configured via STIGMER_EXECUTION_MODE environment variable.
"""

from dataclasses import dataclass
from typing import Any, Optional
from enum import Enum
import asyncio
import logging
import os
import subprocess
import time

# Optional Daytona import (only needed for cloud mode)
try:
    from daytona import Daytona, DaytonaConfig
    from daytona.common.daytona import CreateSandboxFromSnapshotParams
    DAYTONA_AVAILABLE = True
except ImportError:
    DAYTONA_AVAILABLE = False

# Optional Docker import
try:
    import docker
    DOCKER_AVAILABLE = True
except ImportError:
    DOCKER_AVAILABLE = False

from worker.config import ExecutionMode

logger = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    """Result of command execution."""
    exit_code: int
    stdout: str
    stderr: str
    execution_mode: str  # "local", "docker", or "daytona"


class SandboxManager:
    """Manages sandbox lifecycle and command execution across multiple modes.
    
    Supports three execution modes:
    - LOCAL: Direct subprocess execution on host (default, fast)
    - DOCKER: Isolated Docker container execution (isolated)
    - DAYTONA: Cloud-based Daytona sandbox (cloud mode, legacy)
    
    Auto-detection logic can intelligently choose between local and sandbox
    based on command characteristics.
    """
    
    def __init__(
        self,
        execution_mode: ExecutionMode = ExecutionMode.LOCAL,
        sandbox_image: str = "ghcr.io/stigmer/agent-sandbox-basic:latest",
        sandbox_auto_pull: bool = True,
        sandbox_cleanup: bool = True,
        sandbox_ttl: int = 3600,
        daytona_api_key: Optional[str] = None,
    ):
        """Initialize SandboxManager.
        
        Args:
            execution_mode: Execution mode (LOCAL, SANDBOX, AUTO)
            sandbox_image: Docker image for sandbox mode
            sandbox_auto_pull: Auto-pull image if missing
            sandbox_cleanup: Cleanup containers after execution
            sandbox_ttl: Container reuse TTL in seconds
            daytona_api_key: Daytona API key (for cloud mode)
        """
        self.execution_mode = execution_mode
        self.sandbox_image = sandbox_image
        self.sandbox_auto_pull = sandbox_auto_pull
        self.sandbox_cleanup = sandbox_cleanup
        self.sandbox_ttl = sandbox_ttl
        
        # Daytona client (lazy init for cloud mode)
        self._daytona = None
        self._daytona_api_key = daytona_api_key
        
        # Docker client (lazy init for sandbox mode)
        self._docker = None
        
        # Active containers cache (for reuse)
        self._active_containers: dict[str, tuple[Any, float]] = {}  # container_id -> (container, created_at)
        
        logger.info(f"SandboxManager initialized with mode: {execution_mode.value}")
    
    async def execute_command(
        self,
        command: str,
        working_dir: Optional[str] = None,
        env_vars: Optional[dict[str, str]] = None,
        timeout: Optional[int] = None,
    ) -> ExecutionResult:
        """Execute command based on configured execution mode.
        
        Args:
            command: Command to execute
            working_dir: Working directory for execution
            env_vars: Environment variables
            timeout: Command timeout in seconds
            
        Returns:
            ExecutionResult with exit code, stdout, stderr, and execution mode
        """
        # Determine actual execution mode
        mode = self._determine_execution_mode(command)
        
        logger.info(f"Executing command in {mode.value} mode: {command[:100]}...")
        
        if mode == ExecutionMode.LOCAL:
            return await self._execute_local(command, working_dir, env_vars, timeout)
        elif mode == ExecutionMode.SANDBOX:
            return await self._execute_docker(command, working_dir, env_vars, timeout)
        else:
            raise ValueError(f"Unsupported execution mode: {mode}")
    
    def _determine_execution_mode(self, command: str) -> ExecutionMode:
        """Determine execution mode based on configuration and command.
        
        Args:
            command: Command to execute
            
        Returns:
            Resolved execution mode (LOCAL or SANDBOX)
        """
        if self.execution_mode == ExecutionMode.AUTO:
            # Auto-detect based on command characteristics
            return self._auto_detect_mode(command)
        else:
            return self.execution_mode
    
    def _auto_detect_mode(self, command: str) -> ExecutionMode:
        """Auto-detect execution mode based on command characteristics.
        
        Triggers SANDBOX mode for:
        - Package managers (pip, npm, apt, yum, brew)
        - System modifications
        - Potentially risky operations
        
        Uses LOCAL mode for:
        - Simple shell commands (echo, ls, cd, pwd)
        - Read-only operations
        - Standard utilities
        
        Args:
            command: Command to analyze
            
        Returns:
            ExecutionMode.LOCAL or ExecutionMode.SANDBOX
        """
        # Commands that should run in sandbox
        risky_commands = [
            'pip', 'pip3',
            'npm', 'yarn', 'pnpm',
            'apt', 'apt-get', 'yum', 'dnf', 'brew',
            'gem', 'cargo', 'go install',
        ]
        
        # Check if command contains risky operations
        command_lower = command.lower()
        for risky in risky_commands:
            if risky in command_lower:
                logger.info(f"Auto-detection: Using SANDBOX mode (found '{risky}' in command)")
                return ExecutionMode.SANDBOX
        
        # Default to local mode for simple commands
        logger.info("Auto-detection: Using LOCAL mode (safe command)")
        return ExecutionMode.LOCAL
    
    # ==================== LOCAL EXECUTION ====================
    
    async def _execute_local(
        self,
        command: str,
        working_dir: Optional[str],
        env_vars: Optional[dict[str, str]],
        timeout: Optional[int],
    ) -> ExecutionResult:
        """Execute command directly on host machine using subprocess.
        
        Args:
            command: Command to execute
            working_dir: Working directory
            env_vars: Environment variables
            timeout: Command timeout
            
        Returns:
            ExecutionResult
        """
        logger.debug(f"Executing locally: {command}")
        
        # Prepare environment
        env = os.environ.copy()
        if env_vars:
            env.update(env_vars)
        
        try:
            # Execute command
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=env,
            )
            
            # Wait for completion with timeout
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise TimeoutError(f"Command timed out after {timeout} seconds")
            
            return ExecutionResult(
                exit_code=process.returncode or 0,
                stdout=stdout.decode('utf-8', errors='replace'),
                stderr=stderr.decode('utf-8', errors='replace'),
                execution_mode="local"
            )
            
        except Exception as e:
            logger.error(f"Local execution failed: {e}")
            return ExecutionResult(
                exit_code=1,
                stdout="",
                stderr=str(e),
                execution_mode="local"
            )
    
    # ==================== DOCKER SANDBOX EXECUTION ====================
    
    async def _execute_docker(
        self,
        command: str,
        working_dir: Optional[str],
        env_vars: Optional[dict[str, str]],
        timeout: Optional[int],
    ) -> ExecutionResult:
        """Execute command in isolated Docker container.
        
        Args:
            command: Command to execute
            working_dir: Working directory (mounted in container)
            env_vars: Environment variables
            timeout: Command timeout
            
        Returns:
            ExecutionResult
        """
        if not DOCKER_AVAILABLE:
            logger.error("Docker library not available. Install with: pip install docker")
            return ExecutionResult(
                exit_code=1,
                stdout="",
                stderr="Docker library not available",
                execution_mode="docker"
            )
        
        try:
            # Ensure Docker client initialized
            if self._docker is None:
                self._docker = docker.from_env()
            
            # Ensure sandbox image available
            await self._ensure_sandbox_image()
            
            # Get or create container
            container = await self._get_or_create_container()
            
            # Execute command in container
            logger.debug(f"Executing in Docker container {container.id[:12]}: {command}")
            
            exec_result = container.exec_run(
                f"/bin/bash -c '{command}'",
                stdout=True,
                stderr=True,
                environment=env_vars or {},
                workdir=working_dir or "/workspace",
            )
            
            return ExecutionResult(
                exit_code=exec_result.exit_code,
                stdout=exec_result.output.decode('utf-8', errors='replace') if exec_result.output else "",
                stderr="",  # Docker exec_run combines stdout/stderr
                execution_mode="docker"
            )
            
        except Exception as e:
            logger.error(f"Docker execution failed: {e}")
            return ExecutionResult(
                exit_code=1,
                stdout="",
                stderr=str(e),
                execution_mode="docker"
            )
    
    async def _ensure_sandbox_image(self):
        """Ensure sandbox Docker image is available locally.
        
        Tries to:
        1. Check if image exists locally
        2. Pull from registry if auto_pull enabled
        3. Log error if image not available
        """
        try:
            # Check if image exists
            self._docker.images.get(self.sandbox_image)
            logger.debug(f"Sandbox image already available: {self.sandbox_image}")
            return
        except docker.errors.ImageNotFound:
            pass
        
        # Image not found locally
        if not self.sandbox_auto_pull:
            raise RuntimeError(
                f"Sandbox image not found: {self.sandbox_image}. "
                f"Set STIGMER_SANDBOX_AUTO_PULL=true to auto-pull."
            )
        
        # Pull image from registry
        logger.info(f"Pulling sandbox image: {self.sandbox_image}")
        try:
            self._docker.images.pull(self.sandbox_image)
            logger.info(f"✓ Sandbox image pulled: {self.sandbox_image}")
        except Exception as e:
            raise RuntimeError(
                f"Failed to pull sandbox image {self.sandbox_image}: {e}. "
                f"Build locally with: cd sandbox && docker build -f Dockerfile.sandbox.basic -t {self.sandbox_image} ."
            ) from e
    
    async def _get_or_create_container(self) -> Any:
        """Get existing container or create new one.
        
        Implements container reuse with TTL for performance.
        
        Returns:
            Docker container object
        """
        # Check for reusable container
        now = time.time()
        for container_id, (container, created_at) in list(self._active_containers.items()):
            # Check if container still valid (within TTL)
            if now - created_at < self.sandbox_ttl:
                # Verify container is running
                try:
                    container.reload()
                    if container.status == "running":
                        logger.debug(f"Reusing existing container: {container_id[:12]}")
                        return container
                except Exception:
                    pass
            
            # Container expired or invalid, remove from cache
            del self._active_containers[container_id]
        
        # Create new container
        logger.info(f"Creating new sandbox container from {self.sandbox_image}")
        container = self._docker.containers.run(
            self.sandbox_image,
            command="tail -f /dev/null",  # Keep container running
            detach=True,
            remove=self.sandbox_cleanup,
            auto_remove=self.sandbox_cleanup,
        )
        
        # Cache container
        self._active_containers[container.id] = (container, now)
        logger.info(f"✓ Created sandbox container: {container.id[:12]}")
        
        return container
    
    async def cleanup_containers(self):
        """Cleanup all active sandbox containers.
        
        Called on shutdown or when cleanup is requested.
        """
        logger.info("Cleaning up sandbox containers...")
        
        for container_id, (container, _) in list(self._active_containers.items()):
            try:
                container.stop(timeout=5)
                container.remove(force=True)
                logger.info(f"✓ Removed container: {container_id[:12]}")
            except Exception as e:
                logger.warning(f"Failed to remove container {container_id[:12]}: {e}")
        
        self._active_containers.clear()
    
    # ==================== DAYTONA EXECUTION (Legacy/Cloud Mode) ====================
    
    async def get_or_create_daytona_sandbox(
        self,
        sandbox_config: dict,
        session_id: str | None,
        session_client: Any | None,
    ) -> tuple[Any, bool]:
        """Get or create Daytona sandbox (legacy cloud mode).
        
        This method maintains backward compatibility with existing Daytona-based
        cloud deployments.
        
        Args:
            sandbox_config: Sandbox configuration dict
            session_id: Session ID for persistence
            session_client: Session client for updates
            
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
                        
                        if self._is_daytona_sandbox_alive(sandbox):
                            logger.info(
                                f"✅ Reusing healthy Daytona sandbox {existing_sandbox_id} for session {session_id}"
                            )
                            return (sandbox, False)
                        else:
                            logger.warning(
                                f"Daytona sandbox {existing_sandbox_id} not responsive, creating new one"
                            )
                    except Exception as e:
                        logger.warning(
                            f"Failed to reuse Daytona sandbox {existing_sandbox_id}: {e}. "
                            "Creating new sandbox."
                        )
                else:
                    logger.info(f"Session {session_id} has no sandbox_id, creating new sandbox")
                    
            except Exception as e:
                logger.error(f"Failed to fetch session {session_id}: {e}")
        else:
            logger.info("No session_id provided - creating ephemeral Daytona sandbox")
        
        # Create new Daytona sandbox
        logger.info(f"Creating new Daytona sandbox with config: {sandbox_config}")
        sandbox = self._create_daytona_sandbox(sandbox_config)
        logger.info(f"✨ Created new Daytona sandbox: {sandbox.id}")
        
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
    
    def _create_daytona_sandbox(self, config: dict) -> Any:
        """Create new Daytona sandbox with polling for readiness.
        
        Args:
            config: Sandbox configuration dict
            
        Returns:
            Daytona Sandbox instance
        """
        if not isinstance(config, dict):
            raise ValueError(f"sandbox_config must be a dictionary, got {type(config).__name__}")
        
        sandbox_type = config.get("type")
        if sandbox_type != "daytona":
            raise ValueError(f"Only 'daytona' sandbox type supported, got: {sandbox_type}")
        
        snapshot_id = config.get("snapshot_id")
        
        try:
            # Create sandbox
            if snapshot_id:
                logger.info(f"Creating Daytona sandbox from snapshot: {snapshot_id}")
                params = CreateSandboxFromSnapshotParams(snapshot=snapshot_id)
                sandbox = self._daytona.create(params=params)
            else:
                logger.info("Creating vanilla Daytona sandbox (no snapshot)")
                sandbox = self._daytona.create()
            
            logger.info(f"Daytona sandbox created: {sandbox.id}, waiting for readiness...")
            
            # Poll until ready (max 180 seconds)
            for attempt in range(90):
                try:
                    result = sandbox.process.exec("echo ready", timeout=5)
                    if result.exit_code == 0:
                        logger.info(f"Daytona sandbox {sandbox.id} ready after {attempt * 2}s")
                        return sandbox
                except Exception as e:
                    if attempt % 10 == 0:
                        logger.debug(f"Daytona sandbox not ready yet (attempt {attempt}/90): {e}")
                
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
