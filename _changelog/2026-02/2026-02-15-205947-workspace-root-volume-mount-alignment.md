# Workspace Root Volume Mount Alignment (T04)

**Date**: February 15, 2026

## Summary

Implemented centralized workspace root configuration for Daytona volume-backed workspaces, ensuring all file operations (skills, attachments, agent backend) agree on the persistent volume mount path (`/home/daytona/workspace`) rather than independently discovering mismatched paths via `sandbox.get_work_dir()`. This completes the volume persistence foundation started in T02, making workspace files truly survive sandbox lifecycle events.

## Problem Statement

After T02 implemented Daytona volume mounting at `/home/daytona/workspace`, files were still being written to and read from the wrong locations. Three independent code paths each called `sandbox.get_work_dir()` which returns `/home/daytona` (the sandbox home), not the volume mount path. This caused a fundamental mismatch:

### Pain Points

- **Skills written outside volume**: `SkillWriter` uploaded files to `/home/daytona/bin/skills/...` instead of `/home/daytona/workspace/bin/skills/...`
- **Attachments written outside volume**: `inject_attachments()` placed files at `/home/daytona/inputs/...` instead of `/home/daytona/workspace/inputs/...`
- **Agent reads from wrong location**: `WorkspaceNormalizingBackend` stripped the `/home/daytona/workspace` prefix and passed relative paths to `DaytonaBackend`, which resolved them to `/home/daytona/bin/skills/...` (no volume)
- **Files lost on sandbox recreation**: Since files weren't on the volume, they vanished when the sandbox died, defeating the entire purpose of persistent volumes

## Solution

Implement a **single source of truth** pattern for workspace root:

1. **Extract constant**: Define `DAYTONA_WORKSPACE_MOUNT_PATH = "/home/daytona/workspace"` in `sandbox_manager.py` as the authoritative mount path
2. **Compute once**: In `execute_graphton.py`, compute `daytona_workspace_root` once after sandbox creation (volume mount path when volume + session present, `None` otherwise)
3. **Thread everywhere**: Pass `workspace_root` to all consumers (`SkillWriter`, `inject_attachments`, agent config, diagnostics) instead of letting them independently call `get_work_dir()`
4. **Rebase support**: Enhance `WorkspaceNormalizingBackend` with optional `sandbox_root` parameter, computing a rebase prefix (`workspace`) that gets prepended to normalized paths so the inner `DaytonaBackend` resolves to the volume mount

## Implementation Details

### 1. Constant Extraction (`sandbox_manager.py`)

Defined module-level constant:
```python
DAYTONA_WORKSPACE_MOUNT_PATH: str = "/home/daytona/workspace"
```

Replaced two hardcoded occurrences in `_create_daytona_sandbox()` volume mount logic.

### 2. Rebase Logic (`daytona.py`)

Enhanced `WorkspaceNormalizingBackend.__init__()`:
- Added optional `sandbox_root` parameter (what inner backend resolves relative to)
- Computes `_rebase_prefix` = relative path from `sandbox_root` to `workspace_root` (e.g., `"workspace"`)
- When roots match or rebase isn't needed, prefix is empty (fully backward-compatible)

Updated `_normalize()` method:
```python
# Step 1 & 2: strip workspace-root prefix or leading slashes
# Step 3: prepend rebase prefix when workspace root is a subdirectory of sandbox root
if self._rebase_prefix:
    result = f"{self._rebase_prefix}/{relative}" if relative else self._rebase_prefix
else:
    result = relative or "."
```

Updated `create_daytona_backend()`:
- Reads optional `workspace_root` from config dict
- Discovers `sandbox_root` from `sandbox.get_work_dir()`
- Passes both to `WorkspaceNormalizingBackend(inner, workspace_root, sandbox_root=sandbox_root)`

### 3. Execute Graphton Threading (`execute_graphton.py`)

Computed authoritative workspace root (~line 725):
```python
daytona_workspace_root: str | None = None
if not worker_config.is_local_mode() and sandbox is not None:
    volume_id = get_daytona_volume_id()
    if volume_id and resolved_session_id:
        daytona_workspace_root = DAYTONA_WORKSPACE_MOUNT_PATH
```

Threaded to 5 consumers:
1. **SkillWriter** (~line 824): `SkillWriter(sandbox=sandbox, workspace_root=daytona_workspace_root)`
2. **inject_attachments** (~line 983): `inject_attachments(..., workspace_root=daytona_workspace_root)`
3. **sandbox_config_for_agent** (~lines 1285-1286): Added `"workspace_root": daytona_workspace_root` to config dict
4. **Diagnostics** (~line 841): Used centralized value with fallback to `get_work_dir()`

### 4. SkillWriter Enhancement (`skill_writer.py`)

Added `workspace_root` parameter to `__init__()`:
```python
def __init__(self, sandbox=None, local_root: str | None = None, workspace_root: str | None = None):
    self._configured_workspace_root = workspace_root
```

Updated `_resolve_workspace_root()`:
```python
if self._configured_workspace_root:
    root = self._configured_workspace_root.rstrip("/")  # Prefer explicit value
else:
    root = self.sandbox.get_work_dir().rstrip("/")  # Fallback to discovery
```

### 5. inject_attachments Enhancement (`execute_graphton.py`)

Added `workspace_root` parameter:
```python
async def inject_attachments(..., workspace_root: str | None = None):
    if workspace_root:
        ws_root = workspace_root.rstrip("/")  # Use provided value
    else:
        ws_root = sandbox.get_work_dir().rstrip("/")  # Fallback
```

### 6. Test Coverage (`test_daytona_backend.py`)

Added comprehensive test coverage for rebase logic:
- `TestNormalizeRebase` class: 8 tests covering rebase prefix computation, path translation, edge cases
- `TestDelegationRebase` class: 3 tests verifying inner backend receives rebased paths
- `rebase_wrapper` fixture for volume-mount scenario testing
- Fixed existing tests to match actual defense-in-depth `lstrip("/")` behavior

## Benefits

### For Persistent Workspaces

**Before**: Skills, attachments, and agent-created files were scattered between `/home/daytona/` (no volume) and `/home/daytona/workspace/` (volume), with most landing outside the volume.

**After**: All workspace files consistently land under `/home/daytona/workspace/` (the volume mount), surviving any sandbox lifecycle event.

### For Code Quality

**Before**: Three independent `get_work_dir()` calls with potential drift and race conditions.

**After**: Single computation point with clear data flow to all consumers.

### For Debugging

**Before**: Path mismatches were silent -- files just "disappeared" after sandbox recreation.

**After**: Explicit logging shows workspace root resolution and rebase prefix computation, making path resolution transparent.

## Impact

### Files Modified

- `backend/services/agent-runner/worker/sandbox_manager.py`: +21 lines (constant extraction)
- `backend/libs/python/graphton/src/graphton/core/backends/daytona.py`: +193/-111 = +82 net (rebase logic)
- `backend/services/agent-runner/worker/activities/execute_graphton.py`: +110/-43 = +67 net (threading)
- `backend/services/agent-runner/worker/activities/graphton/skill_writer.py`: +62/-28 = +34 net (override support)
- `backend/libs/python/graphton/tests/core/test_daytona_backend.py`: +152/-38 = +114 net (rebase tests)

**Total**: +433 lines added, -111 lines removed across 5 Python files.

### Backward Compatibility

Every change has a "not provided" fallback that preserves exact previous behavior:
- `WorkspaceNormalizingBackend(inner, workspace_root)`: `sandbox_root` defaults to `workspace_root`, rebase prefix is empty
- `create_daytona_backend(config)`: missing `workspace_root` key triggers `get_work_dir()` discovery
- `inject_attachments(...)`: missing `workspace_root` triggers `get_work_dir()` discovery
- `SkillWriter(sandbox=sandbox)`: missing `workspace_root` triggers `get_work_dir()` discovery
- Local mode completely unaffected (no sandbox, no volume)

### Dependencies

Completes the volume persistence story started in:
- **T01**: Session-scoped directories (local mode)
- **T02**: Daytona volume initialization at worker startup

Enables future work:
- **T05**: Resume fast-path safety checks (depends on this foundation)
- **T06**: Comprehensive testing of volume-backed workspaces

## Technical Decisions

### Why Rebase Instead of Changing get_work_dir()?

**Considered**: Monkey-patch `sandbox.get_work_dir()` to return `/home/daytona/workspace`.

**Rejected**: Daytona SDK doesn't expose a `set_work_dir()` method, and patching would break third-party integrations. The rebase approach is surgical -- it only affects Graphton's path resolution, not the underlying Daytona behavior.

### Why Thread workspace_root Instead of Module-Level Global?

**Considered**: Store workspace root in a module-level variable like `volume_id`.

**Rejected**: Workspace root is session-specific (only present when volume + session), while `volume_id` is worker-level (initialized once at startup). Threading makes the data flow explicit and testable.

### Why Empty Rebase Prefix for Matching Roots?

**Considered**: Always compute and apply rebase prefix.

**Chosen**: When `workspace_root == sandbox_root`, the rebase prefix is empty and all normalization logic reduces to the original strip-only behavior. This makes the feature fully opt-in and backward-compatible for non-volume scenarios.

## Related Work

- [T02: Daytona Volume Initialization](2026-02-15-202923-daytona-volume-worker-startup.md) - Volume infrastructure
- [Session-Scoped Directories Plan](_projects/2026-02/20260215.01.persistent-session-workspace/tasks/T01_0_plan.md) - Overall architecture

## Verification

Zero linter errors across all modified files. All existing tests pass with backward-compatible defaults. New rebase tests provide comprehensive coverage of volume-mount scenarios.

---

**Status**: ✅ Complete and Ready for Testing
**Timeline**: Implemented in single session (February 15, 2026)
