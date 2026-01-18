"""Sandbox backend factory for declarative configuration.

This module provides a factory function to create sandbox backend instances
from declarative configuration dictionaries, following the same pattern as
MCP server/tool configuration in Graphton.
"""

from __future__ import annotations

from typing import Any

from deepagents.backends.protocol import BackendProtocol  # type: ignore[import-untyped]


def create_sandbox_backend(config: dict[str, Any]) -> BackendProtocol:
    """Create sandbox backend from declarative configuration.
    
    This factory function instantiates appropriate backend implementations
    based on configuration dictionaries, enabling declarative agent setup
    without manual backend instantiation.
    
    Args:
        config: Sandbox configuration dictionary with required 'type' key.
            Supported types:
            - 'filesystem': Local filesystem with file operations + shell execution
            - 'daytona': Daytona cloud sandbox with full execution support
            - 'modal': Modal.com cloud sandbox (future)
            - 'runloop': Runloop cloud sandbox (future)
            - 'harbor': LangGraph Cloud/Harbor (future)
    
    Returns:
        Configured backend instance implementing BackendProtocol.
        For 'filesystem' type, returns enhanced FilesystemBackend which provides
        file operations (read, write, edit, ls, glob, grep) AND shell command
        execution via the execute method for local agent runtime.
        For 'daytona' type, returns DaytonaBackend which implements SandboxBackendProtocol
        and supports full shell command execution via the execute tool.
    
    Raises:
        ValueError: If config is missing 'type' key or type is unsupported.
        ValueError: If required configuration parameters are missing.
    
    Examples:
        Reuse existing Daytona sandbox (recommended for performance):
        
        >>> config = {
        ...     "type": "daytona",
        ...     "sandbox_id": "sandbox-xyz789"  # Reuse existing sandbox
        ... }
        >>> backend = create_sandbox_backend(config)
        >>> # Requires DAYTONA_API_KEY environment variable
        >>> # Instant connection to existing sandbox with skills/state preserved
        
        Create Daytona sandbox backend with pre-built snapshot:
        
        >>> config = {
        ...     "type": "daytona",
        ...     "snapshot_id": "snap-abc123"  # Pre-built with all CLIs
        ... }
        >>> backend = create_sandbox_backend(config)
        >>> # Requires DAYTONA_API_KEY environment variable
        >>> # Instant spin-up from snapshot with all tools pre-installed
        
        Create vanilla Daytona sandbox:
        
        >>> config = {"type": "daytona"}
        >>> backend = create_sandbox_backend(config)
        >>> # Agent will have execute tool enabled for shell commands
        
        Create filesystem backend (file operations + shell execution):
        
        >>> config = {"type": "filesystem", "root_dir": "/workspace"}
        >>> backend = create_sandbox_backend(config)
        >>> # Agent will have execute capability for local development
        >>> # Commands run directly on host machine in workspace directory
    
    """
    if not isinstance(config, dict):
        raise ValueError(
            f"sandbox_config must be a dictionary, got {type(config).__name__}"
        )
    
    backend_type = config.get("type")
    
    if not backend_type:
        raise ValueError(
            "sandbox_config must include 'type' key. "
            "Supported types: filesystem, modal, runloop, daytona, harbor"
        )
    
    if backend_type == "filesystem":
        # Use local enhanced FilesystemBackend with execute() support
        from graphton.core.backends import FilesystemBackend
        
        root_dir = config.get("root_dir", ".")
        return FilesystemBackend(root_dir=root_dir)
    
    elif backend_type == "daytona":
        # Delegate to specialized Daytona backend module
        from graphton.core.backends.daytona import create_daytona_backend
        
        return create_daytona_backend(config)
    
    elif backend_type == "modal":
        raise ValueError(
            "Modal sandbox support coming soon. "
            "For now, use 'filesystem' type for local execution."
        )
    
    elif backend_type == "runloop":
        raise ValueError(
            "Runloop sandbox support coming soon. "
            "For now, use 'filesystem' type for local execution."
        )
    
    elif backend_type == "harbor":
        raise ValueError(
            "Harbor sandbox support coming soon. "
            "For now, use 'filesystem' type for local execution."
        )
    
    else:
        raise ValueError(
            f"Unsupported sandbox type: {backend_type}. "
            f"Supported types: filesystem, modal, runloop, daytona, harbor"
        )

