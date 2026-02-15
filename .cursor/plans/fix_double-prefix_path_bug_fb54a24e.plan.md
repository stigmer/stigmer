---
name: Fix Double-Prefix Path Bug
overview: Fix the double-prefix bug in FilesystemBackend._resolve_sandbox_path() that causes skill files to be unreachable when the agent uses paths containing the root_dir prefix.
todos:
  - id: fix-resolve-path
    content: Add root_dir-prefix stripping to FilesystemBackend._resolve_sandbox_path() in filesystem.py (line ~85)
    status: pending
  - id: add-tests
    content: "Add test cases for all three path formats: relative, absolute-no-root, absolute-with-root"
    status: pending
  - id: verify-e2e
    content: Run the skill-creator-agent locally to verify skills are now readable
    status: pending
isProject: false
---

# Fix Double-Prefix Path Bug in FilesystemBackend

## Root Cause

`[FilesystemBackend._resolve_sandbox_path()](backend/libs/python/graphton/src/graphton/core/backends/filesystem.py)` (line 60) has chroot-like semantics that strip the leading `/` from absolute paths. But when the agent passes a path that already starts with the `root_dir` itself (e.g., `/workspace/bin/skills/...`), stripping only the `/` leaves `workspace/bin/skills/...`, which then resolves to `/workspace/workspace/bin/skills/...` -- a double prefix. The file exists at `/workspace/bin/skills/...` but the resolved path points to a non-existent location.

This happens because the agent discovers the workspace root (via `pwd`, the `execute` tool, or from context) and constructs absolute paths. LLMs do this regardless of prompt instructions telling them to use relative paths.

**Current code** (line 85-87):

```python
clean = path.lstrip("/")
resolved = (self.root_dir / clean).resolve()
```

**Path resolution table (root_dir = `/workspace`):**

- `bin/skills/{hash}/SKILL.md` → `/workspace/bin/skills/{hash}/SKILL.md` (correct)
- `/bin/skills/{hash}/SKILL.md` → `/workspace/bin/skills/{hash}/SKILL.md` (correct)
- `/workspace/bin/skills/{hash}/SKILL.md` → `/workspace/workspace/bin/skills/{hash}/SKILL.md` (BUG)

## Fix

Add a root_dir-prefix check in `_resolve_sandbox_path()` before the `lstrip("/")` call. If the path starts with `root_dir`, strip the root_dir prefix so the path becomes relative to it.

**File**: `[backend/libs/python/graphton/src/graphton/core/backends/filesystem.py](backend/libs/python/graphton/src/graphton/core/backends/filesystem.py)`, lines 60-95

**Change**: Before line 86 (`clean = path.lstrip("/")`), add:

```python
root_str = str(self.root_dir)
# If path already starts with root_dir, strip it to avoid double-prefix.
# The agent may construct absolute paths like "/workspace/bin/skills/..."
# when root_dir is "/workspace". Without this check, lstrip("/") would
# leave "workspace/bin/skills/..." which resolves to
# "/workspace/workspace/bin/skills/..." (double prefix).
if path.startswith(root_str + "/"):
    path = path[len(root_str):]
elif path == root_str:
    path = ""
```

**After fix, all three path formats resolve correctly:**

- `bin/skills/{hash}/SKILL.md` → `/workspace/bin/skills/{hash}/SKILL.md` (correct, unchanged)
- `/bin/skills/{hash}/SKILL.md` → `/workspace/bin/skills/{hash}/SKILL.md` (correct, unchanged)
- `/workspace/bin/skills/{hash}/SKILL.md` → `/workspace/bin/skills/{hash}/SKILL.md` (FIXED)

## Why This Is Better Than Prompt Engineering

The earlier changelog fix added "Do NOT prefix paths with `/workspace/`" to the prompt. But:

- LLMs routinely construct absolute paths from context (e.g., `pwd` output, file listings)
- The `execute` tool runs with `cwd=/workspace`, so the agent learns this path
- Prompt-based path restrictions are inherently unreliable

The `_resolve_sandbox_path()` fix is deterministic and handles ANY path format the agent might use.

## Tests

Update tests in the graphton test suite to verify all three path formats work:

```python
def test_resolve_sandbox_path_relative(backend):
    assert backend._resolve_sandbox_path("bin/skills/abc/SKILL.md") == Path("/workspace/bin/skills/abc/SKILL.md")

def test_resolve_sandbox_path_absolute_no_root(backend):
    assert backend._resolve_sandbox_path("/bin/skills/abc/SKILL.md") == Path("/workspace/bin/skills/abc/SKILL.md")

def test_resolve_sandbox_path_absolute_with_root(backend):
    # The double-prefix bug fix
    assert backend._resolve_sandbox_path("/workspace/bin/skills/abc/SKILL.md") == Path("/workspace/bin/skills/abc/SKILL.md")
```

## Scope

- **1 file changed**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` -- add ~5 lines to `_resolve_sandbox_path()`
- **Tests added**: verify the three path format cases
- **No other changes needed**: the SkillWriter and prompt changes from the earlier session are fine as-is; this fix makes the system robust regardless of path format

