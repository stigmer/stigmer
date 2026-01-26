# Task T01: MCP Server Lifecycle Management - Comprehensive Implementation Plan

**Created**: 2026-01-27
**Status**: PENDING REVIEW
**Type**: Feature Development (Foundation)

⚠️ **This plan requires your review before execution**

---

## Executive Summary

Implement production-grade lifecycle management for MCP servers across all three transport types (stdio, HTTP, Docker) within the agent runner. This is **foundational infrastructure** for a world-class platform - every aspect must be engineered to the highest standards.

**Scope**: Runtime orchestration layer that manages MCP server processes from startup through graceful shutdown, with comprehensive health monitoring, error recovery, and resource cleanup.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                   MCP SERVER LIFECYCLE MANAGER                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────┐                                            │
│  │   SERVER REGISTRY   │  Track all running MCP servers             │
│  │  (asyncio-safe)     │  Server ID → ServerHandle mapping          │
│  └─────────────────────┘                                            │
│           │                                                          │
│           ├──────────────────┬──────────────────┬───────────────┐   │
│           ▼                  ▼                  ▼               ▼   │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────┐  │
│  │ STDIO MANAGER  │ │  HTTP MANAGER  │ │ DOCKER MANAGER │ │...│  │
│  └────────────────┘ └────────────────┘ └────────────────┘ └────┘  │
│           │                  │                  │                   │
│           ▼                  ▼                  ▼                   │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐         │
│  │  Subprocess    │ │  HTTP Client   │ │ Docker API     │         │
│  │  asyncio       │ │  aiohttp       │ │  aiodocker     │         │
│  │  Process       │ │  Session       │ │  Container     │         │
│  └────────────────┘ └────────────────┘ └────────────────┘         │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │               HEALTH MONITORING SERVICE                       │  │
│  │  - Periodic health checks                                     │  │
│  │  - Failure detection and recovery                             │  │
│  │  - Metrics collection (uptime, requests, errors)              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │               GRACEFUL SHUTDOWN COORDINATOR                   │  │
│  │  - Drain in-flight requests                                   │  │
│  │  - Terminate servers in dependency order                      │  │
│  │  - Cleanup resources (processes, containers, connections)     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Stdio Server Process Management

### 1.1 Process Lifecycle

**Complexity**: Subprocess management in async Python with proper signal handling, stream management, and zombie process prevention.

#### Core Components

```python
# backend/services/stigmer-service/agent_runner/mcp/stdio_manager.py

import asyncio
import signal
import logging
from typing import Optional, Dict, List
from dataclasses import dataclass

@dataclass
class StdioServerHandle:
    """Handle to a running stdio MCP server subprocess."""
    server_id: str
    process: asyncio.subprocess.Process
    config: StdioServerConfig
    env_vars: Dict[str, str]
    stdin: asyncio.StreamWriter
    stdout: asyncio.StreamReader
    stderr: asyncio.StreamReader
    started_at: float
    pid: int
    
    async def is_alive(self) -> bool:
        """Check if process is still running."""
        return self.process.returncode is None
    
    async def terminate(self, timeout: float = 5.0) -> None:
        """Gracefully terminate the process."""
        if not await self.is_alive():
            return
        
        # Send SIGTERM for graceful shutdown
        self.process.terminate()
        
        try:
            await asyncio.wait_for(self.process.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            # Force kill if graceful shutdown times out
            self.process.kill()
            await self.process.wait()


class StdioServerManager:
    """Manages lifecycle of stdio-based MCP servers."""
    
    def __init__(self):
        self._servers: Dict[str, StdioServerHandle] = {}
        self._logger = logging.getLogger(__name__)
    
    async def start_server(
        self,
        server_id: str,
        config: StdioServerConfig,
        env_vars: Dict[str, str]
    ) -> StdioServerHandle:
        """
        Start a stdio MCP server subprocess.
        
        Args:
            server_id: Unique identifier for this server instance
            config: Stdio server configuration (command, args, working_dir)
            env_vars: Resolved environment variables (secrets decrypted)
        
        Returns:
            Handle to the running server
        
        Raises:
            ProcessStartupError: If server fails to start
        """
        self._logger.info(
            f"Starting stdio server: {server_id}",
            extra={
                "server_id": server_id,
                "command": config.command,
                "args": config.args
            }
        )
        
        try:
            # Build environment (merge system env + MCP server env)
            process_env = os.environ.copy()
            process_env.update(env_vars)
            
            # Create subprocess with stdio pipes
            process = await asyncio.create_subprocess_exec(
                config.command,
                *config.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=process_env,
                cwd=config.working_dir or None,
                # Prevent zombie processes
                start_new_session=True
            )
            
            # Create handle
            handle = StdioServerHandle(
                server_id=server_id,
                process=process,
                config=config,
                env_vars=env_vars,
                stdin=process.stdin,
                stdout=process.stdout,
                stderr=process.stderr,
                started_at=time.time(),
                pid=process.pid
            )
            
            # Store in registry
            self._servers[server_id] = handle
            
            # Start stderr logging task
            asyncio.create_task(self._log_stderr(handle))
            
            # Verify server started successfully
            await self._verify_startup(handle)
            
            self._logger.info(
                f"Stdio server started successfully: {server_id}",
                extra={"server_id": server_id, "pid": handle.pid}
            )
            
            return handle
            
        except Exception as e:
            self._logger.error(
                f"Failed to start stdio server: {server_id}",
                extra={"server_id": server_id, "error": str(e)},
                exc_info=True
            )
            raise ProcessStartupError(
                f"Failed to start stdio server {server_id}: {e}"
            ) from e
    
    async def _verify_startup(
        self,
        handle: StdioServerHandle,
        timeout: float = 5.0
    ) -> None:
        """
        Verify server started successfully by checking if process is still alive.
        
        MCP servers should stay running - if process exits immediately, it failed.
        """
        await asyncio.sleep(0.5)  # Give process time to fail if it's going to
        
        if not await handle.is_alive():
            returncode = handle.process.returncode
            raise ProcessStartupError(
                f"Server process exited immediately with code {returncode}"
            )
    
    async def _log_stderr(self, handle: StdioServerHandle) -> None:
        """Stream stderr to logger (for error diagnostics)."""
        try:
            async for line in handle.stderr:
                line_str = line.decode('utf-8', errors='replace').rstrip()
                if line_str:
                    self._logger.warning(
                        f"[{handle.server_id}] {line_str}",
                        extra={"server_id": handle.server_id}
                    )
        except Exception as e:
            self._logger.error(
                f"Error reading stderr for {handle.server_id}: {e}",
                extra={"server_id": handle.server_id}
            )
    
    async def stop_server(
        self,
        server_id: str,
        timeout: float = 5.0
    ) -> None:
        """Gracefully stop a stdio server."""
        handle = self._servers.get(server_id)
        if not handle:
            self._logger.warning(f"Server not found: {server_id}")
            return
        
        self._logger.info(f"Stopping stdio server: {server_id}")
        
        await handle.terminate(timeout=timeout)
        
        del self._servers[server_id]
        
        self._logger.info(f"Stdio server stopped: {server_id}")
    
    async def stop_all(self, timeout: float = 10.0) -> None:
        """Stop all stdio servers (for shutdown)."""
        if not self._servers:
            return
        
        self._logger.info(f"Stopping {len(self._servers)} stdio servers")
        
        # Stop all in parallel
        await asyncio.gather(
            *[self.stop_server(sid, timeout) for sid in list(self._servers.keys())],
            return_exceptions=True
        )
```

#### Key Design Decisions

1. **asyncio.create_subprocess_exec** - Native async subprocess management
2. **start_new_session=True** - Prevents zombie processes, enables clean process group termination
3. **SIGTERM before SIGKILL** - Graceful shutdown with timeout fallback
4. **Stderr logging** - Capture diagnostics for troubleshooting
5. **Startup verification** - Fail fast if process exits immediately

---

## Part 2: HTTP Server Client Management

### 2.1 Connection Pooling and Retry Logic

**Complexity**: Production-grade HTTP client with connection pooling, circuit breaker, retry with exponential backoff, and TLS handling.

#### Core Components

```python
# backend/services/stigmer-service/agent_runner/mcp/http_manager.py

import aiohttp
import asyncio
import logging
from typing import Optional, Dict
from dataclasses import dataclass
import time

@dataclass
class HttpServerHandle:
    """Handle to an HTTP-based MCP server."""
    server_id: str
    config: HttpServerConfig
    session: aiohttp.ClientSession
    base_url: str
    headers: Dict[str, str]
    query_params: Dict[str, str]
    started_at: float
    request_count: int = 0
    error_count: int = 0


class HttpServerManager:
    """Manages lifecycle of HTTP-based MCP servers."""
    
    def __init__(self):
        self._servers: Dict[str, HttpServerHandle] = {}
        self._logger = logging.getLogger(__name__)
    
    async def start_server(
        self,
        server_id: str,
        config: HttpServerConfig,
        resolved_headers: Dict[str, str],
        resolved_query_params: Dict[str, str]
    ) -> HttpServerHandle:
        """
        Create HTTP client session for MCP server.
        
        Args:
            server_id: Unique identifier
            config: HTTP server configuration
            resolved_headers: Headers with placeholders resolved (e.g., auth tokens)
            resolved_query_params: Query params with placeholders resolved
        
        Returns:
            Handle to the HTTP server
        """
        self._logger.info(
            f"Starting HTTP server: {server_id}",
            extra={"server_id": server_id, "url": config.url}
        )
        
        # Create connector with connection pooling
        connector = aiohttp.TCPConnector(
            limit=10,  # Max connections per host
            limit_per_host=10,
            ttl_dns_cache=300,  # DNS cache TTL (5 minutes)
            ssl=True if config.url.startswith("https") else False
        )
        
        # Create timeout configuration
        timeout = aiohttp.ClientTimeout(
            total=config.timeout_seconds or 30.0,
            connect=config.connect_timeout_seconds or 10.0,
            sock_read=config.read_timeout_seconds or 30.0
        )
        
        # Create session
        session = aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers=resolved_headers,
            raise_for_status=False  # We handle status codes manually
        )
        
        # Create handle
        handle = HttpServerHandle(
            server_id=server_id,
            config=config,
            session=session,
            base_url=config.url,
            headers=resolved_headers,
            query_params=resolved_query_params,
            started_at=time.time()
        )
        
        # Store in registry
        self._servers[server_id] = handle
        
        # Verify connectivity
        await self._verify_connectivity(handle)
        
        self._logger.info(
            f"HTTP server started successfully: {server_id}",
            extra={"server_id": server_id}
        )
        
        return handle
    
    async def _verify_connectivity(
        self,
        handle: HttpServerHandle,
        max_retries: int = 3
    ) -> None:
        """
        Verify HTTP server is reachable.
        
        Attempt to connect with retries. This catches DNS resolution failures,
        network issues, and invalid URLs early.
        """
        for attempt in range(max_retries):
            try:
                # Try a simple GET request (or OPTIONS if server supports it)
                async with handle.session.get(
                    handle.base_url,
                    params=handle.query_params,
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    # Any response (even 404) means server is reachable
                    self._logger.debug(
                        f"Connectivity check: {handle.server_id} returned {response.status}"
                    )
                    return
            except aiohttp.ClientError as e:
                if attempt == max_retries - 1:
                    raise HttpServerConnectionError(
                        f"Failed to connect to {handle.base_url}: {e}"
                    ) from e
                await asyncio.sleep(1.0 * (2 ** attempt))  # Exponential backoff
    
    async def stop_server(self, server_id: str) -> None:
        """Close HTTP session."""
        handle = self._servers.get(server_id)
        if not handle:
            return
        
        self._logger.info(f"Stopping HTTP server: {server_id}")
        
        await handle.session.close()
        
        del self._servers[server_id]
        
        self._logger.info(f"HTTP server stopped: {server_id}")
    
    async def stop_all(self) -> None:
        """Close all HTTP sessions."""
        if not self._servers:
            return
        
        self._logger.info(f"Stopping {len(self._servers)} HTTP servers")
        
        await asyncio.gather(
            *[self.stop_server(sid) for sid in list(self._servers.keys())],
            return_exceptions=True
        )
```

#### Retry Logic with Circuit Breaker

```python
# backend/services/stigmer-service/agent_runner/mcp/http_retry.py

import asyncio
import time
from typing import Optional, Callable, TypeVar, Any
from enum import Enum

T = TypeVar('T')

class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failures detected, rejecting requests
    HALF_OPEN = "half_open"  # Testing if service recovered


class CircuitBreaker:
    """Circuit breaker pattern for HTTP requests."""
    
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        expected_exception: type = aiohttp.ClientError
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception
        
        self._failure_count = 0
        self._last_failure_time: Optional[float] = None
        self._state = CircuitState.CLOSED
    
    def record_success(self) -> None:
        """Record successful request."""
        self._failure_count = 0
        self._state = CircuitState.CLOSED
    
    def record_failure(self) -> None:
        """Record failed request."""
        self._failure_count += 1
        self._last_failure_time = time.time()
        
        if self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN
    
    def can_attempt(self) -> bool:
        """Check if request should be attempted."""
        if self._state == CircuitState.CLOSED:
            return True
        
        if self._state == CircuitState.OPEN:
            # Check if recovery timeout has passed
            if (time.time() - self._last_failure_time) >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                return True
            return False
        
        # HALF_OPEN: allow one request to test recovery
        return True


async def retry_with_backoff(
    func: Callable[..., Any],
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    circuit_breaker: Optional[CircuitBreaker] = None
) -> T:
    """
    Retry function with exponential backoff and circuit breaker.
    
    Args:
        func: Async function to retry
        max_retries: Maximum retry attempts
        initial_delay: Initial delay between retries (seconds)
        max_delay: Maximum delay between retries (seconds)
        exponential_base: Base for exponential backoff (default: 2.0)
        circuit_breaker: Optional circuit breaker
    
    Returns:
        Result of successful function call
    
    Raises:
        Last exception if all retries exhausted
    """
    last_exception = None
    
    for attempt in range(max_retries + 1):
        # Check circuit breaker
        if circuit_breaker and not circuit_breaker.can_attempt():
            raise CircuitBreakerOpenError("Circuit breaker is open")
        
        try:
            result = await func()
            
            # Record success in circuit breaker
            if circuit_breaker:
                circuit_breaker.record_success()
            
            return result
            
        except Exception as e:
            last_exception = e
            
            # Record failure in circuit breaker
            if circuit_breaker:
                circuit_breaker.record_failure()
            
            # Don't retry on last attempt
            if attempt == max_retries:
                break
            
            # Calculate delay with exponential backoff
            delay = min(
                initial_delay * (exponential_base ** attempt),
                max_delay
            )
            
            await asyncio.sleep(delay)
    
    raise last_exception
```

---

## Part 3: Docker Server Container Management

### 3.1 Container Lifecycle Orchestration

**Complexity**: Docker SDK integration with volume mounts, port mappings, network configuration, health checks, resource limits, and cleanup.

#### Core Components

```python
# backend/services/stigmer-service/agent_runner/mcp/docker_manager.py

import aiodocker
import asyncio
import logging
from typing import Optional, Dict, List
from dataclasses import dataclass

@dataclass
class DockerServerHandle:
    """Handle to a running Docker container MCP server."""
    server_id: str
    config: DockerServerConfig
    container: aiodocker.containers.DockerContainer
    container_id: str
    env_vars: Dict[str, str]
    started_at: float
    ports: Dict[str, int]  # Internal port -> exposed host port
    volumes: List[str]  # Volume names created


class DockerServerManager:
    """Manages lifecycle of Docker-based MCP servers."""
    
    def __init__(self):
        self._servers: Dict[str, DockerServerHandle] = {}
        self._docker: Optional[aiodocker.Docker] = None
        self._logger = logging.getLogger(__name__)
    
    async def initialize(self) -> None:
        """Initialize Docker client."""
        try:
            self._docker = aiodocker.Docker()
            # Verify Docker is available
            await self._docker.version()
            self._logger.info("Docker client initialized successfully")
        except Exception as e:
            self._logger.error(f"Failed to initialize Docker client: {e}")
            raise DockerUnavailableError(
                "Docker is not available. Ensure Docker daemon is running."
            ) from e
    
    async def start_server(
        self,
        server_id: str,
        config: DockerServerConfig,
        env_vars: Dict[str, str]
    ) -> DockerServerHandle:
        """
        Start a Docker container for MCP server.
        
        Args:
            server_id: Unique identifier
            config: Docker server configuration
            env_vars: Resolved environment variables
        
        Returns:
            Handle to the running container
        """
        self._logger.info(
            f"Starting Docker server: {server_id}",
            extra={"server_id": server_id, "image": config.image}
        )
        
        # Ensure Docker is initialized
        if not self._docker:
            await self.initialize()
        
        # Pull image if needed
        await self._ensure_image(config.image)
        
        # Create volumes
        volume_names = await self._create_volumes(server_id, config.volume_mounts)
        
        # Prepare port bindings
        port_bindings = self._prepare_port_bindings(config.port_mappings)
        
        # Prepare volume bindings
        volume_bindings = self._prepare_volume_bindings(
            server_id,
            config.volume_mounts,
            volume_names
        )
        
        # Prepare environment variables
        env_list = [f"{k}={v}" for k, v in env_vars.items()]
        
        # Create container configuration
        container_config = {
            "Image": config.image,
            "Env": env_list,
            "HostConfig": {
                "PortBindings": port_bindings,
                "Binds": volume_bindings,
                "NetworkMode": config.network_mode or "bridge",
                # Resource limits
                "Memory": config.memory_limit_mb * 1024 * 1024 if config.memory_limit_mb else None,
                "NanoCpus": int(config.cpu_limit * 1e9) if config.cpu_limit else None,
                # Security
                "Privileged": False,  # Never run privileged
                "ReadonlyRootfs": config.readonly_rootfs or False
            },
            "Labels": {
                "stigmer.mcp.server_id": server_id,
                "stigmer.mcp.type": "mcp-server",
                "stigmer.managed": "true"
            }
        }
        
        # Add command if specified
        if config.command:
            container_config["Cmd"] = config.command
        
        try:
            # Create and start container
            container = await self._docker.containers.create(
                config=container_config,
                name=f"stigmer-mcp-{server_id}"
            )
            
            await container.start()
            
            # Get container info
            info = await container.show()
            container_id = info["Id"]
            
            # Extract exposed ports
            exposed_ports = self._extract_exposed_ports(info)
            
            # Create handle
            handle = DockerServerHandle(
                server_id=server_id,
                config=config,
                container=container,
                container_id=container_id,
                env_vars=env_vars,
                started_at=time.time(),
                ports=exposed_ports,
                volumes=volume_names
            )
            
            # Store in registry
            self._servers[server_id] = handle
            
            # Wait for container to be healthy (if health check configured)
            await self._wait_for_health(handle)
            
            self._logger.info(
                f"Docker server started successfully: {server_id}",
                extra={
                    "server_id": server_id,
                    "container_id": container_id[:12],
                    "ports": exposed_ports
                }
            )
            
            return handle
            
        except Exception as e:
            # Cleanup on failure
            await self._cleanup_resources(server_id, volume_names)
            raise DockerStartupError(
                f"Failed to start Docker server {server_id}: {e}"
            ) from e
    
    async def _ensure_image(self, image: str) -> None:
        """Pull Docker image if not present locally."""
        try:
            await self._docker.images.inspect(image)
            self._logger.debug(f"Image already present: {image}")
        except aiodocker.exceptions.DockerError:
            self._logger.info(f"Pulling image: {image}")
            await self._docker.images.pull(image)
            self._logger.info(f"Image pulled successfully: {image}")
    
    async def _create_volumes(
        self,
        server_id: str,
        mounts: List[VolumeMount]
    ) -> List[str]:
        """Create Docker volumes for volume mounts."""
        volume_names = []
        
        for idx, mount in enumerate(mounts):
            if mount.type == "volume":
                volume_name = f"stigmer-mcp-{server_id}-vol{idx}"
                
                await self._docker.volumes.create({
                    "Name": volume_name,
                    "Labels": {
                        "stigmer.mcp.server_id": server_id,
                        "stigmer.managed": "true"
                    }
                })
                
                volume_names.append(volume_name)
        
        return volume_names
    
    def _prepare_port_bindings(
        self,
        port_mappings: List[PortMapping]
    ) -> Dict[str, List[Dict[str, str]]]:
        """
        Prepare port bindings for Docker HostConfig.
        
        Format: {"80/tcp": [{"HostPort": "8080"}]}
        """
        bindings = {}
        
        for mapping in port_mappings:
            container_port = f"{mapping.container_port}/{mapping.protocol}"
            host_port = str(mapping.host_port) if mapping.host_port else "0"  # 0 = auto
            
            bindings[container_port] = [{"HostPort": host_port}]
        
        return bindings
    
    def _prepare_volume_bindings(
        self,
        server_id: str,
        mounts: List[VolumeMount],
        volume_names: List[str]
    ) -> List[str]:
        """
        Prepare volume bindings for Docker HostConfig.
        
        Format: ["volume_name:/container/path:rw", "/host/path:/container/path:ro"]
        """
        bindings = []
        volume_idx = 0
        
        for mount in mounts:
            if mount.type == "volume":
                volume_name = volume_names[volume_idx]
                volume_idx += 1
                mode = "rw" if mount.read_write else "ro"
                bindings.append(f"{volume_name}:{mount.container_path}:{mode}")
            elif mount.type == "bind":
                mode = "rw" if mount.read_write else "ro"
                bindings.append(f"{mount.host_path}:{mount.container_path}:{mode}")
        
        return bindings
    
    def _extract_exposed_ports(self, container_info: Dict) -> Dict[str, int]:
        """Extract exposed ports from container info."""
        ports = {}
        
        network_settings = container_info.get("NetworkSettings", {})
        port_bindings = network_settings.get("Ports", {})
        
        for container_port, host_bindings in port_bindings.items():
            if host_bindings:
                # Take first binding
                host_port = int(host_bindings[0]["HostPort"])
                # Remove /tcp or /udp suffix
                internal_port = container_port.split("/")[0]
                ports[internal_port] = host_port
        
        return ports
    
    async def _wait_for_health(
        self,
        handle: DockerServerHandle,
        timeout: float = 30.0
    ) -> None:
        """Wait for container to become healthy."""
        # If no health check configured, just verify it's running
        if not handle.config.health_check_command:
            await asyncio.sleep(1.0)  # Give it a moment to fail if it's going to
            info = await handle.container.show()
            if info["State"]["Status"] != "running":
                raise DockerStartupError(
                    f"Container exited immediately: {info['State'].get('Error', 'unknown')}"
                )
            return
        
        # Wait for health check to pass
        start_time = time.time()
        while (time.time() - start_time) < timeout:
            info = await handle.container.show()
            health = info["State"].get("Health", {})
            status = health.get("Status", "none")
            
            if status == "healthy":
                return
            elif status == "unhealthy":
                raise DockerHealthCheckError(
                    f"Container health check failed: {health.get('FailingStreak', 0)} failures"
                )
            
            await asyncio.sleep(1.0)
        
        raise DockerHealthCheckError(
            f"Container health check timeout after {timeout}s"
        )
    
    async def stop_server(
        self,
        server_id: str,
        timeout: float = 10.0
    ) -> None:
        """Stop and remove Docker container."""
        handle = self._servers.get(server_id)
        if not handle:
            return
        
        self._logger.info(f"Stopping Docker server: {server_id}")
        
        try:
            # Stop container gracefully
            await handle.container.stop(timeout=timeout)
            
            # Remove container
            await handle.container.delete()
            
            # Remove volumes
            await self._cleanup_volumes(handle.volumes)
            
        except Exception as e:
            self._logger.error(
                f"Error stopping Docker server {server_id}: {e}",
                exc_info=True
            )
        finally:
            del self._servers[server_id]
        
        self._logger.info(f"Docker server stopped: {server_id}")
    
    async def _cleanup_volumes(self, volume_names: List[str]) -> None:
        """Remove Docker volumes."""
        for volume_name in volume_names:
            try:
                volume = await self._docker.volumes.get(volume_name)
                await volume.delete()
            except Exception as e:
                self._logger.warning(f"Failed to delete volume {volume_name}: {e}")
    
    async def _cleanup_resources(
        self,
        server_id: str,
        volume_names: List[str]
    ) -> None:
        """Cleanup resources after failed startup."""
        # Try to remove container if it exists
        try:
            container_name = f"stigmer-mcp-{server_id}"
            container = await self._docker.containers.get(container_name)
            await container.delete(force=True)
        except:
            pass
        
        # Remove volumes
        await self._cleanup_volumes(volume_names)
    
    async def stop_all(self, timeout: float = 10.0) -> None:
        """Stop all Docker servers."""
        if not self._servers:
            return
        
        self._logger.info(f"Stopping {len(self._servers)} Docker servers")
        
        await asyncio.gather(
            *[self.stop_server(sid, timeout) for sid in list(self._servers.keys())],
            return_exceptions=True
        )
    
    async def cleanup(self) -> None:
        """Cleanup Docker client."""
        await self.stop_all()
        
        if self._docker:
            await self._docker.close()
            self._docker = None
```

---

## Part 4: Unified MCP Server Registry

### 4.1 Coordinated Lifecycle Management

```python
# backend/services/stigmer-service/agent_runner/mcp/registry.py

import asyncio
import logging
from typing import Dict, Optional, Union
from enum import Enum

class ServerType(Enum):
    STDIO = "stdio"
    HTTP = "http"
    DOCKER = "docker"


class McpServerRegistry:
    """
    Unified registry for all MCP servers.
    
    Coordinates lifecycle management across stdio, HTTP, and Docker servers.
    """
    
    def __init__(self):
        self.stdio_manager = StdioServerManager()
        self.http_manager = HttpServerManager()
        self.docker_manager = DockerServerManager()
        
        self._servers: Dict[str, ServerType] = {}
        self._logger = logging.getLogger(__name__)
    
    async def initialize(self) -> None:
        """Initialize managers (particularly Docker)."""
        await self.docker_manager.initialize()
    
    async def start_server(
        self,
        server_id: str,
        mcp_server: McpServer,
        resolved_env: Dict[str, str]
    ) -> None:
        """
        Start an MCP server of any type.
        
        Args:
            server_id: Unique identifier
            mcp_server: McpServer resource with spec
            resolved_env: Environment variables (secrets decrypted, placeholders resolved)
        """
        spec = mcp_server.spec
        
        # Determine server type
        if spec.stdio:
            server_type = ServerType.STDIO
            await self.stdio_manager.start_server(
                server_id, spec.stdio, resolved_env
            )
        elif spec.http:
            server_type = ServerType.HTTP
            # HTTP needs resolved headers/params (placeholders already resolved)
            await self.http_manager.start_server(
                server_id,
                spec.http,
                spec.http.headers,  # Already resolved by environment service
                spec.http.query_params
            )
        elif spec.docker:
            server_type = ServerType.DOCKER
            await self.docker_manager.start_server(
                server_id, spec.docker, resolved_env
            )
        else:
            raise ValueError("McpServer must specify one of: stdio, http, docker")
        
        # Register
        self._servers[server_id] = server_type
        
        self._logger.info(
            f"MCP server started: {server_id} ({server_type.value})",
            extra={"server_id": server_id, "type": server_type.value}
        )
    
    async def stop_server(self, server_id: str) -> None:
        """Stop an MCP server of any type."""
        server_type = self._servers.get(server_id)
        if not server_type:
            self._logger.warning(f"Server not found: {server_id}")
            return
        
        if server_type == ServerType.STDIO:
            await self.stdio_manager.stop_server(server_id)
        elif server_type == ServerType.HTTP:
            await self.http_manager.stop_server(server_id)
        elif server_type == ServerType.DOCKER:
            await self.docker_manager.stop_server(server_id)
        
        del self._servers[server_id]
    
    async def stop_all(self) -> None:
        """Stop all MCP servers."""
        if not self._servers:
            return
        
        self._logger.info(f"Stopping all {len(self._servers)} MCP servers")
        
        # Stop all in parallel
        await asyncio.gather(
            self.stdio_manager.stop_all(),
            self.http_manager.stop_all(),
            self.docker_manager.stop_all(),
            return_exceptions=True
        )
        
        self._servers.clear()
    
    async def cleanup(self) -> None:
        """Cleanup all resources."""
        await self.stop_all()
        await self.docker_manager.cleanup()
```

---

## Part 5: Health Monitoring and Auto-Recovery

### 5.1 Periodic Health Checks

```python
# backend/services/stigmer-service/agent_runner/mcp/health_monitor.py

import asyncio
import logging
import time
from typing import Dict, Optional
from dataclasses import dataclass

@dataclass
class ServerHealth:
    """Health status of an MCP server."""
    server_id: str
    is_healthy: bool
    last_check_time: float
    consecutive_failures: int
    total_checks: int
    uptime_seconds: float


class HealthMonitor:
    """
    Monitors health of all MCP servers.
    
    Periodically checks if servers are responsive and triggers recovery.
    """
    
    def __init__(
        self,
        registry: McpServerRegistry,
        check_interval: float = 30.0,
        failure_threshold: int = 3
    ):
        self._registry = registry
        self._check_interval = check_interval
        self._failure_threshold = failure_threshold
        
        self._health: Dict[str, ServerHealth] = {}
        self._monitor_task: Optional[asyncio.Task] = None
        self._running = False
        self._logger = logging.getLogger(__name__)
    
    async def start(self) -> None:
        """Start health monitoring."""
        if self._running:
            return
        
        self._running = True
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        self._logger.info("Health monitor started")
    
    async def stop(self) -> None:
        """Stop health monitoring."""
        if not self._running:
            return
        
        self._running = False
        
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        
        self._logger.info("Health monitor stopped")
    
    async def _monitor_loop(self) -> None:
        """Main monitoring loop."""
        while self._running:
            try:
                await self._check_all_servers()
                await asyncio.sleep(self._check_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._logger.error(f"Error in health monitor: {e}", exc_info=True)
                await asyncio.sleep(self._check_interval)
    
    async def _check_all_servers(self) -> None:
        """Check health of all registered servers."""
        # Get list of server IDs (copy to avoid modification during iteration)
        server_ids = list(self._registry._servers.keys())
        
        for server_id in server_ids:
            await self._check_server(server_id)
    
    async def _check_server(self, server_id: str) -> None:
        """Check health of a single server."""
        server_type = self._registry._servers.get(server_id)
        if not server_type:
            return
        
        is_healthy = False
        
        try:
            if server_type == ServerType.STDIO:
                is_healthy = await self._check_stdio_server(server_id)
            elif server_type == ServerType.HTTP:
                is_healthy = await self._check_http_server(server_id)
            elif server_type == ServerType.DOCKER:
                is_healthy = await self._check_docker_server(server_id)
        except Exception as e:
            self._logger.error(
                f"Health check failed for {server_id}: {e}",
                extra={"server_id": server_id}
            )
            is_healthy = False
        
        # Update health record
        self._update_health(server_id, is_healthy)
    
    async def _check_stdio_server(self, server_id: str) -> bool:
        """Check if stdio server process is still running."""
        handle = self._registry.stdio_manager._servers.get(server_id)
        if not handle:
            return False
        
        return await handle.is_alive()
    
    async def _check_http_server(self, server_id: str) -> bool:
        """Check if HTTP server is responsive."""
        handle = self._registry.http_manager._servers.get(server_id)
        if not handle:
            return False
        
        try:
            # Simple connectivity check
            async with handle.session.get(
                handle.base_url,
                timeout=aiohttp.ClientTimeout(total=5.0)
            ) as response:
                # Any response means server is up
                return True
        except:
            return False
    
    async def _check_docker_server(self, server_id: str) -> bool:
        """Check if Docker container is running."""
        handle = self._registry.docker_manager._servers.get(server_id)
        if not handle:
            return False
        
        try:
            info = await handle.container.show()
            return info["State"]["Status"] == "running"
        except:
            return False
    
    def _update_health(self, server_id: str, is_healthy: bool) -> None:
        """Update health record and trigger recovery if needed."""
        health = self._health.get(server_id)
        
        if not health:
            # First health check
            health = ServerHealth(
                server_id=server_id,
                is_healthy=is_healthy,
                last_check_time=time.time(),
                consecutive_failures=0 if is_healthy else 1,
                total_checks=1,
                uptime_seconds=0.0
            )
            self._health[server_id] = health
        else:
            # Update existing record
            health.is_healthy = is_healthy
            health.last_check_time = time.time()
            health.total_checks += 1
            
            if is_healthy:
                health.consecutive_failures = 0
            else:
                health.consecutive_failures += 1
        
        # Trigger recovery if threshold exceeded
        if health.consecutive_failures >= self._failure_threshold:
            self._logger.error(
                f"Server {server_id} failed {health.consecutive_failures} "
                f"consecutive health checks - triggering recovery",
                extra={"server_id": server_id}
            )
            asyncio.create_task(self._recover_server(server_id))
    
    async def _recover_server(self, server_id: str) -> None:
        """
        Attempt to recover a failed server.
        
        Strategy: Restart the server (stop + start).
        """
        self._logger.info(f"Attempting to recover server: {server_id}")
        
        try:
            # This is a placeholder - actual recovery would need:
            # 1. The original McpServer resource
            # 2. The resolved environment
            # For now, just log the intent
            self._logger.warning(
                f"Server recovery not yet implemented for {server_id}",
                extra={"server_id": server_id}
            )
            
            # TODO: Implement actual recovery
            # await self._registry.stop_server(server_id)
            # await self._registry.start_server(server_id, original_spec, resolved_env)
            
        except Exception as e:
            self._logger.error(
                f"Failed to recover server {server_id}: {e}",
                extra={"server_id": server_id},
                exc_info=True
            )
```

---

## Part 6: Graceful Shutdown Coordinator

### 6.1 Clean Shutdown Sequence

```python
# backend/services/stigmer-service/agent_runner/mcp/shutdown.py

import asyncio
import logging
import signal
from typing import Optional

class ShutdownCoordinator:
    """
    Coordinates graceful shutdown of all MCP servers.
    
    Ensures all resources are cleaned up properly.
    """
    
    def __init__(
        self,
        registry: McpServerRegistry,
        health_monitor: HealthMonitor
    ):
        self._registry = registry
        self._health_monitor = health_monitor
        self._logger = logging.getLogger(__name__)
        self._shutdown_initiated = False
    
    def register_signal_handlers(self) -> None:
        """Register signal handlers for graceful shutdown."""
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda s, f: asyncio.create_task(self.shutdown()))
    
    async def shutdown(self) -> None:
        """Execute graceful shutdown sequence."""
        if self._shutdown_initiated:
            return
        
        self._shutdown_initiated = True
        
        self._logger.info("Initiating graceful shutdown")
        
        try:
            # 1. Stop health monitoring
            self._logger.info("Stopping health monitor")
            await self._health_monitor.stop()
            
            # 2. Stop all MCP servers
            self._logger.info("Stopping all MCP servers")
            await self._registry.stop_all()
            
            # 3. Cleanup registry resources
            self._logger.info("Cleaning up registry")
            await self._registry.cleanup()
            
            self._logger.info("Graceful shutdown complete")
            
        except Exception as e:
            self._logger.error(f"Error during shutdown: {e}", exc_info=True)
```

---

## Implementation Phases

### Phase 1: Stdio Server Management (3-4 days)
1. Create `stdio_manager.py` with `StdioServerManager`
2. Implement subprocess lifecycle (start, monitor, terminate)
3. Add stderr logging and startup verification
4. Write comprehensive tests (process lifecycle, error cases, cleanup)

### Phase 2: HTTP Server Management (3-4 days)
1. Create `http_manager.py` with `HttpServerManager`
2. Implement aiohttp session management with connection pooling
3. Add retry logic with exponential backoff
4. Implement circuit breaker pattern
5. Write comprehensive tests (connectivity, retries, circuit breaker)

### Phase 3: Docker Server Management (4-5 days)
1. Create `docker_manager.py` with `DockerServerManager`
2. Implement Docker SDK integration (container lifecycle)
3. Add volume mount creation and management
4. Implement port mapping with conflict detection
5. Add health check waiting logic
6. Write comprehensive tests (all container scenarios, cleanup)

### Phase 4: Unified Registry (2-3 days)
1. Create `registry.py` with `McpServerRegistry`
2. Integrate all three managers
3. Implement coordinated lifecycle management
4. Add integration tests (cross-type scenarios)

### Phase 5: Health Monitoring (2-3 days)
1. Create `health_monitor.py` with `HealthMonitor`
2. Implement periodic health checks for all types
3. Add failure detection and recovery logic
4. Write tests for health monitoring scenarios

### Phase 6: Graceful Shutdown (1-2 days)
1. Create `shutdown.py` with `ShutdownCoordinator`
2. Implement shutdown sequence
3. Add signal handler registration
4. Test shutdown scenarios (clean, interrupted, error cases)

### Phase 7: Integration & Testing (3-4 days)
1. End-to-end integration tests
2. Load testing (many servers)
3. Failure scenario testing
4. Documentation and examples

**Total Duration**: ~18-25 days (2.5-3.5 weeks)

---

## Success Criteria

- [ ] Stdio servers start as subprocesses with proper I/O pipes
- [ ] HTTP servers configured with connection pooling and retry logic
- [ ] Docker containers start with volumes and ports correctly mapped
- [ ] All server types shutdown gracefully (no orphans)
- [ ] Health monitoring detects failures and triggers recovery
- [ ] Resource cleanup complete (processes, containers, volumes)
- [ ] Zero leaked resources after shutdown
- [ ] Comprehensive test coverage (>90%)
- [ ] Production-ready error handling and logging
- [ ] Foundation-quality code with no technical debt

---

## Quality Standards

### Code Quality
- [ ] Type hints for all function signatures
- [ ] Comprehensive docstrings (Google style)
- [ ] Structured logging with context
- [ ] No secrets in logs (redaction)
- [ ] Error handling at every layer

### Testing
- [ ] Unit tests for each manager
- [ ] Integration tests for registry
- [ ] End-to-end tests for complete lifecycle
- [ ] Failure scenario tests
- [ ] Resource cleanup verification

### Security
- [ ] No privileged Docker containers
- [ ] Environment variable sanitization
- [ ] Process isolation (start_new_session)
- [ ] Volume mount validation
- [ ] Port conflict detection

### Performance
- [ ] Async/await throughout
- [ ] Connection pooling for HTTP
- [ ] Parallel server shutdown
- [ ] Minimal startup latency
- [ ] Efficient resource usage

---

## Review Process

**What happens next**:
1. **You review this comprehensive plan** - This is foundation-level work
2. **Provide feedback** - Any concerns, additional requirements, or changes
3. **I'll revise if needed** - Incorporate your feedback
4. **You approve** - Explicit approval to proceed with implementation
5. **Execution begins** - Implementation tracked in execution documents

**Critical questions to consider**:
- Does this architecture meet your requirements for a world-class platform?
- Are there additional MCP server types to support in the future?
- Any specific Docker security policies to enforce?
- Preferred logging/monitoring integrations?
- Expected scale (how many concurrent MCP servers)?

---

*This is foundation-quality work. Every line matters. Let's build something we'll be proud of.*
