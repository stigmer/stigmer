# Fix Workspace File Scanning -- Stop Scanning .git/objects/

**Date**: March 1, 2026

## Summary

Fixed a critical defect in the graphton filesystem backend where `glob` and `grep` tools recursively scanned `.git/objects/` and other noise directories when operating on a workspace. This produced thousands of WARNING logs per execution, caused massive I/O overhead, and ultimately crashed the agent-runner by missing Temporal heartbeat deadlines.

## Problem Statement

When an agent used `glob` or `grep` tools on a workspace backed by a git repository, the tools descended into `.git/objects/`, `__pycache__/`, `node_modules/`, and other infrastructure directories. A typical git repo with ~500 commits contains 5,000+ object files. For each object file, the tool called `list_files()` which logged a WARNING and threw `NotADirectoryError`, caught silently. This produced 5,000+ warning lines per tool invocation and enough I/O to cause the ExecuteGraphton Temporal activity to miss its heartbeat deadline and get killed.

### Pain Points

- Agent-runner logs flooded with "Path '...' is a file, not a directory" WARNING messages
- Agent executions crashing with "Activity stopped sending heartbeat (worker may have crashed)"
- `glob` and `grep` tools scanning binary git objects, wasting time and context budget
- `list_files()` had no filtering, despite `_format_directory_listing()` already filtering the same entries
- Tools used exception-driven control flow (catching `NotADirectoryError` on every file) instead of proper directory detection

## Solution

Three-layer fix addressing the root cause at the backend, tool, and logging levels.

## Implementation Details

### 1. Backend filtering in `list_files()` (highest impact)

`FilesystemBackend.list_files()` now applies the same `_SKIP_DIR_NAMES` filter (`.git`, `__pycache__`, `node_modules`, `.stigmer`) and hidden-entry exclusion (names starting with `.`) that `_format_directory_listing()` already used. This single change prevents tools from ever seeing `.git` as a directory to recurse into.

### 2. `is_directory()` method and proper traversal

Added `FilesystemBackend.is_directory()` -- a lightweight, exception-free check. Refactored `glob` and `grep` tools to use `is_directory()` instead of trying `list_files()` on every item and catching `NotADirectoryError`. Both tools maintain backward compatibility via `hasattr` fallback for backends that don't implement `is_directory()`.

### 3. Depth limit and log level

Added max recursion depth (15) to both `glob` and `grep` as defense-in-depth. Downgraded the `list_files()` "is a file, not a directory" log from WARNING to DEBUG since tools legitimately probe paths of unknown type.

### Files Changed

- `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` -- `list_files()` filtering, `is_directory()`, log level
- `backend/libs/python/graphton/src/graphton/core/backends/daytona.py` -- `is_directory()` delegation
- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` -- `glob` and `grep` traversal refactor
- `backend/libs/python/graphton/tests/core/test_filesystem_backend.py` -- 11 new tests
- `backend/libs/python/graphton/tests/core/test_tool_wrappers.py` -- Mock backend updates

## Benefits

- Eliminates 5,000+ WARNING log lines per `glob`/`grep` invocation on git-backed workspaces
- Prevents agent-runner heartbeat timeout crashes caused by I/O storm
- Reduces `glob`/`grep` execution time dramatically (no longer stat-ing thousands of git objects)
- Consistent filtering between `list_files()` and `read_file()` directory listing
- Defense-in-depth via recursion depth limits prevents unbounded traversal

## Impact

All agents that operate on git-backed workspaces (both `LocalPathSource` and `GitRepoSource`) benefit immediately. The `draft skill` and `draft agent` commands that attach the stigmer repo as workspace are the most directly affected -- these were the executions producing the screenshot of thousands of warning lines.

## Related Work

- `2026-03-01-043944-fix-localpathsource-agent-sandbox-wiring.md` -- Enabled LocalPathSource workspaces (which exposed this scanning bug)
- `2026-03-01-055125-directory-aware-agent-platform.md` -- Made directories first-class in the agent read tool

---

**Status**: Production Ready
