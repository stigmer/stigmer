---
name: Fix skill path resolution
overview: The agent execution failure in local mode is caused by a path resolution bug in `FilesystemBackend` where absolute paths (like `/bin/skills`) bypass the sandbox root directory due to Python pathlib's joining behavior, causing the agent to look at the host's `/bin/skills` instead of `{sandbox_root}/bin/skills`.
todos:
  - id: fix-filesystem-backend
    content: Add _resolve_sandbox_path() to FilesystemBackend and update read_file, write_file, list_files to use it. Ensure absolute paths resolve relative to root_dir (chroot-like). Add traversal protection.
    status: completed
  - id: fix-skill-writer-paths
    content: Update SkillWriter._write_skills_local() to return relative paths (strip leading /) in skill_paths dict. Leave Daytona mode unchanged.
    status: completed
  - id: add-filesystem-backend-tests
    content: Add tests for FilesystemBackend._resolve_sandbox_path() covering absolute paths, relative paths, traversal attempts, and the exact ls('/bin/skills') bug scenario.
    status: completed
  - id: update-skill-writer-tests
    content: Update test_skill_writer.py to verify local mode returns relative paths and that end-to-end write+read works with the new path format.
    status: completed
  - id: verify-fix
    content: Run the test suite and verify the fix resolves the issue observed in the logs.
    status: completed
isProject: false
---

# Fix Skill Path Resolution in Local Mode Agent Execution

## Problem Diagnosis

The log at `_cursor/logs.md` shows the `skill-creator-agent` executing via `stigmer draft skill`:

1. Agent reads 5 input files using **relative** paths (e.g., `inputs/agent-api.proto`) -- these WORK
2. Agent calls `ls("/bin/skills")` using an **absolute** path -- this FAILS (returns "empty")
3. Execution fails because the agent cannot find the skill scripts it needs

The skills ARE written correctly to `{sandbox_root}/bin/skills/{hash}/` on disk. The agent cannot find them because of a **pathlib join bug** in `FilesystemBackend`.

## Root Cause

### The pathlib absolute path trap

In [filesystem.py](backend/libs/python/graphton/src/graphton/core/backends/filesystem.py), all file operations use:

```python
dir_path = self.root_dir / path
```

In Python's pathlib, joining with an absolute path **replaces** the root:

```python
Path("/workspace") / "/bin/skills"   # => PosixPath('/bin/skills')  -- host path!
Path("/workspace") / "bin/skills"    # => PosixPath('/workspace/bin/skills')  -- correct!
```

So when the agent's `ls` tool calls `backend.list_files("/bin/skills")`, it resolves to the macOS host's `/bin/skills` (doesn't exist) instead of `{sandbox_root}/bin/skills` (where skills are actually written).

### Why skills ARE written correctly but can't be READ

The `SkillWriter._write_skills_local()` in [skill_writer.py](backend/services/agent-runner/worker/activities/graphton/skill_writer.py) uses **string concatenation** (not pathlib), so writing works:

```python
local_skill_dir = f"{self.local_root}{skill_dir}"  # "./workspace" + "/bin/skills/hash" = correct
```

But the agent's tools (`ls`, `read`, `glob`, `grep`) go through `FilesystemBackend` which uses pathlib join, so reading fails.

### The LOCATION header amplifies the issue

`generate_prompt_section()` in [skill_writer.py](backend/services/agent-runner/worker/activities/graphton/skill_writer.py) puts `LOCATION: /bin/skills/{hash}/` (absolute path) in the system prompt. This absolute path:

- Works in Daytona (cloud) because `/bin/skills` is a real path inside the container
- Breaks in local mode because the `FilesystemBackend` resolves it to the host filesystem
- Also breaks `execute` tool: commands like `python /bin/skills/{hash}/scripts/init_skill.py` reference absolute host paths

## Fix Plan

### Fix 1: Add chroot-like path resolution to `FilesystemBackend`

**File:** [backend/libs/python/graphton/src/graphton/core/backends/filesystem.py](backend/libs/python/graphton/src/graphton/core/backends/filesystem.py)

Add a `_resolve_sandbox_path()` method that strips leading `/` from paths, making all paths relative to `root_dir`. Apply it to `read_file`, `write_file`, `list_files`, and the `execute` method's `cwd` resolution. Also add path containment validation (prevent `../../` traversal escaping the sandbox root).

```python
def _resolve_sandbox_path(self, path: str) -> Path:
    """Resolve path relative to sandbox root (chroot-like).
    
    Absolute paths are treated as relative to root_dir:
      /bin/skills -> {root_dir}/bin/skills
    
    Traversal outside root is prevented.
    """
    clean = path.lstrip("/")
    resolved = (self.root_dir / clean).resolve()
    if not str(resolved).startswith(str(self.root_dir)):
        raise ValueError(f"Path '{path}' escapes sandbox root")
    return resolved
```

Update all methods to use `_resolve_sandbox_path()` instead of `self.root_dir / path`.

### Fix 2: Make `SkillWriter` return sandbox-relative paths in local mode

**File:** [backend/services/agent-runner/worker/activities/graphton/skill_writer.py](backend/services/agent-runner/worker/activities/graphton/skill_writer.py)

In `_write_skills_local()`, the `skill_paths` dict currently stores absolute sandbox paths like `/bin/skills/{hash}`. These should be relative (no leading `/`) so they work correctly with the fixed `FilesystemBackend` and also work with the `execute` tool (where `cwd=root_dir` and relative paths resolve correctly):

```python
# Change from:
skill_paths[skill_id] = skill_dir          # "/bin/skills/{hash}"
# To:
skill_paths[skill_id] = skill_dir.lstrip("/")  # "bin/skills/{hash}"
```

Leave `_write_skills_daytona()` unchanged -- it correctly uses absolute paths for the container filesystem.

### Fix 3: Update `_get_skill_dir()` to be mode-aware

Rather than changing `_get_skill_dir()` itself (which should remain a pure path computation), the path stripping in Fix 2 happens at the point where paths are stored in `skill_paths`. This keeps the method clean and the mode-awareness localized.

### Fix 4: Add tests for the path resolution fix

**File:** New tests in the existing [tests/core/test_tool_wrappers.py](backend/libs/python/graphton/tests/core/test_tool_wrappers.py) and update [tests/test_skill_writer.py](backend/services/agent-runner/tests/test_skill_writer.py).

Add tests for:

- `FilesystemBackend._resolve_sandbox_path()` with absolute paths, relative paths, traversal attempts
- `FilesystemBackend.list_files()` with absolute paths (the exact bug scenario)
- `FilesystemBackend.read_file()` / `write_file()` with absolute paths
- `SkillWriter._write_skills_local()` returns relative paths (not absolute)
- End-to-end: write skill via SkillWriter, then read via FilesystemBackend using the returned path

## Impact Assessment

- **Cloud mode (Daytona)**: No change. Absolute paths remain correct.
- **Local mode (filesystem)**: Skills become accessible. All platform tools (`ls`, `read`, `glob`, `grep`, `execute`) can now find skill files.
- **Security**: Path containment prevents sandbox escape via `../../` traversal (defense in depth).
- **Backwards compatibility**: Relative paths (like `inputs/foo.txt`) continue to work exactly as before since stripping `/` from a relative path is a no-op.

## Files to Modify

1. [backend/libs/python/graphton/src/graphton/core/backends/filesystem.py](backend/libs/python/graphton/src/graphton/core/backends/filesystem.py) -- Add `_resolve_sandbox_path()`, update all path-using methods
2. [backend/services/agent-runner/worker/activities/graphton/skill_writer.py](backend/services/agent-runner/worker/activities/graphton/skill_writer.py) -- Return relative paths in local mode
3. [backend/services/agent-runner/tests/test_skill_writer.py](backend/services/agent-runner/tests/test_skill_writer.py) -- Update tests for relative paths
4. New or updated test file for `FilesystemBackend` path resolution tests

