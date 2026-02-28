# Workspace-Aware File Referencing

**Date**: February 28, 2026

## Summary

When users attach files that already exist inside their local workspace, the system now skips the redundant upload-and-inject flow and instead records workspace-relative paths as lightweight "file references." The agent reads attached workspace files from their real locations -- no copies, no wasted bandwidth, no semantic lies in the system prompt.

## Problem Statement

When a user runs `stigmer run agent reviewer --workspace . --attach ./src/config.yaml`, the file `src/config.yaml` is already inside the workspace. But the system would:

1. Upload it to R2 (wasteful -- file is already accessible)
2. Copy it to `.stigmer/inputs/config.yaml` (confusing duplicate)
3. Tell the agent the file is "NOT part of the project source tree" (a semantic lie)
4. Agent reads the copy instead of the real file

### Pain Points

- Redundant upload bandwidth and storage for files already in the workspace
- Confusing duplicate paths: same file at `src/config.yaml` AND `.stigmer/inputs/config.yaml`
- Semantic misdirection: agent told "not part of source tree" for a file that IS in the source tree
- Split identity: if the file is modified during execution, the copy diverges from the original

## Solution

Separated the `--attach` flag's two concerns -- **transport** (make file available) and **attention** (focus agent on it). For files inside the workspace, transport is already satisfied; only attention is needed.

The CLI detects containment automatically. When a file is inside the workspace, it's recorded as a workspace-relative path on the new `workspace_file_refs` proto field. The backend builds a `## Referenced Files` prompt section telling the agent to read directly from the workspace.

## Implementation Details

### Proto Layer
- Added `repeated string workspace_file_refs = 10` to `AgentExecutionSpec`
- Simple strings (workspace-relative paths), not a structured message -- the backend stats files from the workspace for size info

### CLI Layer (Go)
- `AttachmentResult` struct carries both `Attachments` (uploaded) and `WorkspaceFileRefs` (in-workspace)
- `workspaceRelativePath()` performs containment check using `filepath.EvalSymlinks` (symlink escape prevention) + `filepath.Rel` + `filepath.ToSlash` (cross-platform paths)
- `ProcessFiles(paths, workspaceRoot)` splits attached files based on workspace containment
- `localWorkspaceRoot()` extracts local path from `WorkspaceSource` (returns empty for git/nil)
- Updated `run.go`, `run_handlers.go`, `run_create.go` to thread `WorkspaceFileRefs` through to `AgentExecutionSpec`

### Backend Layer (Python)
- `build_referenced_files_prompt_section()` constructs the `## Referenced Files` system prompt section
- File sizes obtained via `os.path.getsize()` with graceful fallback for missing files
- Section placed after `## Workspace` and `## Available Skills`, before `## Input Files`

### Test Coverage
- 11 new Go test cases: 7 for containment detection (inside, outside, root, nested, dot-dot, escape, forward slashes) + 4 for workspace-aware ProcessFiles (no workspace, all inside, mixed, empty)
- 13 new Python test cases: 9 for prompt section builder (empty, header, path, multiple, size, missing, concatenation, instruction, mixed) + 4 for section ordering

## Benefits

- **Zero wasted bandwidth**: Files inside the workspace are never uploaded to R2
- **No confusing duplicates**: Agent reads from the real path, not a copy in `.stigmer/inputs/`
- **Truthful system prompt**: Agent told "these files are in your workspace" instead of "NOT part of the source tree"
- **Transparent UX**: Users don't need a new flag or to think about containment -- `--attach` just works
- **Mixed scenarios**: Inside-workspace and outside-workspace files work simultaneously in a single execution

## Impact

- **End users**: Faster execution startup (no upload for workspace files), cleaner agent behavior (reads real files)
- **Agent quality**: More accurate file references in agent responses (real paths, not `.stigmer/inputs/` copies)
- **Platform maintainers**: Clean domain separation between transport and attention concerns
- **Backward compatible**: Zero breaking changes; existing behavior unchanged when `workspace_file_refs` is empty

## Related Work

- Workspace CLI flags (`--workspace`, `--branch`, `--commit`) -- prerequisite for this feature
- Workspace provisioning backend (`WorkspaceProvisioner`) -- provides the workspace filesystem
- Platform file isolation (virtual platform mount) -- separates `.stigmer/` from workspace

---

**Status**: Production Ready
**Files Changed**: 16 (652 additions, 268 deletions)
