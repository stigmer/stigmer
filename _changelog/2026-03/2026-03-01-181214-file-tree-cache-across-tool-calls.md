# File-Tree Cache Across Tool Calls

**Date**: March 1, 2026

## Summary

Added transparent per-method caching of `list_files()` and `is_directory()` results to both `FilesystemBackend` (local mode) and `WorkspaceNormalizingBackend` (Daytona mode). The second and subsequent `glob`/`grep` tool calls within the same agent execution are now near-instant — serving from in-memory dict lookups instead of filesystem walks or network RPCs — with zero changes to the tool layer.

## Problem Statement

Every `glob` and `grep` call recursively traverses the entire workspace directory tree by calling `list_files()` for each directory and `is_directory()` for each entry. A typical agent execution issues 3–8 search calls, each re-walking the same tree. For a project with 50 directories and 500 files, each traversal costs 50 `iterdir()` syscalls and 500 `stat()` syscalls.

### Pain Points

- Repeated full filesystem traversal on every `glob`/`grep` call within a single execution
- `stat()` calls for `is_directory()` dominate traversal time — caching only `list_files()` would miss the bottleneck
- Daytona mode compounds the cost: each `list_files()` and `is_directory()` call is a network RPC to the sandbox

## Solution

Transparent per-method caching at the backend level. Both `list_files()` and `is_directory()` cache their results in per-instance dictionaries. Mutations (`write`, `write_file`, `execute`) invalidate the entire cache before operating. The tool layer (`tool_wrappers.py`) requires no changes — caching is invisible to callers.

## Implementation Details

**FilesystemBackend** (local mode):
- `_dir_cache: dict[str, list[str]]` — maps resolved directory path to entry names
- `_path_type_cache: dict[str, bool]` — maps resolved path to is-directory boolean
- `list_files()` pre-populates `_path_type_cache` during iteration (the `is_dir()` call needed by `_should_include()` is captured for free), so even the first `glob`/`grep` call benefits from `is_directory()` cache hits
- Returns list copies to prevent callers from corrupting the cache

**WorkspaceNormalizingBackend** (Daytona mode):
- Same dual-cache pattern, keyed by normalized path (after `_normalize()`)
- No pre-population (inner backend returns names only — types unknown)
- Gitignore filtering applied before caching, so cached results are already filtered

**Invalidation**:
- `_invalidate_cache()` clears both dicts with debug logging
- Called before `write_file()`, `execute()` (FilesystemBackend)
- Called before `write()`, `write_file()`, `execute()` (WorkspaceNormalizingBackend)
- Full invalidation — correct and simple; partial invalidation deferred

**20 new tests** across both backends covering:
- Cache hits, copy semantics, stale-on-bypass proof
- Pre-population verification, path-representation equivalence
- Invalidation on write/write_file/execute
- Platform mount (.stigmer) and gitignore interaction
- Rebase wrapper normalisation (Daytona volume mounts)

## Benefits

- Second `glob`/`grep` call in same execution: ~0ms (dict lookup) vs ~50–200ms (filesystem walk)
- Typical 5-call execution saves 4 full tree traversals (~200–800ms locally, more on Daytona)
- Zero coupling — tool_wrappers.py unchanged, backend interface unchanged
- Pre-population captures `is_dir()` results that `list_files()` already computes, eliminating redundant stat calls

## Impact

- **Agent execution latency**: Reduced by the cost of N-1 redundant tree traversals per execution (N = number of glob/grep calls)
- **Daytona mode**: Proportionally larger savings due to RPC overhead per call
- **Code surface**: 4 files changed, +392/-20 lines. No new dependencies. No interface changes.

## Related Work

- T01: Workspace Tree Snapshot at Startup (provides initial structural awareness)
- T02: .gitignore-Aware File Filtering (filtering integrated into cached results)
- T04/T05: Extended skip-dirs and context-efficiency prompt guidance

---

**Status**: ✅ Production Ready
**Timeline**: Session 3 of smart-workspace-context project
