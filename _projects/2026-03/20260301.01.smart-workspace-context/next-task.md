# Next Task: 20260301.01.smart-workspace-context

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260301.01.smart-workspace-context

**Description**: Implement intelligent workspace context retrieval for Stigmer's agent platform — replacing the current reactive, brute-force file discovery with proactive context delivery including workspace tree snapshots, .gitignore-aware filtering, file-tree caching, extended skip-directories, context-efficiency prompt guidance, task-aware relevance signaling, and structural symbol search.
**Goal**: Close the architectural gaps between Stigmer's reactive workspace interaction and Cursor-style proactive context retrieval so that agents start with structural awareness, discover files efficiently, and use context budgets wisely.
**Tech Stack**: Python (Graphton library, agent-runner worker), Go (CLI if needed)
**Components**: backend/libs/python/graphton (filesystem backend, tool wrappers, prompt enhancement, workspace index), backend/services/agent-runner (workspace provisioner, execute_graphton, workspace sources), potentially client-apps/cli

## Current State

- **Status**: COMPLETED
- **Last Session**: 2026-03-01 (Session 6) — Completed T07 (final task)
- **Branch**: `feat/smart-workspace-context`

## Session Progress (2026-03-01, Session 6)

### Completed: T07 — Structural Symbol Search (Phase A)

- New module: `graphton/core/workspace_index.py` — SymbolKind enum (11 kinds), Symbol frozen dataclass, LanguageSpec with per-language regex patterns, WorkspaceIndex with token-aware fuzzy matching, build_workspace_index builder
- Supports 13 languages: Python, Go, JS/TS, Rust, Java, Ruby, C/C++, PHP, Kotlin, Scala, C#, Swift, Elixir
- New `search` platform tool in `tool_wrappers.py` — safe, read-only, lazy index build on first call, cached in closure
- Updated `FILESYSTEM_CAPABILITY` prompt to mention search vs grep distinction
- 112 new tests across 17 test classes (value objects, tokenizer, parsers, scoring, search, index builder, formatting)
- Fixed pre-existing tool count test failures in both graphton and agent-runner test suites
- All 985 agent-runner tests pass (3 pre-existing failures in TestZipFormatEndToEnd unchanged)

### Design Decisions Made (T07)

- **Lazy indexing**: Index built on first `search` call, not during provisioning. Avoids wasted latency.
- **No invalidation**: Index is immutable for execution lifetime. Agent knows what it wrote.
- **Module in graphton**: All platform tools live in graphton. Search tool and its index co-located.
- **Regex-based, zero dependencies**: No tree-sitter, no embedding model. Per-language regexes.
- **Token-aware fuzzy matching**: camelCase/snake_case splitting, exact > prefix > substring scoring.

### Previous Sessions

- **Session 5**: T06 — Task-Aware Relevance Signaling (Phase A)
- **Session 4**: T03 — File-Tree Cache Across Tool Calls
- **Session 3**: T02 — .gitignore-Aware File Filtering
- **Session 2**: T01 — Workspace Tree Snapshot at Startup
- **Session 1**: T04 + T05 — Extended skip-dirs, context-efficiency prompt guidance, read tool line-range support

## All Tasks Completed

| Task | Description | Session |
|------|-------------|---------|
| T04  | Extended skip-directory set | Session 1 |
| T05  | Context-efficiency prompt guidance | Session 1 |
| T01  | Workspace tree snapshot at startup | Session 2 |
| T02  | .gitignore-aware file filtering | Session 3 |
| T03  | File-tree cache across tool calls | Session 4 |
| T06  | Task-aware relevance signaling | Session 5 |
| T07  | Structural symbol search | Session 6 |

## Next Steps

The smart-workspace-context project is complete. Potential follow-ups (not planned):

1. **T07 Phase B** — Embedding-based semantic search (evaluate need based on production observation of Phase A)
2. **T06 Phase B** — Identifier extraction via grep (subsumed by T07 Phase A's structural index)
3. **Production observation** — Monitor agent tool usage patterns to validate whether agents use `search`, `grep`, and the workspace tree effectively

## Essential Files

### Key Source Files (T07)
- **Workspace index**: `backend/libs/python/graphton/src/graphton/core/workspace_index.py`
- **Search tool**: `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` (`_create_search_tool`)
- **Prompt enhancement**: `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py`

### Key Source Files (prior tasks)
- **Tree builder**: `backend/services/agent-runner/worker/workspace/tree.py`
- **Relevance module**: `backend/services/agent-runner/worker/activities/relevance.py`
- **FilesystemBackend**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`
- **Prompt builder**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

### Tests
- `backend/libs/python/graphton/tests/core/test_workspace_index.py` (112 tests)
- `backend/libs/python/graphton/tests/core/test_tool_wrappers.py`
- `backend/services/agent-runner/tests/test_integration_skill_pipeline.py`

### Checkpoints
- `_projects/2026-03/20260301.01.smart-workspace-context/checkpoints/`

---

*This file provides direct paths to all project resources for quick context loading.*
