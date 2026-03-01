# Next Task: 20260301.01.smart-workspace-context

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260301.01.smart-workspace-context

**Description**: Implement intelligent workspace context retrieval for Stigmer's agent platform — replacing the current reactive, brute-force file discovery with proactive context delivery including workspace tree snapshots, .gitignore-aware filtering, file-tree caching, extended skip-directories, context-efficiency prompt guidance, task-aware relevance signaling, and semantic search indexing.
**Goal**: Close the architectural gaps between Stigmer's reactive workspace interaction and Cursor-style proactive context retrieval so that agents start with structural awareness, discover files efficiently, and use context budgets wisely.
**Tech Stack**: Python (Graphton library, agent-runner worker), Go (CLI if needed)
**Components**: backend/libs/python/graphton (filesystem backend, tool wrappers, prompt enhancement), backend/services/agent-runner (workspace provisioner, execute_graphton, workspace sources), potentially client-apps/cli

## Current State

- **Status**: In Progress
- **Last Session**: 2026-03-01 — Completed T01
- **Active Task**: T02 (.gitignore-Aware File Filtering) — next up
- **Branch**: `feat/smart-workspace-context`

## Session Progress (2026-03-01, Session 2)

### Completed: T01 — Workspace Tree Snapshot at Startup

- Created new `worker/workspace/tree.py` module with two tree-walking strategies:
  - **Local walker** (`build_directory_tree`): extracted from execute_graphton.py, uses `os.listdir`/`os.path.isdir` for fast, rich tree generation on locally accessible workspaces
  - **Remote walker** (`_build_directory_tree_via_find`): uses `backend.execute("find -printf ...")` with GNU find for Daytona sandbox workspaces, parses tab-delimited output into DFS dirs-first order matching the local walker
  - **Public API** (`build_workspace_file_tree`): dispatches to the right walker based on `is_local_mode`, formats result with `### Project Structure` header and truncation notice
- Added `file_tree: str | None = None` field to `ProvisionResult` (frozen dataclass)
- Added `_enrich_with_file_tree()` method to `WorkspaceProvisioner` — called after `_dispatch()`, generates tree and enriches result via `dataclasses.replace()`
- Refactored existing `consumed_keys` rebuild in provisioner from explicit field-by-field reconstruction to `dataclasses.replace()` (prevents field-dropping bugs when adding new fields)
- Updated `build_workspace_prompt_section()` to append `file_tree` when present
- Replaced 65 lines of local tree definitions in execute_graphton.py with 4-line import from `worker.workspace.tree` (backward-compatible aliases)
- 57 new tests across 3 files (48 tree module + 4 prompt section + 5 provisioner)
- All 929 tests pass (3 pre-existing failures in unrelated `TestZipFormatEndToEnd`)

### Previous Session: T04 + T05

- T04: Extended skip-directory sets with 6 new entries
- T05: Added context-efficiency prompt guidance and `offset`/`limit` line-range support on read tool

### Design Decisions Made

- **Tree generation in provisioner, not source handlers**: Centralized in `_enrich_with_file_tree()` after `_dispatch()` returns. Source handlers (`git.py`, `local_path.py`) remain untouched. This avoids backward import dependencies (sources → activities) and duplicated invocation logic.
- **Two walker strategies behind one API**: Local mode uses `os.*` calls (fast, rich). Remote/Daytona mode uses `backend.execute("find -printf ...")`. Both produce identical output format. The `is_local_mode` flag dispatches.
- **`file_tree` as formatted prompt-ready string**: Follows the same pattern as `workspace_description` — the provisioner generates it, the prompt builder just concatenates.
- **No modification of existing workspace descriptions**: The "Start by listing the root directory" instruction in git.py becomes redundant when tree is present, but we deliberately do NOT modify it via fragile string replacement. The tree section naturally supersedes it.
- **`dataclasses.replace()` for ProvisionResult mutations**: Prevents the class of bugs where adding a new field silently gets dropped during field-by-field reconstruction.

## Next Steps

Per the implementation order in `tasks/T01_0_plan.md`:

1. **T02: .gitignore-Aware File Filtering** (P1)
   - Add `pathspec` dependency, parse `.gitignore` in `FilesystemBackend`
   - This will largely supersede the T04 hardcoded list for git repos

2. **T03: File-Tree Cache Across Tool Calls** (P1)
   - Cache the workspace file-tree in memory per execution

3. **T06: Task-Aware Relevance Signaling** (P2)
4. **T07: Semantic Search / Structural Indexing** (P3)

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/README.md`

### 4. Key Source Files (T01)
- **Tree module**: `backend/services/agent-runner/worker/workspace/tree.py`
- **Provisioner**: `backend/services/agent-runner/worker/workspace/provisioner.py`
- **Prompt builder**: `backend/services/agent-runner/worker/activities/execute_graphton.py` (lines 612–634)

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260301.01.smart-workspace-context/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with T02 (.gitignore-Aware File Filtering)

## Quick Commands

After loading context:
- "Continue with T02" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
