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
- **Last Session**: 2026-03-01 — Completed T04 + T05
- **Active Task**: T01 (Workspace Tree Snapshot at Startup) — next up
- **Branch**: `feat/smart-workspace-context`

## Session Progress (2026-03-01)

### Completed: T04 — Extend Skip-Directory Set
- Extended `_SKIP_DIR_NAMES` (filesystem.py) and `_TREE_SKIP_DIRS` (execute_graphton.py) with 6 new directories: `venv`, `dist`, `target`, `vendor`, `coverage`, `bower_components`
- Excluded `build` from the list — it's a legitimate source directory in Go projects
- Added cross-reference comments between the two constants (different packages)
- Updated `list_files()` docstring to reference the constant name
- Added 8 new tests (including parametrized test for 4 dirs)

### Completed: T05 — Context-Efficiency Prompt Guidance
- Added `**Context Efficiency**` section to `FILESYSTEM_CAPABILITY` prompt
- Implemented `offset`/`limit` parameters on the `read` tool for line-range reads
- Created `_apply_line_range()` helper (tool-wrapper layer, no backend changes)
- Position header `[Lines X-Y of N total]` prepended when slicing
- Added 11 new tests (9 for `_apply_line_range`, 2 for read tool integration)

### Design Decisions Made
- **T04 is a safety net, not the solution**: The hardcoded skip list is a fallback for non-git workspaces. T02 (.gitignore awareness) will be the real comprehensive solution.
- **`build` excluded from skip list**: Legitimate source directory in Go ecosystem (Dockerfiles, CI scripts, build tooling).
- **Line-range filtering in tool-wrapper layer**: Keeps `FilesystemBackend`/`DaytonaBackend` interface unchanged. The backend reads the full file; the wrapper slices.

## Next Steps

Per the implementation order in `tasks/T01_0_plan.md`:

1. **T01: Workspace Tree Snapshot at Startup** (P0 — Highest Impact)
   - Inject compact file-tree manifest into `## Workspace` system prompt
   - Files: `provisioner.py`, `git.py`, `local_path.py`, `execute_graphton.py`
   - Reuse/generalize existing `_build_directory_tree()`

2. **T02: .gitignore-Aware File Filtering** (P1)
   - Add `pathspec` dependency, parse `.gitignore` in `FilesystemBackend`
   - This will largely supersede the T04 hardcoded list for git repos

3. **T03: File-Tree Cache Across Tool Calls** (P1)
   - Cache the workspace file-tree in memory per execution

4. **T06: Task-Aware Relevance Signaling** (P2)
5. **T07: Semantic Search / Structural Indexing** (P3)

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
6. [ ] Continue with T01 (Workspace Tree Snapshot at Startup)

## Quick Commands

After loading context:
- "Continue with T01" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
