# Extend Skip Directories and Add Context-Efficiency Guidance

**Date**: March 1, 2026

## Summary

Extended the workspace skip-directory set with 6 commonly large generated/vendored directories and added context-efficiency prompt guidance paired with line-range support on the `read` tool. Together these reduce noise in agent file discovery and teach agents to use their context budget wisely.

## Problem Statement

Stigmer's agent platform filters known noise directories (`.git`, `__pycache__`, `node_modules`) during workspace traversal, but misses several common categories of generated output and vendored dependencies. Agents traversing workspaces with Python virtualenvs, Rust/Java build output, Go/PHP vendor directories, or legacy JS dependencies pay an exploration tax scanning thousands of irrelevant files.

Separately, agents have no guidance on context efficiency — they often read entire large files when they only need a section, wasting context window budget.

### Pain Points

- `glob("*.py")` on a Python project with `venv/` traverses 10K+ virtualenv files
- `grep` scans compiled assets in `dist/` and `target/`
- Agents read entire 500-line files when they need 10 lines
- No way to request a specific line range from the `read` tool

## Solution

Two complementary changes shipped together:

1. **Extended skip-directory set** — Added `venv`, `dist`, `target`, `vendor`, `coverage`, `bower_components` to both `_SKIP_DIR_NAMES` (graphton filesystem backend) and `_TREE_SKIP_DIRS` (agent-runner tree builder). Excluded `build` because it's a legitimate source directory in Go projects.

2. **Context-efficiency prompt + `read` line-range support** — Added a `**Context Efficiency**` section to the `FILESYSTEM_CAPABILITY` prompt teaching agents to use `grep` before `read`, use `glob` for discovery, and use the new `offset`/`limit` parameters on `read` for partial file reads.

## Implementation Details

### Skip directories (T04)

Both constants updated in lockstep with cross-reference comments documenting the coupling:
- `_SKIP_DIR_NAMES` in `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`
- `_TREE_SKIP_DIRS` in `backend/services/agent-runner/worker/activities/execute_graphton.py`

These remain separate (different packages — graphton is a reusable library) but semantically aligned.

### Context-efficiency prompt (T05-A)

Brief, actionable guidance appended to `FILESYSTEM_CAPABILITY` in `prompt_enhancement.py`:
- Use `grep` to locate relevant sections before reading entire files
- Use `glob` to find specific files rather than listing directories manually
- Use `offset`/`limit` on `read` for large files
- Prefer targeted reads over broad exploration

### `read` tool line-range support (T05-B)

New `_apply_line_range()` helper in `tool_wrappers.py`:
- `offset: int = 0` — 1-indexed starting line (0 = from beginning)
- `limit: int = 0` — max lines to return (0 = no limit)
- Prepends `[Lines X-Y of N total]` header when slicing
- Handles edge cases: offset beyond file, empty content, negative values
- Implemented in the tool-wrapper layer — no backend interface changes

## Benefits

- Eliminates traversal of commonly large directories (potentially 10K+ files avoided per workspace)
- Agents can now read specific line ranges instead of entire files
- Context-efficiency prompt reduces wasted context tokens
- Zero performance overhead — `frozenset` membership check is O(1)

## Impact

- **Agents**: Faster file discovery, better context budget usage
- **All workspace types**: Skip directories are a universal safety net
- **Backward compatible**: Default `offset=0, limit=0` returns the full file unchanged

## Related Work

- Part of the **smart-workspace-context** project (T04 + T05 of 7 tasks)
- T02 (.gitignore-aware filtering) will largely supersede the hardcoded skip list for git repos
- T01 (workspace tree snapshot) is the next high-impact task

---

**Status**: Production Ready
**Branch**: `feat/smart-workspace-context`
