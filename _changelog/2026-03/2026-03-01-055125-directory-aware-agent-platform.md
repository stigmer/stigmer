# Directory-Aware Agent Platform

**Date**: March 1, 2026

## Summary

Replaced fragile prompt-level directory hints with two platform-level fixes that make directories first-class citizens in the agent runtime. The `read` tool now returns a structured listing when called on a directory instead of raising `IsADirectoryError`, and the Referenced Files prompt section now expands directory references into full file-tree manifests with sizes, eliminating all blind-exploration turns.

## Problem Statement

Running `stigmer draft skill` with directory attachments (e.g. `--attach apis/ai/stigmer/agentic/agent`) inside a local workspace produced agents that wasted LLM turns navigating directories. The previous fix tagged top-level directories with `(directory)` in the prompt and changed the instruction text to "use `read` for files and `ls` for directories" -- a prompt-engineering workaround that relied on the LLM correctly interpreting a natural-language hint.

### Pain Points

- The `read` tool raised `IsADirectoryError` when called on any directory. The error was caught by the wrapper and returned as a string, but the agent still wasted a full turn parsing the error, switching tools, and retrying. For nested directories (e.g. `docs/` inside `apis/ai/stigmer/agentic/agent/`), this repeated at every level.
- The Referenced Files prompt section provided zero structural information about directories -- just a flat `- path/ (directory)` tag. The agent had no idea what files existed inside, how deep the tree was, or what to read first. It had to `ls` at every level to discover the structure.
- The prompt-level "use `read` for files and `ls` for directories" instruction was fragile, did not scale to nested structures, and was fundamentally the wrong architectural layer for this concern.

## Solution

Two targeted platform-level changes, neither of which relies on the LLM interpreting hints.

## Implementation Details

**Fix 1 -- Graceful `read` on directories (`filesystem.py`)**

`FilesystemBackend.read_file()` no longer raises `IsADirectoryError`. When called on a directory, it delegates to a new `_format_directory_listing()` helper that returns a structured listing:
- Directories sorted before files (natural exploration order)
- File sizes in human-readable format, directory item counts
- Hidden entries (`.git`, `__pycache__`, `node_modules`, `.stigmer`) omitted
- Output capped at 100 entries with a truncation notice

Added `_human_readable_size()` module-level utility for compact byte formatting (bytes / KB / MB).

**Fix 2 -- Directory tree expansion in prompt section (`execute_graphton.py`)**

`build_referenced_files_prompt_section()` now recursively expands directory workspace-file-refs into a full file-tree manifest via a new `_build_directory_tree()` helper:
- Walks the directory tree up to depth 3
- Caps at 200 entries with truncation notice
- Skips hidden and noise directories
- Shows file sizes in human-readable format
- Produces indented markdown listing for each entry

The section header was simplified from "Use `read` for files and `ls` for directories" to "Use `read` to access file contents" since directories are now handled gracefully at every layer.

## Benefits

- Zero wasted turns on directory references. The agent gets a complete file-tree map in the prompt and can navigate directly to the files it needs.
- The `read` tool on a directory returns useful structural information instead of an error, eliminating the entire class of `IsADirectoryError` recovery cycles.
- Nested directory discovery (the original `docs/` bug) is fully solved at both the prompt and tool layers.
- No proto, CLI, or API changes required -- both fixes are purely in the backend runtime.

## Impact

- **Seedpack generation scripts**: `02_draft-agent-creator-skill.sh` and similar scripts that attach directories will produce agents that navigate the workspace efficiently from the first turn.
- **All agents with workspace references**: Any agent execution that includes directory paths in `workspace_file_refs` benefits from the expanded tree manifest.
- **Agent tool resilience**: The `read` tool is now safe to call on any path type. Agents (and sub-agents) that accidentally `read` a directory get useful output instead of wasting a turn.

## Related Work

- Predecessor: `_changelog/2026-03/2026-03-01-052020-fix-agent-context-fidelity-and-subagent-tools.md` (prompt-level directory hints and sub-agent platform tools)
- Filesystem backend: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`
- Prompt builder: `backend/services/agent-runner/worker/activities/execute_graphton.py`

---

**Status**: Production Ready
