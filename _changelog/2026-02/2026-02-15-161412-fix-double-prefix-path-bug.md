# Fix Double-Prefix Path Bug in FilesystemBackend

**Date**: February 15, 2026

## Summary

Fixed a critical path resolution bug in `FilesystemBackend._resolve_sandbox_path()` where agent-constructed absolute paths containing the root_dir prefix (e.g., `/workspace/bin/skills/...`) would double-prefix, resolving to non-existent paths like `/workspace/workspace/bin/skills/...`. The fix adds root_dir-prefix detection and stripping, making the filesystem backend robust to all three path formats: relative paths, absolute paths without root_dir, and absolute paths with root_dir.

## Problem Statement

The Graphton agent's `FilesystemBackend` implements chroot-like path resolution semantics to ensure that sandbox-internal paths (like `/bin/skills`) resolve relative to the workspace root, not the host filesystem. However, when agents construct absolute paths that already include the workspace root (e.g., `/workspace/bin/skills/abc123/SKILL.md`), the existing implementation would create a double-prefix bug.

### Pain Points

- **Skills unreachable**: When the skill-creator-agent tried to read skill files using absolute paths constructed from `pwd` output, files were reported as not found despite existing on disk
- **Unreliable path handling**: The system worked for relative paths (`bin/skills/...`) and simple absolute paths (`/bin/skills/...`) but failed for agent-constructed absolute paths
- **Prompt engineering insufficient**: Earlier attempts to fix this with prompt instructions ("Do NOT prefix paths with `/workspace/`") were unreliable because LLMs naturally construct absolute paths from context like `pwd`, `execute` tool output, and file listings
- **Debug confusion**: Error messages showed resolved paths like `/workspace/workspace/bin/skills/...` which didn't match user expectations

## Solution

Add root_dir-prefix detection and stripping at the top of `_resolve_sandbox_path()`, before the existing `lstrip("/")` logic. When the incoming path starts with the root_dir string, strip that prefix to make the path relative to root_dir, preventing the double-prefix.

The fix is deterministic and requires no changes to prompts or agent behavior - it handles any path format the agent might use.

## Implementation Details

**File**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`

**Change** (lines 85-93):
```python
# If the path already starts with root_dir, strip the prefix so we
# don't get a double-prefix (e.g. /workspace/workspace/...).  The
# agent may construct absolute paths like "/workspace/bin/skills/..."
# when root_dir is "/workspace" (from `pwd` output or tool context).
root_str = str(self.root_dir)
if path.startswith(root_str + "/"):
    path = path[len(root_str):]
elif path == root_str:
    path = ""

# Strip leading "/" so pathlib treats it as relative to root_dir
clean = path.lstrip("/")
resolved = (self.root_dir / clean).resolve()
```

**Path Resolution Table** (with `root_dir = /workspace`):

| Input Path | Before Fix | After Fix |
|------------|------------|-----------|
| `bin/skills/abc/SKILL.md` | `/workspace/bin/skills/abc/SKILL.md` ✅ | `/workspace/bin/skills/abc/SKILL.md` ✅ |
| `/bin/skills/abc/SKILL.md` | `/workspace/bin/skills/abc/SKILL.md` ✅ | `/workspace/bin/skills/abc/SKILL.md` ✅ |
| `/workspace/bin/skills/abc/SKILL.md` | `/workspace/workspace/bin/skills/abc/SKILL.md` ❌ | `/workspace/bin/skills/abc/SKILL.md` ✅ |

**Tests Added** (`test_filesystem_backend.py`):

Added 6 new test cases covering the double-prefix scenario:
- `test_path_starting_with_root_dir` - Verifies paths with root_dir prefix resolve correctly
- `test_path_equal_to_root_dir` - Verifies path exactly equal to root_dir resolves to root_dir itself
- `test_all_three_path_formats_resolve_identically` - Ensures all three path formats produce identical results
- `test_read_with_root_dir_prefix` - End-to-end read using root_dir-prefixed path
- `test_write_with_root_dir_prefix` - End-to-end write using root_dir-prefixed path
- `test_list_files_with_root_dir_prefix` - End-to-end list_files using root_dir-prefixed path

All 30 tests pass (24 existing + 6 new).

## Benefits

- **Robust path handling**: The filesystem backend now handles any path format an agent might construct, making it resilient to LLM behavior variations
- **Skills always readable**: Agents can read skill files regardless of how they construct the path (relative, absolute, or absolute with workspace prefix)
- **No prompt engineering needed**: No need to instruct agents about path format - the system "just works"
- **Better error messages**: When files genuinely don't exist, error messages show the correct resolved path for easier debugging
- **Backward compatible**: All existing path formats continue to work as before

## Impact

**Who's Affected**:
- **Agents using FilesystemBackend**: All agents running in local mode (ENV=local) benefit from more reliable file operations
- **Skill system**: The skill-creator-agent and skill-invoker-agent can now reliably read skill files
- **Future agents**: Any agent that constructs absolute paths from context will work correctly

**Production Readiness**:
- All tests pass
- No breaking changes
- Drop-in fix with no migration needed

## Related Work

- Earlier changelog: `2026-02-15-154629-fix-skill-injection-path-mismatch.md` - This fixed skill path injection but used prompt engineering to avoid the double-prefix bug. The current fix eliminates the need for that prompt instruction by making the filesystem backend robust.
- Plan document: `.cursor/plans/fix_double-prefix_path_bug_fb54a24e.plan.md` - Contains detailed root cause analysis and fix design

---

**Status**: ✅ Production Ready  
**Timeline**: ~2 hours (investigation + implementation + testing)
