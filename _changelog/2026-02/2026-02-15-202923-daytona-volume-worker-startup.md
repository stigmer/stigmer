# Daytona Volume Initialization at Worker Startup

**Date**: February 15, 2026

## Summary

Implemented persistent workspace support for agent execution by initializing a global Daytona Volume at worker startup. The volume is mounted into sandboxes with per-session isolation via subpaths, ensuring workspace files survive sandbox lifecycle events. This is a foundational infrastructure change that decouples filesystem persistence from ephemeral compute.

## Problem Statement

Agent execution was failing silently after approval when the Daytona sandbox died between pause and resume. The `is_resume` fast-path skipped writing skills and attachments to the sandbox under the assumption the filesystem persisted -- but when the sandbox was recreated (new sandbox, empty filesystem), the agent resumed in an empty workspace with no skills, no attachments, and no previously created files.

### Pain Points

- Workspace files (skills, attachments, agent work products) coupled to sandbox lifecycle
- When a sandbox died (TTL expiration, auto-delete, infrastructure event), all files were lost
- Resume fast-path compounded the problem by skipping file writes on the assumption files persisted
- Post-approval execution hung or failed silently due to missing workspace context

## Solution

Decouple workspace filesystem from sandbox compute lifecycle by introducing a **single global Daytona Volume** (`stigmer-workspaces`) that persists independently. The volume is initialized once at worker startup and mounted into every sandbox with session-scoped subpath isolation (`sessions/{session_id}`).

### Architecture Pattern

The implementation respects the fundamental lifecycle difference between volume (worker-level infrastructure) and sandbox (per-session compute):

- **Volume**: Created once at worker startup, shared across all executions, persists indefinitely
- **Sandbox**: Created/reused per execution, ephemeral (may die anytime)

Volume initialization mirrors the existing Redis initialization pattern -- cloud-mode infrastructure initialized once at worker startup in `AgentRunner.__init__`, used by all subsequent activity executions.

## Implementation Details

### 1. Module-Level Volume Store (`sandbox_manager.py`)

Following the `token_manager.py` pattern for API key sharing:

```python
# Worker-level Daytona volume state
_daytona_volume_id: str | None = None

def get_daytona_volume_id() -> str | None:
    """Return the Daytona volume ID set at worker startup, or None."""
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
    
    Called once at worker startup. Uses Daytona's idempotent
    volume.get(name, create=True) so the call is safe to retry on
    worker restarts. The resulting volume ID is stored in the
    module-level store for activities to read.
    """
    daytona = Daytona(DaytonaConfig(api_key=api_key))
    volume = daytona.volume.get(volume_name, create=True)
    set_daytona_volume_id(volume.id)
    logger.info(
        "Daytona volume initialized: name='%s', id='%s'",
        volume_name,
        volume.id,
    )
    return volume.id
```

**Key design choice**: `initialize_daytona_volume()` is a module-level function, not a `SandboxManager` method, because volume initialization is a worker-level concern that happens before any `SandboxManager` instance exists.

### 2. Worker Startup Integration (`worker.py`)

Added `_initialize_daytona_volume()` to cloud-mode infrastructure initialization:

```python
# Initialize cloud-mode infrastructure
if not config.is_local_mode():
    self._initialize_redis()
    self._initialize_daytona_volume()
else:
    self.logger.info(
        "Local mode: Skipping Redis and Daytona volume initialization"
    )

def _initialize_daytona_volume(self):
    """Initialize Daytona persistent volume for workspace persistence."""
    api_key = os.environ.get("DAYTONA_API_KEY", "")
    if not api_key:
        raise ValueError(
            "DAYTONA_API_KEY required for cloud mode Daytona volume initialization"
        )
    
    volume_name = os.environ.get("DAYTONA_VOLUME_NAME", "stigmer-workspaces")
    
    volume_id = initialize_daytona_volume(api_key, volume_name)
    self.logger.info(
        "✅ Daytona persistent volume ready: name='%s', id='%s'",
        volume_name,
        volume_id,
    )
```

**Fail-fast behavior**: If volume initialization fails, the worker fails to start. This is intentional -- workspace persistence is the core promise; silent degradation would be a correctness bug.

### 3. Sandbox Volume Mounting (`sandbox_manager.py`)

Modified `_create_daytona_sandbox()` to accept `session_id` and build `VolumeMount` when both `volume_id` and `session_id` are present:

```python
def _create_daytona_sandbox(
    self,
    config: dict,
    session_id: str | None = None,
) -> Any:
    # Build volume mounts for workspace persistence
    volume_mounts: list[Any] = []
    if self._volume_id and session_id:
        volume_mounts.append(
            VolumeMount(
                volume_id=self._volume_id,
                mount_path="/home/daytona/workspace",
                subpath=f"sessions/{session_id}",
            )
        )
        logger.info(
            "Volume mount configured: volume=%s, "
            "mount_path=/home/daytona/workspace, subpath=sessions/%s",
            self._volume_id,
            session_id,
        )
    
    # Pass volumes to CreateSandboxFromSnapshotParams
    if snapshot_id:
        params = CreateSandboxFromSnapshotParams(
            snapshot=snapshot_id,
            volumes=volume_mounts if volume_mounts else None,
        )
        sandbox = self._daytona.create(params=params)
    else:
        if volume_mounts:
            params = CreateSandboxFromSnapshotParams(volumes=volume_mounts)
            sandbox = self._daytona.create(params=params)
        else:
            sandbox = self._daytona.create()
```

**Backward compatibility preserved**: When `session_id` is `None`, sandboxes are created without volume mounts (ephemeral), consistent with existing behavior.

### 4. Activity Wiring (`execute_graphton.py`)

Two-line change to read volume ID from store and pass to `SandboxManager`:

```python
from worker.sandbox_manager import SandboxManager, get_daytona_volume_id

sandbox_manager = SandboxManager(
    daytona_api_key=api_key,
    volume_id=get_daytona_volume_id(),
)
```

## Benefits

### Workspace Persistence
- Skills, attachments, and agent work products survive any sandbox lifecycle event
- Post-approval execution resumes with full workspace context intact
- No silent failures due to missing files

### Clean Architecture
- Volume lifecycle separated from sandbox lifecycle
- Worker-level infrastructure concerns handled at worker startup
- Activity code simply reads the pre-initialized volume ID
- Zero extra Volume API calls per execution (initialized once at startup)

### Operational Safety
- Fail-fast on volume initialization errors (worker won't start with broken volume setup)
- Idempotent volume.get() safe for worker restarts
- Clear logging at each layer (startup, sandbox creation)

### Backward Compatibility
- Local mode completely unaffected (guarded by cloud-mode checks)
- Ephemeral sandboxes (session_id=None) still supported
- Existing sandbox reuse logic preserved

## Impact

**Core Components Modified**:
- `worker/sandbox_manager.py` (+133 lines): Volume store, initialization, mounting
- `worker/worker.py` (+43 lines): Worker startup integration
- `worker/activities/execute_graphton.py` (+7 lines): Activity wiring

**Behavioral Changes**:
- Cloud mode worker startup now includes volume initialization (new log: "✅ Daytona persistent volume ready")
- New sandboxes created with VolumeMount when session_id is provided
- Workspace files at `/home/daytona/workspace` in sandboxes now persist across sandbox recreations

**Deployment Requirements**:
- No breaking changes to existing deployments
- `DAYTONA_VOLUME_NAME` env var optional (defaults to `stigmer-workspaces`)
- No proto changes or cross-service coordination needed

## Related Work

**Design Decision**: [DD01: Persistent Volume Over Sandbox Filesystem](../../_projects/2026-02/20260215.01.persistent-session-workspace/design-decisions/DD01-persistent-volume-over-sandbox-filesystem.md)

**Task Plan**: T02 from [20260215.01.persistent-session-workspace](../../_projects/2026-02/20260215.01.persistent-session-workspace/tasks/T01_0_plan.md)

**Next Steps**:
- T03: Sandbox restart/recovery before recreation (preserve runtime packages)
- T04: Backend workspace root from volume mount path
- T05: Simplify resume fast-path with volume safety checks

---

**Status**: ✅ Production Ready  
**Timeline**: Implemented Feb 15, 2026
