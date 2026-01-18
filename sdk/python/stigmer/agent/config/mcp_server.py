"""
MCP server configuration for agent configuration.
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict
from enum import Enum


class McpServerType(str, Enum):
    """Type of MCP server."""
    STDIO = "stdio"
    HTTP = "http"
    DOCKER = "docker"


@dataclass
class VolumeMount:
    """
    Docker volume mount configuration.
    
    Example:
        ```python
        mount = VolumeMount(
            host_path="/data",
            container_path="/mnt/data",
            read_only=True
        )
        ```
    """
    
    host_path: str
    """Host path to mount."""
    
    container_path: str
    """Container path where the volume is mounted."""
    
    read_only: bool = False
    """Whether the mount is read-only."""


@dataclass
class PortMapping:
    """
    Docker port mapping configuration.
    
    Example:
        ```python
        port = PortMapping(host_port=8080, container_port=80)
        ```
    """
    
    host_port: int
    """Host port to bind to."""
    
    container_port: int
    """Container port to expose."""
    
    protocol: str = "tcp"
    """Protocol (tcp or udp)."""


@dataclass
class McpServer:
    """
    MCP server definition for an agent.
    
    Supports three types of MCP servers:
    1. **stdio**: Subprocess-based servers (most common)
    2. **http**: HTTP + SSE servers (for remote services)
    3. **docker**: Containerized MCP servers
    
    Example:
        ```python
        # stdio server
        github = McpServer.stdio(
            name="github",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-github"],
            env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"}
        )
        
        # HTTP server
        api = McpServer.http(
            name="api-service",
            url="https://mcp.example.com",
            headers={"Authorization": "Bearer ${API_TOKEN}"}
        )
        
        # Docker server
        custom = McpServer.docker(
            name="custom-mcp",
            image="ghcr.io/org/mcp:latest",
            env_placeholders={"API_KEY": "${API_KEY}"}
        )
        ```
    """
    
    name: str
    """Name of the MCP server (e.g., "github", "aws", "slack")."""
    
    server_type: McpServerType
    """Type of server (stdio, http, or docker)."""
    
    # stdio-specific fields
    command: Optional[str] = None
    """Command to run (stdio only)."""
    
    args: Optional[List[str]] = None
    """Command arguments (stdio and docker)."""
    
    working_dir: Optional[str] = None
    """Working directory (stdio only)."""
    
    # HTTP-specific fields
    url: Optional[str] = None
    """Base URL (http only)."""
    
    headers: Optional[Dict[str, str]] = None
    """HTTP headers (http only)."""
    
    query_params: Optional[Dict[str, str]] = None
    """Query parameters (http only)."""
    
    timeout_seconds: Optional[int] = None
    """HTTP timeout in seconds (http only)."""
    
    # Docker-specific fields
    image: Optional[str] = None
    """Docker image (docker only)."""
    
    volumes: Optional[List[VolumeMount]] = None
    """Volume mounts (docker only)."""
    
    network: Optional[str] = None
    """Docker network (docker only)."""
    
    ports: Optional[List[PortMapping]] = None
    """Port mappings (docker only)."""
    
    container_name: Optional[str] = None
    """Container name (docker only)."""
    
    # Common fields
    env_placeholders: Optional[Dict[str, str]] = field(default_factory=dict)
    """Environment variable placeholders (all types)."""
    
    enabled_tools: Optional[List[str]] = None
    """Tool names to enable (empty = all tools)."""
    
    @classmethod
    def stdio(
        cls,
        name: str,
        command: str,
        args: Optional[List[str]] = None,
        env_placeholders: Optional[Dict[str, str]] = None,
        working_dir: Optional[str] = None,
        enabled_tools: Optional[List[str]] = None,
    ) -> "McpServer":
        """
        Create a stdio-based MCP server (subprocess with stdin/stdout).
        
        Args:
            name: Server name
            command: Command to run (e.g., "npx", "python")
            args: Command arguments
            env_placeholders: Environment variable placeholders
            working_dir: Working directory (optional)
            enabled_tools: Tool names to enable (optional)
            
        Returns:
            McpServer configured for stdio
            
        Example:
            ```python
            server = McpServer.stdio(
                name="github",
                command="npx",
                args=["-y", "@modelcontextprotocol/server-github"],
                env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"}
            )
            ```
        """
        return cls(
            name=name,
            server_type=McpServerType.STDIO,
            command=command,
            args=args or [],
            env_placeholders=env_placeholders or {},
            working_dir=working_dir,
            enabled_tools=enabled_tools,
        )
    
    @classmethod
    def http(
        cls,
        name: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        query_params: Optional[Dict[str, str]] = None,
        timeout_seconds: Optional[int] = None,
        enabled_tools: Optional[List[str]] = None,
    ) -> "McpServer":
        """
        Create an HTTP-based MCP server (HTTP + Server-Sent Events).
        
        Args:
            name: Server name
            url: Base URL of the MCP server
            headers: HTTP headers (optional)
            query_params: Query parameters (optional)
            timeout_seconds: HTTP timeout (optional, default: 30)
            enabled_tools: Tool names to enable (optional)
            
        Returns:
            McpServer configured for HTTP
            
        Example:
            ```python
            server = McpServer.http(
                name="api-service",
                url="https://mcp.example.com",
                headers={"Authorization": "Bearer ${API_TOKEN}"}
            )
            ```
        """
        return cls(
            name=name,
            server_type=McpServerType.HTTP,
            url=url,
            headers=headers or {},
            query_params=query_params or {},
            timeout_seconds=timeout_seconds,
            enabled_tools=enabled_tools,
        )
    
    @classmethod
    def docker(
        cls,
        name: str,
        image: str,
        args: Optional[List[str]] = None,
        env_placeholders: Optional[Dict[str, str]] = None,
        volumes: Optional[List[VolumeMount]] = None,
        network: Optional[str] = None,
        ports: Optional[List[PortMapping]] = None,
        container_name: Optional[str] = None,
        enabled_tools: Optional[List[str]] = None,
    ) -> "McpServer":
        """
        Create a Docker-based MCP server (containerized).
        
        Args:
            name: Server name
            image: Docker image name
            args: Container command arguments (optional)
            env_placeholders: Environment variable placeholders (optional)
            volumes: Volume mounts (optional)
            network: Docker network (optional)
            ports: Port mappings (optional)
            container_name: Container name (optional)
            enabled_tools: Tool names to enable (optional)
            
        Returns:
            McpServer configured for Docker
            
        Example:
            ```python
            server = McpServer.docker(
                name="custom-mcp",
                image="ghcr.io/org/mcp:latest",
                env_placeholders={"API_KEY": "${API_KEY}"},
                volumes=[VolumeMount("/data", "/mnt/data")]
            )
            ```
        """
        return cls(
            name=name,
            server_type=McpServerType.DOCKER,
            image=image,
            args=args or [],
            env_placeholders=env_placeholders or {},
            volumes=volumes or [],
            network=network,
            ports=ports or [],
            container_name=container_name,
            enabled_tools=enabled_tools,
        )
    
    def __str__(self) -> str:
        """String representation."""
        return f"McpServer({self.name}, type={self.server_type.value})"
