# Fix Daytona Shell Execution Working Directory

**Date**: March 30, 2026

## Summary

Fixed `WorkspaceNormalizingBackend.execute()` to run shell commands from the workspace root instead of the sandbox root in Daytona mode. This resolves broken `glob`, `grep`, `search`, and direct `execute` tool calls that use relative paths -- all of which silently searched the wrong directory.

## Problem Statement

The `WorkspaceNormalizingBackend` wrapper normalises file paths (read, write, list, delete) via `_normalize()` and the rebase prefix, but its `execute()` method forwarded commands to the inner `DaytonaBackend` without setting the working directory. The inner backend runs from the sandbox root (`/home/daytona`), not the workspace root (`/home/daytona/workspace`).

### Pain Points

- `execute "ls .stigmer/skills/skill-creator/scripts/"` failed because `.stigmer/` lives under the workspace root, not the sandbox root
- `glob` tool's `find . -name '*.py' ...` searched `/home/daytona/` instead of the workspace
- `grep` tool's `grep -rn ... .` searched the wrong directory
- `build_workspace_index_via_grep` failed to index workspace files
- File tools (read, write, list) worked fine because they go through `_normalize()` -- creating a confusing asymmetry where files are visible but shell tools can't find them

## Solution

Added a `cd {workspace_root} &&` preamble to `WorkspaceNormalizingBackend.execute()`, matching the pattern already used by `DaytonaWorkspaceBackend.execute()` (the setup backend) and equivalent to `FilesystemBackend`'s `subprocess.run(cwd=self.root_dir)`.

Also added an explicit `execute_streaming()` override to prevent `__getattr__` from leaking the inner backend's raw streaming method, which would bypass the fix.

## Implementation Details

**Single production file**: `backend/libs/python/graphton/src/graphton/core/backends/daytona.py`

**execute()** -- The `cd` preamble is inserted after platform command resolution (`.stigmer/` -> `$STIGMER_PLATFORM_DIR`) and before env var injection. Final shell shape:

```
export FOO='bar'; cd /home/daytona/workspace && <user_command>
```

Exports run unconditionally (`;`), then `cd` gates the user command (`&&`).

**execute_streaming()** -- New explicit override applies the same command transformation, then delegates to the inner backend's `execute_streaming` if available, or falls back to sync `execute` via `asyncio.to_thread`. Without this override, `tool_wrappers.py`'s `callable(getattr(backend, "execute_streaming", None))` check would find the inner backend's method via `__getattr__`, bypassing the `cd` fix entirely.

**What was NOT changed:**
- `write()` and `delete()` continue to call `self._inner.execute()` directly -- they pass normalized/rebased paths that resolve correctly from the sandbox root
- `FilesystemBackend`, `DaytonaWorkspaceBackend`, proto definitions, prompts -- all untouched

## Benefits

- Shell execution, glob, grep, and search tools now work correctly in Daytona mode
- Behaviour is consistent across local and Daytona backends
- Test-driven research confirmed `DaytonaBackend` (deepagents_cli) does not currently expose `execute_streaming`, with a canary test that will flag future changes

## Impact

- **Agent runtime (Daytona mode)**: All shell-based tools now resolve relative paths correctly
- **End users**: Commands like `ls .stigmer/skills/...` and glob/grep operations work as expected in cloud sandboxes
- **Test coverage**: 9 new unit tests + 5 new integration tests (live Daytona sandbox)

## Related Work

- Part of the [filesystem-backend-standardization](../_projects/2026-03/20260330.02.filesystem-backend-standardization/) project (T01 of 4)
- Predecessor: `fix-llm-path-confusion-in-skill-execution` (resolved `.stigmer/` virtual paths in the execute tool)
- Next: T02 will harden the `__getattr__` escape hatch more broadly

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour)
