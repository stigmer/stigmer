# Agent Runner Local Mode Configuration (T2)

**Date**: January 19, 2026  
**Project**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`  
**Status**: T2 Complete - Configuration layer for local/cloud mode switching

## What Was Built

Implemented mode-aware configuration for Agent Runner to support both local (filesystem) and cloud (Daytona) execution modes.

### Key Accomplishment

**MODE vs ENV Clarity**: After initial implementation with `ENV`, corrected to use `MODE` to avoid confusion:
- `MODE` = execution infrastructure (local filesystem vs cloud sandbox)
- `ENV` = deployment environment (development/staging/production)

This separation ensures clean configuration semantics.

## Implementation Details

### 1. Configuration Class Enhancement

**File**: `backend/services/agent-runner/worker/config.py`

**Changes**:
- Added `mode` field to detect execution mode ("local" or "cloud")
- Added `sandbox_type` field ("filesystem" for local, "daytona" for cloud)
- Added `sandbox_root_dir` field (required for filesystem backend)
- Made Redis fields optional (`None` in local mode)
- Created `get_sandbox_config()` method for dynamic config generation
- Created `is_local_mode()` helper method

**Config Structure**:
```python
@dataclass
class Config:
    # Execution mode (separate from ENV!)
    mode: str  # "local" or "cloud"
    
    # Core Temporal (both modes)
    temporal_namespace: str
    temporal_service_address: str
    task_queue: str
    max_concurrency: int
    
    # Stigmer backend (both modes)
    stigmer_backend_endpoint: str
    stigmer_api_key: str
    
    # Sandbox (mode-specific)
    sandbox_type: str
    sandbox_root_dir: str | None
    
    # Redis (cloud mode only)
    redis_host: str | None
    redis_port: int | None
    redis_password: str | None
```

**Mode Detection Logic**:
```python
mode = os.getenv("MODE", "cloud")
is_local = mode == "local"

if is_local:
    sandbox_type = "filesystem"
    sandbox_root_dir = "./workspace"
    redis_host = None  # Not required
else:
    sandbox_type = "daytona"
    sandbox_root_dir = None
    redis_host = os.getenv("REDIS_HOST", "localhost")
```

**Sandbox Config Generation**:
```python
def get_sandbox_config(self) -> dict:
    if self.mode == "local":
        return {
            "type": "filesystem",
            "root_dir": self.sandbox_root_dir
        }
    else:
        config = {"type": "daytona"}
        if snapshot_id := os.getenv("DAYTONA_DEV_TOOLS_SNAPSHOT_ID"):
            config["snapshot_id"] = snapshot_id
        return config
```

### 2. Activity Integration

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

**Changes**:
- Imports and uses `Config.get_sandbox_config()` instead of hardcoded Daytona config
- Conditional sandbox manager initialization based on mode
- In local mode: bypasses SandboxManager, passes config directly to Graphton
- In cloud mode: preserves existing Daytona sandbox behavior
- Skills temporarily disabled in local mode (future enhancement)

**Integration Pattern**:
```python
# Load config and get sandbox config
worker_config = Config.load_from_env()
sandbox_config = worker_config.get_sandbox_config()

# Mode-aware sandbox handling
if worker_config.is_local_mode():
    # Local mode - no SandboxManager needed
    # Config passed directly to Graphton
    sandbox_config_for_agent = sandbox_config.copy()
else:
    # Cloud mode - use Daytona SandboxManager
    sandbox_manager = SandboxManager(daytona_api_key)
    sandbox, is_new = await sandbox_manager.get_or_create_sandbox(...)
    sandbox_config_for_agent = {
        "type": "daytona",
        "sandbox_id": sandbox.id
    }

# Pass to Graphton (works for both modes)
agent_graph = create_deep_agent(
    sandbox_config=sandbox_config_for_agent,
    ...
)
```

## Environment Variables

### Local Mode
```bash
MODE="local"                          # Execution mode
SANDBOX_TYPE="filesystem"             # Default
SANDBOX_ROOT_DIR="./workspace"        # Default
STIGMER_BACKEND_ENDPOINT="localhost:50051"
STIGMER_API_KEY="dummy-local-key"     # Relaxed validation

# Redis not required - fields are None
# DAYTONA_API_KEY not required

# ENV can still be set separately:
# ENV="development"  # Deployment environment
```

### Cloud Mode
```bash
MODE="cloud"                          # or unset (defaults to cloud)
REDIS_HOST="..."
REDIS_PORT="6379"
DAYTONA_API_KEY="..."
STIGMER_API_KEY="..."

# ENV for deployment:
# ENV="production"
```

## Repository Location

**Critical**: All changes made in **Stigmer OSS** repository (`stigmer/stigmer`), not `stigmer-cloud`.

The agent-runner code was moved to OSS, so:
- ✅ Modified: `stigmer/backend/services/agent-runner/worker/config.py`
- ✅ Modified: `stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py`
- ❌ NOT modified: `stigmer-cloud/backend/services/agent-runner/...` (reverted)

## Temporary Limitations

1. **Skills Not Supported in Local Mode**
   - Requires filesystem upload mechanism
   - Currently shows warning if skills configured
   - Will be implemented in future iteration

2. **Sandbox Persistence**
   - Local mode doesn't persist sandbox between runs
   - Each execution starts with fresh workspace
   - Future: Could implement workspace caching

## Technical Decisions

### 1. MODE vs ENV Naming

**Decision**: Use `MODE` environment variable, not `ENV`

**Rationale**:
- `ENV` typically refers to deployment environment (dev/staging/prod)
- `MODE` clearly indicates execution infrastructure choice
- Avoids confusion and semantic conflicts
- Allows both variables to coexist:
  - `MODE=local` + `ENV=development` (local dev mode)
  - `MODE=cloud` + `ENV=production` (cloud prod mode)

### 2. Optional Fields Pattern

**Decision**: Make Redis fields optional (`str | None`) instead of removing them

**Rationale**:
- Maintains type safety
- Single Config dataclass for both modes
- Clear None values indicate "not used in this mode"
- Easier to validate and debug

### 3. Configuration Methods

**Decision**: Add `get_sandbox_config()` and `is_local_mode()` helper methods

**Rationale**:
- Encapsulates mode-specific logic
- Single source of truth for sandbox config
- Makes calling code cleaner: `if worker_config.is_local_mode():`
- Easier to maintain and test

## Integration with Graphton

This configuration layer connects to Graphton's enhanced FilesystemBackend (completed in T1):
- Local mode → passes `{"type": "filesystem", "root_dir": "./workspace"}`
- Graphton creates FilesystemBackend with execute() capability
- Cloud mode → passes `{"type": "daytona", "sandbox_id": "..."}`
- Graphton creates Daytona backend (existing behavior)

## Testing Strategy

Since this is configuration-only changes:
- Mode detection tested via environment variable toggling
- Sandbox config generation tested for both modes
- Optional fields validated (no errors when None)
- Backward compatibility verified (cloud mode unchanged)

## Documentation Updates

All documentation updated to reflect MODE vs ENV:
- `_cursor/adr-doc` - Updated to use MODE
- `_projects/.../tasks.md` - T2 marked complete with MODE
- `_projects/.../notes.md` - Comprehensive implementation notes
- `_projects/.../next-task.md` - Points to T3 with MODE clarification

## Next Steps

With T2 complete, ready for:
- **T3**: Update Agent Runner main to connect to Stigmer Daemon gRPC when `MODE=local`
- **T4**: Implement secret injection in Stigmer Daemon for API keys
- **T5**: End-to-end testing and validation

## Impact

This configuration layer enables:
1. **Zero-config local development** - No Redis, Auth0, or Daytona setup required
2. **Cloud compatibility preserved** - Existing cloud mode unchanged
3. **Clear separation of concerns** - MODE (infrastructure) vs ENV (deployment)
4. **Foundation for daemon integration** - Ready for T3 gRPC connection
5. **Flexible execution** - Same agent-runner, different backends

## Files Modified

```
backend/services/agent-runner/worker/config.py         | +112 -2
backend/services/agent-runner/worker/activities/execute_graphton.py | +58 -45
```

**Total**: 2 files changed, 170 insertions(+), 47 deletions(-)

## Lessons Learned

1. **Naming Matters**: Using MODE instead of ENV avoided significant confusion
2. **Repository Location Matters**: Making changes in wrong repo (stigmer-cloud instead of stigmer OSS) required rework
3. **Optional Fields**: Making fields optional instead of removing maintains type safety
4. **Helper Methods**: `is_local_mode()` improves code readability over `mode == "local"`
5. **Documentation Clarity**: Extensive docstrings critical for mode-switching logic
6. **Gradual Migration**: Keeping cloud mode unchanged allows incremental testing

---

**Status**: ✅ T2 Complete  
**Next**: T3 - Agent Runner main gRPC connection for local mode
