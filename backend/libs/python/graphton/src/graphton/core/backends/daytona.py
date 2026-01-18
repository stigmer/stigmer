"""Daytona sandbox backend creation and management.

This module encapsulates all Daytona-specific logic for creating and configuring
Daytona sandbox backends, keeping the main factory clean and focused.
"""

from __future__ import annotations

import os
import time
from typing import Any

from deepagents.backends.protocol import BackendProtocol  # type: ignore[import-untyped]


def create_daytona_backend(config: dict[str, Any]) -> BackendProtocol:
    """Create Daytona sandbox backend from configuration.
    
    Handles three sandbox creation modes:
    1. Reuse existing sandbox (via sandbox_id) - fastest, preserves state
    2. Create from snapshot (via snapshot_id) - fast, pre-configured
    3. Create vanilla sandbox - clean slate
    
    Args:
        config: Configuration dictionary with optional keys:
            - api_key: Daytona API key (falls back to DAYTONA_API_KEY env var)
            - sandbox_id: Existing sandbox ID to reuse
            - snapshot_id: Snapshot ID to create sandbox from
    
    Returns:
        Configured DaytonaBackend instance.
    
    Raises:
        ValueError: If required dependencies are missing or API key not provided.
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
    
    return DaytonaBackend(sandbox)


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
