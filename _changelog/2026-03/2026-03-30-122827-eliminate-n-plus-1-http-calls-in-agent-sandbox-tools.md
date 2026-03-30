# Eliminate N+1 HTTP Calls in Agent Sandbox Tools

**Date**: March 30, 2026

## Summary

Rewrote the Graphton platform tools (`glob`, `grep`, `search`) and `DeepAgentsBackendAdapter` methods (`glob_info`, `grep_raw`, `ls_info`) to use single shell commands via `backend.execute()` instead of recursive Python walks that generated thousands of individual HTTP calls to the Daytona sandbox. This eliminates the root cause of agent stalls and 300-second timeouts observed when running the Infra Chart Composer skill against large monorepos.

## Problem Statement

When an agent ran against a large codebase (e.g., the Planton monorepo with 15,010 directories and 52,099 files), the `glob`, `grep`, and `search` tools implemented recursive Python-level filesystem walks over HTTP. Each `list_files()`, `read()`, and `is_directory()` call translated to an individual HTTP request to the Daytona sandbox API.

### Pain Points

- **glob**: ~67,000 HTTP calls for a full recursive walk, estimated at ~56 minutes
- **grep**: Similar call volume — `list_files` to enumerate, then `read` for every file
- **search** (`build_workspace_index`): Same pattern — walk + read every indexable file
- **`DeepAgentsBackendAdapter.glob_info()`**: Recursive walk via `list_files` + `is_directory` per entry
- **`DeepAgentsBackendAdapter.grep_raw()`**: Recursive walk + `read` per file
- **`DeepAgentsBackendAdapter.ls_info()`**: N `is_directory()` HTTP calls for a single directory listing
- Agent stall detection triggered after 300 seconds of no output, killing the agent run
- Production error: "Execution timed out: the agent produced no output for 300 seconds"

## Solution

Replace Python-level recursive I/O over HTTP with single `backend.execute()` calls that run native POSIX shell commands (`find`, `grep -E`, `sed`, `sort`, `head`) inside the sandbox. This reduces HTTP round-trips from O(N) — where N can be tens of thousands — to O(1).

Every modified function retains a Python fallback for backends that don't support `execute()`, gated by `callable(getattr(backend, "execute", None))`.

## Implementation Details

### Graphton Platform Tools (`tool_wrappers.py`)

- **`_create_glob_tool`**: Fast path runs `find <path> -maxdepth 15 -name '<pattern>' -not -path '*/.git/*' -type f | head -n 5000 | sort`. Post-filters with `fnmatch` when the pattern contains path components. Falls back to recursive `list_files` + `is_directory` walk.

- **`_create_grep_tool`**: Fast path runs `grep -rn -E '<pattern>' --include='<glob>' --exclude-dir=.git <path> | head -n 1000`. Uses `shlex.quote` for safe shell escaping. Falls back to recursive walk + per-file regex.

- **`_create_search_tool`**: Delegates to new `build_workspace_index_via_grep()` when execute is available, otherwise falls back to `build_workspace_index()`.

### Workspace Index (`workspace_index.py`)

- **`build_workspace_index_via_grep()`**: New function. Runs a single `grep -rn -E` with a broad keyword pattern (`def |class |function |const |export |import `) across indexable file extensions, then post-filters results through language-specific regexes from `LANGUAGE_SPECS`. Builds the symbol index from a single HTTP call instead of reading every file individually.

### DeepAgents Backend Adapter (`deepagents_adapter.py`)

- **`grep_raw()`**: Fast path runs `grep -rn -E` via execute, parses output into `{file, line, text}` dicts.

- **`glob_info()`**: Fast path runs two `find` commands (one for directories, one for files) piped through `sed` to prefix type indicators (`d ` / `f `), then sorts and combines. POSIX-compatible (no `-printf`).

- **`ls_info()`**: Fast path runs two `find -maxdepth 1` commands for a single directory, replacing the N `is_directory()` HTTP calls with 1 execute call. Returns `None` on failure to trigger the original fallback.

### Test Fixes (`test_tool_wrappers.py`)

- Added `backend.execute = None` to three `MagicMock` fixtures to prevent `MagicMock`'s default callable behavior from incorrectly triggering the execute fast path.

## New Test Coverage

### Unit Tests

- **`test_tool_execute_fast_path.py`** (21 tests): Covers fast and fallback paths for glob, grep, and search tools using `FilesystemBackend` (has execute) and `_NoExecuteBackend` (forces fallback).

- **`test_deepagents_adapter_fast_path.py`** (13 tests): Covers fast and fallback paths for `DeepAgentsBackendAdapter` methods.

### Integration Tests

- **`test_daytona_sandbox_tools.py`** (20 tests): End-to-end tests against a real `daytona-small` sandbox. Creates a sandbox, seeds sample files, runs all tool wrappers and adapter methods, then deletes the sandbox. Gated by `DAYTONA_API_KEY` — skipped when absent.

All 1,400+ existing tests continue to pass with no regressions.

## Benefits

- **Latency**: glob/grep/search operations drop from minutes to sub-second on large repos
- **Reliability**: Eliminates the 300-second stall timeout that was killing agent runs
- **HTTP efficiency**: O(1) network calls instead of O(N) where N = number of files/directories
- **Safety**: `shlex.quote` prevents shell injection; output is capped with `head -n`
- **Portability**: POSIX-compatible commands work on both Linux (Daytona sandbox) and macOS (local dev)
- **Robustness**: Every fast path has a Python fallback for backends without `execute()`

## Impact

- **Agent Runner**: All agents using glob, grep, or search tools benefit immediately — no agent code changes needed
- **Infra Chart Composer**: Can now analyze large monorepos like Planton without stalling
- **DeepAgents integration**: Adapter methods also use the fast path, so any code going through `SandboxBackendProtocol` benefits

## Related Work

- [Fix Event Loop Blocking in Agent Runner](2026-03-30-102416-fix-event-loop-blocking-in-agent-runner.md) — earlier fix for asyncio blocking in tool wrappers
- PR #101 (`feat/execute-graphton-hardening`) — related hardening work merged prior

---

**Status**: ✅ Production Ready
**Timeline**: Single session
