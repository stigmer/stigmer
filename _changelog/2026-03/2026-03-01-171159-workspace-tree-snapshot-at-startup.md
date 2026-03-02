# Workspace Tree Snapshot at Startup

**Date**: March 1, 2026

## Summary

Agents now receive a compact file-tree manifest in the `## Workspace` system prompt at the start of every execution, giving them immediate structural awareness of the project. This eliminates the 2–5 exploratory tool calls agents previously needed just to understand what files exist, saving ~10–20K tokens per run and enabling agents to target relevant files from their very first action.

## Problem Statement

Stigmer's workspace interaction was entirely reactive and agent-driven. The agent started blind — it knew only the git URL and branch — and had to manually explore the workspace using `ls`, `glob`, and `grep` before it could do any real work. Every execution paid this exploration tax, wasting both tool calls and context budget.

### Pain Points

- Agents wasted 2–5 tool calls per execution on initial exploration
- ~10–20K tokens consumed by discovery before productive work began
- The platform *knew* the workspace structure after provisioning but withheld it
- Compared to Cursor (which maintains file tree indexes), agents started with zero structural awareness

## Solution

Enrich the provisioning pipeline to generate a file-tree manifest after workspace setup, and inject it into the `## Workspace` system prompt section. Two tree-walking strategies — local `os.*` calls and remote `backend.execute("find ...")` — provide universal coverage across local development and Daytona cloud sandboxes.

## Implementation Details

### New Module: `worker/workspace/tree.py`

Extracted and extended the existing `_build_directory_tree()` function from `execute_graphton.py` into a dedicated shared module with:

- **Local walker** (`build_directory_tree`): Uses `os.listdir`/`os.path.isdir` for fast, rich metadata (file sizes). Works on locally accessible workspaces.
- **Remote walker** (`_build_directory_tree_via_find`): Uses `backend.execute()` with GNU `find -printf` to walk the tree inside Daytona sandboxes. Parses tab-delimited output and sorts into DFS dirs-first order matching the local walker.
- **Public API** (`build_workspace_file_tree`): Dispatches to the right walker based on `is_local_mode`, applies configurable depth (4) and entry (500) limits, and formats the result into a prompt-ready `### Project Structure` section with truncation notices.

### Provisioner Enrichment

Added `file_tree: str | None = None` to `ProvisionResult` and a new `_enrich_with_file_tree()` method to `WorkspaceProvisioner`. Tree generation happens centrally after `_dispatch()` returns — source handlers (`git.py`, `local_path.py`, `empty.py`) remain unchanged. Empty workspaces skip tree generation. Failures are logged but never block provisioning.

Also refactored the existing `consumed_keys` rebuild from explicit field-by-field construction to `dataclasses.replace()`, preventing a class of bugs where adding new fields to `ProvisionResult` silently gets dropped during reconstruction.

### Prompt Assembly

Updated `build_workspace_prompt_section()` to append the file tree after the workspace description when present. The tree is already fully formatted, so the prompt builder just concatenates.

## Benefits

- **Immediate structural awareness**: Agents can target relevant files from their first action instead of exploring
- **Token savings**: Eliminates ~10–20K tokens of discovery overhead per execution
- **Tool call savings**: Removes 2–5 exploratory `ls`/`glob` calls at the start of every run
- **Universal coverage**: Works for both local development (os.* calls) and Daytona cloud sandboxes (find command)
- **Clean extraction**: Tree-building utilities are now in a shared module, benefiting both workspace tree and referenced files features

## Impact

- **Agent executions**: All git and local-path workspace executions now receive the tree
- **Files changed**: 4 modified, 2 new (production), 3 test files
- **Test coverage**: 57 new tests (48 tree module + 4 prompt section + 5 provisioner)
- **Full suite**: 929 passed, 0 regressions

## Related Work

- T04 (Extended Skip-Directory Set) and T05 (Context-Efficiency Prompt Guidance) completed in prior session
- T02 (.gitignore-Aware File Filtering) is next — will make the tree even more useful by filtering out gitignored paths
- T03 (File-Tree Cache Across Tool Calls) will cache the tree for repeated glob/grep operations

---

**Status**: Production Ready
**Project**: 20260301.01.smart-workspace-context (T01)
