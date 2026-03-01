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
- **Last Session**: 2026-03-01 — Completed T06
- **Active Task**: T07 (Semantic Search / Structural Indexing) — next up
- **Branch**: `feat/smart-workspace-context`

## Session Progress (2026-03-01, Session 5)

### Completed: T06 — Task-Aware Relevance Signaling (Phase A)

- New module: `worker/activities/relevance.py` — self-contained extraction + resolution + formatting pipeline
- Extracts file path candidates from user messages (paths with `/`, recognised extensions, known filenames like `Dockerfile`/`Makefile`)
- Resolves candidates against workspace via `os.path.exists` — zero latency, no filesystem walking
- Injects `## Potentially Relevant Files` prompt section with file sizes and directory labels
- Caps at 15 results, gracefully returns empty string when nothing resolves
- Value object: `ResolvedPath` (frozen dataclass — `path`, `is_directory`, `size_bytes`)
- Excludes URLs, emails, `@`-prefixed tokens; strips backticks/quotes/parentheses
- 49 new tests (extraction, resolution, value object, end-to-end, cap enforcement, prompt format)
- All 985 agent-runner tests pass (3 pre-existing failures in TestZipFormatEndToEnd unchanged)
- Commit: `5d02785a` on `feat/smart-workspace-context`
- Changelog: `_changelog/2026-03/2026-03-01-183804-task-aware-relevance-signaling.md`

### Design Decisions Made (T06)

- **Phase A only (file paths), defer Phase B (identifiers)**: Identifier extraction via grep adds latency and complexity with uncertain value — agents already have the file tree (T01) and grep tool. Ship Phase A, evaluate Phase B after production observation.
- **Separate module, not inline in execute_graphton.py**: `execute_graphton.py` is 3000+ lines. Following the precedent of `worker/workspace/tree.py`, a dedicated module keeps the codebase navigable.
- **Token-based heuristic, not regex**: Simpler, more maintainable, easier to reason about edge cases. Split on whitespace, strip punctuation, check for path separators or known extensions.
- **`os.path.exists` for resolution**: Same approach as existing `build_referenced_files_prompt_section`. The workspace root is always locally accessible (even for Daytona — local mount).
- **No file content snippets**: The agent reads files itself. Including snippets would add latency and consume prompt budget with potentially irrelevant content.

### Previous Sessions

- **Session 4**: T03 — File-Tree Cache Across Tool Calls (dual cache, pre-population, 20 tests)
- **Session 3**: T02 — .gitignore-Aware File Filtering (GitIgnoreFilter value object, pathspec integration, 45 tests)
- **Session 2**: T01 — Workspace Tree Snapshot at Startup (tree.py module, provisioner enrichment, 57 tests)
- **Session 1**: T04 + T05 — Extended skip-dirs, context-efficiency prompt guidance, read tool line-range support

## Next Steps

Per the implementation order in `tasks/T01_0_plan.md`:

1. **T07: Semantic Search / Structural Indexing** (P3 — Highest Effort)
   - Phase A: Parse source files for structural elements (class names, function names, signatures)
   - In-memory index: `{identifier: [(file_path, line_number, signature)]}`
   - Expose as a `search` tool with fuzzy matching
   - Phase B (future): Embedding-based semantic search

This is the final task in the project.

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

### 4. Key Source Files (T06)
- **Relevance module**: `backend/services/agent-runner/worker/activities/relevance.py`
- **Prompt builder**: `backend/services/agent-runner/worker/activities/execute_graphton.py` (integration point)
- **FilesystemBackend**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`
- **Tree builder**: `backend/services/agent-runner/worker/workspace/tree.py`

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
6. [ ] Continue with T07 (Semantic Search / Structural Indexing)

## Quick Commands

After loading context:
- "Continue with T07" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
