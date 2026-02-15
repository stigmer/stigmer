# Fix Skill Path Resolution in Local Mode Agent Execution

**Date**: February 14, 2026

## Summary

Fixed a critical bug in local mode agent execution where skills written to the sandbox couldn't be accessed by the agent due to Python pathlib's absolute path handling. When the agent attempted to list `/bin/skills` using the `ls` tool, pathlib silently resolved it to the host's `/bin/skills` (non-existent on macOS) instead of `{sandbox_root}/bin/skills` where skills were actually written. This prevented agents like `skill-creator-agent` from accessing their skill scripts, causing execution failures.

The fix introduces chroot-like path resolution in `FilesystemBackend` that treats absolute paths as relative to the sandbox root, and updates `SkillWriter` to return relative paths in local mode. All platform tools (`ls`, `read`, `write`, `execute`) now correctly resolve sandbox-internal paths.

## Problem Statement

Agent execution in local mode was failing with mysterious "directory empty" errors when trying to access skills. The `stigmer draft skill` command (using `skill-creator-agent`) would upload input files successfully but fail when attempting to list `/bin/skills` to access skill scripts.

### Pain Points

- **Path resolution mismatch**: `SkillWriter` wrote skills to `{sandbox_root}/bin/skills/{hash}/` using string concatenation, but `FilesystemBackend` used Python pathlib which silently replaced the sandbox root when joining with absolute paths
- **Silent failure**: No error messages indicated the root cause - just "Directory '/bin/skills' is empty"
- **Mode-specific bug**: Only affected local mode; cloud/Daytona mode worked fine because `/bin/skills` was a real absolute path inside containers
- **Inconsistent semantics**: Relative paths like `inputs/data.txt` worked fine, but absolute paths like `/bin/skills` broke completely
- **Security gap**: No traversal protection to prevent `../../` escapes from the sandbox root

## Solution

Implement chroot-like path resolution in `FilesystemBackend` where all paths, including those starting with `/`, are resolved relative to the sandbox `root_dir`. This mirrors container behavior where `/` is the container root, not the host root.

## Implementation Details

### Fix 1: FilesystemBackend Path Resolution

**File**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`

Added `_resolve_sandbox_path()` method that:
- Strips leading `/` from paths before joining with `root_dir`
- Prevents traversal outside the sandbox via `../../` by validating resolved paths
- Provides consistent path semantics for both absolute and relative paths

```python
def _resolve_sandbox_path(self, path: str) -> Path:
    """Resolve path relative to sandbox root (chroot-like)."""
    clean = path.lstrip("/")
    resolved = (self.root_dir / clean).resolve()
    if not str(resolved).startswith(str(self.root_dir)):
        raise ValueError(f"Path '{path}' escapes sandbox root")
    return resolved
```

Updated all file operation methods (`read_file`, `write_file`, `list_files`) to use `_resolve_sandbox_path()` instead of direct pathlib joins.

### Fix 2: SkillWriter Returns Relative Paths in Local Mode

**File**: `backend/services/agent-runner/worker/activities/graphton/skill_writer.py`

Modified `_write_skills_local()` to strip the leading `/` from skill paths before returning them in the `skill_paths` dictionary. This ensures:
- Paths work with the new `FilesystemBackend` resolution
- Paths work with the `execute` tool (where `cwd=root_dir`)
- LOCATION headers in the system prompt use relative paths that resolve correctly

```python
# Return sandbox-relative path (strip leading "/")
skill_paths[skill_id] = skill_dir.lstrip("/")  # "bin/skills/{hash}"
```

Daytona mode unchanged - it continues using absolute paths since `/bin/skills` is a real path inside containers.

### Key Design Decision: Mode-Aware Path Format

Rather than changing `_get_skill_dir()` (which computes the canonical sandbox path), we strip the leading `/` at the point where paths are stored in the return dictionary. This keeps the path computation pure and localizes the mode awareness to the write operation.

## Testing

Added comprehensive test coverage (30 new tests):

**FilesystemBackend tests** (`tests/core/test_filesystem_backend.py`):
- Path resolution with absolute, relative, and edge case paths
- Traversal blocking via `../../` patterns
- The exact `ls('/bin/skills')` bug scenario that was failing
- End-to-end read/write/execute operations with absolute paths

**SkillWriter tests** (`tests/test_skill_writer.py`):
- Verification that local mode returns relative paths (no leading `/`)
- Verification that Daytona mode preserves absolute paths
- End-to-end integration: write via SkillWriter → read via FilesystemBackend
- Prompt LOCATION header format validation

All tests pass (52 tests total across both files).

## Benefits

**Immediate Fixes**:
- ✅ Agent execution works in local mode
- ✅ `stigmer draft skill` can now access skill scripts
- ✅ All platform tools (`ls`, `read`, `glob`, `grep`, `execute`) resolve paths correctly

**Security Improvements**:
- ✅ Traversal protection prevents sandbox escapes via `../../etc/passwd`
- ✅ Path validation enforced at the backend layer

**Consistency**:
- ✅ Local mode semantics now match cloud/Daytona mode behavior
- ✅ Absolute and relative paths handled uniformly
- ✅ Execute tool works with sandbox-relative paths

**Developer Experience**:
- ✅ Clear, predictable path behavior across modes
- ✅ No silent failures - validation errors are explicit
- ✅ Comprehensive test coverage prevents regressions

## Impact

**Who is affected**:
- All local development workflows using agent execution
- Developers running `stigmer draft skill` locally
- Any agent that needs to access skill scripts or artifacts

**Before this fix**:
- Local agent execution failed silently with "directory empty" errors
- Workaround required using cloud/Daytona mode
- Skills couldn't be tested locally

**After this fix**:
- Local execution matches cloud behavior
- Skills accessible via all platform tools
- Clean development workflow without workarounds

## Related Work

This fix aligns with:
- **ADR 001: Skill Injection & Sandbox Mounting Strategy** - Skills at `/bin/skills/{version_hash}/`
- **FilesystemBackend**: Local-mode backend for agent execution
- **SkillWriter**: Skill deployment to sandbox
- **Platform tools**: `ls`, `read`, `write`, `execute` tool wrappers

## Technical Details

**Root Cause**: Python pathlib's `Path.joinpath()` (or `/` operator) has special semantics for absolute paths:

```python
Path("/workspace") / "/bin/skills"   # => PosixPath('/bin/skills')  -- BAD!
Path("/workspace") / "bin/skills"    # => PosixPath('/workspace/bin/skills')  -- GOOD!
```

The leading `/` triggers pathlib to treat the right operand as an absolute path, discarding the left operand entirely. This is standard pathlib behavior but incompatible with sandbox semantics where `/` should mean "sandbox root", not "host root".

**Why It Worked for Writing**: `SkillWriter` used string concatenation (`f"{self.local_root}{skill_dir}"`) instead of pathlib, so writing succeeded. Only reading (via `FilesystemBackend`) failed.

**Why Cloud Mode Worked**: In Daytona containers, `/bin/skills` is a real absolute path inside the container filesystem, so pathlib resolution worked as expected.

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (2026-02-14)  
**Test Coverage**: 52 tests (30 new, 22 updated), all passing
