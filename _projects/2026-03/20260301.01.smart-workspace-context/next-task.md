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
- **Last Session**: 2026-03-01 — Completed T03
- **Active Task**: T06 (Task-Aware Relevance Signaling) — next up
- **Branch**: `feat/smart-workspace-context`

## Session Progress (2026-03-01, Session 4)

### Completed: T03 — File-Tree Cache Across Tool Calls

- Added transparent per-method caching of `list_files()` and `is_directory()` to both `FilesystemBackend` and `WorkspaceNormalizingBackend`
- Dual cache: `_dir_cache` for directory listings, `_path_type_cache` for is_directory results
- `list_files()` pre-populates path type cache during `iterdir()` for free — even the first glob/grep benefits
- Full invalidation before `write_file()` and `execute()` mutations
- Returns list copies to prevent cache corruption
- 20 new tests (11 FilesystemBackend + 9 WorkspaceNormalizingBackend)
- All 644 graphton + 936 agent-runner tests pass (pre-existing failures unchanged)
- Commit: `553fc6fe` on `feat/smart-workspace-context`
- Changelog: `_changelog/2026-03/2026-03-01-181214-file-tree-cache-across-tool-calls.md`

### Previous Sessions

- **Session 3**: T02 — .gitignore-Aware File Filtering (GitIgnoreFilter value object, pathspec integration, 45 tests)
- **Session 2**: T01 — Workspace Tree Snapshot at Startup (tree.py module, provisioner enrichment, 57 tests)
- **Session 1**: T04 + T05 — Extended skip-dirs, context-efficiency prompt guidance, read tool line-range support

### Design Decisions Made (T03)

- **Cache both `list_files()` AND `is_directory()`**: Original plan only cached `list_files()`. `is_directory()` stat calls dominate traversal cost — caching both gives full benefit.
- **No changes to `tool_wrappers.py`**: Transparent caching at the backend level. Zero coupling, tool layer benefits automatically.
- **Pre-populate path-type cache from `list_files()` iteration**: `is_dir()` call already happens in `_should_include()` — capturing it is free.
- **Invalidate before mutation**: If write/execute raises, filesystem state is unknown. Invalidating before ensures subsequent reads always get fresh data.
- **Cache key = resolved path (local) / normalized path (Daytona)**: Ensures path-representation equivalence (e.g., ".", "", "/" share one cache entry).

## Next Steps

Per the implementation order in `tasks/T01_0_plan.md`:

1. **T06: Task-Aware Relevance Signaling** (P2)
   - Parse user message for file paths, class names, function names, module names
   - Quick search to locate them in workspace (using cached tree from T03)
   - Inject results as `## Potentially Relevant Files` prompt section
   - Cap at 10–15 results

2. **T07: Semantic Search / Structural Indexing** (P3)

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

### 4. Key Source Files (T03)
- **FilesystemBackend**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`
- **WorkspaceNormalizingBackend**: `backend/libs/python/graphton/src/graphton/core/backends/daytona.py`
- **Tool wrappers**: `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` (unchanged — transparent caching)
- **Prompt builder**: `backend/services/agent-runner/worker/activities/execute_graphton.py` (T06 target)

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
6. [ ] Continue with T06 (Task-Aware Relevance Signaling)

## Quick Commands

After loading context:
- "Continue with T06" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
