# Task T01: Smart Workspace Context Pipeline

**Created**: 2026-03-01
**Status**: Planning — PENDING REVIEW

## Problem Statement

Stigmer's workspace interaction is entirely **reactive and agent-driven** with no intelligent context retrieval layer. The agent starts blind — it knows only the git URL and branch — and must manually explore the workspace using `ls`, `glob`, and `grep` before it can do any real work. Every execution pays this exploration tax.

Compare this to Cursor, which:
- Maintains a file tree index and semantic embedding index
- Selectively retrieves relevant code chunks based on the query
- Respects `.gitignore` for search and indexing
- Tracks context window budget and prioritizes compact, relevant context

This project closes 7 architectural gaps, organized into 7 tasks by priority.

---

## Task Breakdown

### T01: Workspace Tree Snapshot at Startup (P0 — Highest Impact)

**Goal**: Inject a compact file-tree manifest into the `## Workspace` system prompt section so the agent starts with full structural awareness.

**Files to modify**:
- `backend/services/agent-runner/worker/workspace/provisioner.py` — add `file_tree` field to `ProvisionResult`
- `backend/services/agent-runner/worker/workspace/sources/git.py` — generate tree after clone
- `backend/services/agent-runner/worker/workspace/sources/local_path.py` — generate tree from local path
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — inject tree into `build_workspace_prompt_section()`

**Approach**:
1. After provisioning completes (clone or local path validation), walk the workspace directory tree to produce a compact manifest: paths only, no file content. Reuse the existing `_TREE_SKIP_DIRS` / hidden-entry filtering.
2. Cap at a configurable limit (e.g., 500 entries) with truncation notice.
3. Add the tree to `ProvisionResult` (new field: `file_tree: str`).
4. Append the tree to `workspace_description` so it appears in `## Workspace`.
5. For the `_build_description()` in `git.py`, change "Start by listing the root directory" to "The file tree below shows the project structure. Use `read` to access files, `grep` to search content."

**Expected impact**: Eliminates 2–5 exploration tool calls per execution (~10–20K tokens saved per run). Agent can immediately target relevant files.

**Risks**: Very large repos (100K+ files). Mitigated by entry cap and depth limit.

---

### T02: .gitignore-Aware File Filtering (P1)

**Goal**: Make `list_files()`, `glob`, and `grep` respect `.gitignore` patterns so traversals skip build artifacts, vendored dependencies, and other gitignored noise.

**Files to modify**:
- `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` — add `.gitignore` parsing and filtering to `list_files()`
- `backend/libs/python/graphton/src/graphton/core/backends/daytona.py` — delegate `.gitignore` awareness to inner backend or implement independently
- New dependency: `pathspec` library (standard Python package for `.gitignore` pattern matching)

**Approach**:
1. At `FilesystemBackend.__init__`, check for `.gitignore` at `root_dir`. If present, parse it with `pathspec` into a compiled matcher. Cache the matcher on the backend instance.
2. Also check for nested `.gitignore` files during traversal (git's cascading ignore model). Start with root-level only as v1; nested as a follow-up.
3. In `list_files()`, after the existing hidden/`_SKIP_DIR_NAMES` filter, apply the gitignore matcher.
4. The existing `_format_directory_listing()` inherits the same filter since it uses raw `iterdir()` — align it with `list_files()` filtering.
5. For non-git workspaces (empty scratch dir), skip gitignore filtering gracefully.

**Expected impact**: `glob("*.py")` on a Python project with `venv/` stops traversing 10K+ virtualenv files. `grep` stops reading compiled assets in `dist/`.

**Risks**: `.gitignore` has complex semantics (negation patterns, re-inclusion). `pathspec` handles the standard cases well. Edge cases with nested `.gitignore` files can be deferred.

---

### T03: File-Tree Cache Across Tool Calls (P1)

**Goal**: Cache the workspace file-tree in memory so consecutive `glob`/`grep` calls within the same execution don't re-walk the entire directory tree.

**Files to modify**:
- `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` — add a `_file_tree_cache` with invalidation
- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — `glob` and `grep` use cached tree when available

**Approach**:
1. Add a `_cached_tree: dict[str, list[str]] | None` on `FilesystemBackend`. This maps `dir_path -> [entry_names]`.
2. `list_files()` populates the cache on first call for each directory.
3. `write_file()`, `write()`, and the `execute` tool invalidate the cache (full invalidation is safest; partial invalidation by affected path is a future optimization).
4. `glob` and `grep` tool wrappers check if a full tree is already cached and use it for traversal.
5. Cache lifetime is per-execution (the backend instance is created per execution).

**Expected impact**: Second and subsequent `glob`/`grep` calls are near-instant (dict lookup vs. filesystem walk). Typical execution has 3–8 search calls.

**Risks**: Stale cache after `execute` runs a command that creates/deletes files. Mitigated by invalidating on `execute`.

---

### T04: Extend Skip-Directory Set (P2 — Low Effort)

**Goal**: Add commonly large non-hidden directories to the skip set so they are never traversed by agent tools.

**Files to modify**:
- `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` — extend `_SKIP_DIR_NAMES`
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — extend `_TREE_SKIP_DIRS`

**Directories to add**:
```
venv, .venv (Python virtualenvs — .venv already caught by hidden filter)
dist, build (build outputs)
target (Rust/Java/Scala build output)
vendor (Go/PHP vendored deps)
coverage, .coverage (test coverage — .coverage caught by hidden filter)
.tox, .mypy_cache, .pytest_cache (already caught by hidden filter)
.next, .nuxt (already caught by hidden filter)
bower_components (legacy JS)
```

Net additions to `_SKIP_DIR_NAMES` (non-hidden only): `venv`, `dist`, `build`, `target`, `vendor`, `coverage`, `bower_components`.

**Expected impact**: Prevents accidental traversal of large directories that are not caught by the hidden-entry filter. Low risk, high value per line of code changed.

---

### T05: Context-Efficiency Prompt Guidance (P2 — Low Effort)

**Goal**: Add prompt guidance that teaches the agent to use workspace context efficiently — prefer `grep` before `read` for large files, avoid reading entire directories, respect context budget.

**Files to modify**:
- `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py` — add context-efficiency section to `FILESYSTEM_CAPABILITY`
- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — optionally add line-range support to `read` tool

**Prompt additions** (to `FILESYSTEM_CAPABILITY`):
```
**Context Efficiency**: Be strategic about what you read:
- Use `grep` to locate relevant sections before reading entire files
- Use `glob` to find specific files rather than listing directories manually
- For large files, read only the sections you need (use grep to find line numbers first)
- Prefer targeted reads over broad exploration — every file you read consumes context
- When the workspace tree is provided, use it to navigate directly to relevant paths
```

**Optional**: Add `offset` and `limit` parameters to the `read` tool so the agent can request specific line ranges of large files (similar to Cursor's `Read` tool with `offset`/`limit`).

**Expected impact**: Reduces context waste from agents reading entire large files when they only need a section. The prompt change is zero-effort; line-range support is medium effort.

---

### T06: Task-Aware Relevance Signaling (P2)

**Goal**: Parse the user's message for file paths, class names, function names, and module names, then do a quick search to locate them in the workspace. Inject results as a `## Potentially Relevant Files` prompt section.

**Files to modify**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — add `build_relevance_section()` function
- New utility module (or extend existing): message parsing and quick search

**Approach**:
1. After workspace provisioning and before agent creation, scan the user's message for:
   - Explicit file paths (patterns like `src/auth/login.go`, `*.py`)
   - Code identifiers (CamelCase words, snake_case words that look like function/class names)
   - Module/package names
2. For each candidate, run a lightweight search:
   - File paths → check if they exist in the workspace (using the cached tree from T03 or T01)
   - Identifiers → quick `grep` for definition patterns (`class X`, `def x`, `func x`, `function x`)
3. Inject results as `## Potentially Relevant Files` section in the system prompt, listing matched paths with a one-line context snippet.
4. Cap at 10–15 results to avoid prompt bloat.
5. This is best-effort — false positives are acceptable (the agent decides what to actually read).

**Expected impact**: The agent starts with targeted relevance signals instead of having to discover everything from scratch. Particularly valuable for code review and refactoring tasks where the user mentions specific files or functions.

**Risks**: Parsing heuristics may produce false positives. Mitigated by capping results and framing as "potentially relevant" (not authoritative).

---

### T07: Semantic Search / Structural Indexing (P3 — Highest Effort)

**Goal**: Add a `search` tool that finds code by meaning, not just by exact text match. Enable the agent to ask "where is the authentication middleware?" and get relevant results.

**Files to modify**:
- New module: `backend/libs/python/graphton/src/graphton/core/workspace_index.py`
- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — add `search` tool
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — index workspace after provisioning

**Approach** (phased):

**Phase A — Structural indexing (code-aware search)**:
1. After provisioning, parse source files to extract structural elements: class names, function names, method signatures, import statements.
2. Store as an in-memory index: `{identifier: [(file_path, line_number, signature)]}`.
3. Expose as a `search` tool that accepts a natural-language query and returns ranked results by identifier similarity (fuzzy matching on names + TF-IDF on docstrings/comments).
4. This is a lightweight, zero-dependency approach that provides 80% of the value.

**Phase B — Embedding-based semantic search** (future, if Phase A is insufficient):
1. Chunk source files into semantic units (functions, classes, blocks).
2. Generate embeddings using an embedding model (local or API).
3. Store embeddings in an in-memory vector index (e.g., FAISS or simple cosine similarity).
4. The `search` tool embeds the query and retrieves top-K similar chunks.
5. This requires an embedding model dependency — evaluate cost/latency tradeoffs.

**Expected impact**: Agent can locate relevant code by concept rather than exact string match. Critical for large, unfamiliar codebases where the agent doesn't know file names.

**Risks**: Indexing time for large repos. Phase A (structural) is fast (<1s for most repos). Phase B (embeddings) could take 10–30s depending on model and repo size. Both can be done asynchronously during provisioning.

---

## Implementation Order

```
T04 (extend skip dirs)         ─── low effort, immediate value
  │
T05 (context-efficiency prompt) ─── low effort, immediate value
  │
T01 (workspace tree snapshot)   ─── P0, highest single-item impact
  │
T02 (.gitignore awareness)      ─── P1, requires pathspec dep
  │
T03 (file-tree cache)           ─── P1, depends on list_files being clean (T02/T04)
  │
T06 (relevance signaling)       ─── P2, depends on tree/cache (T01/T03)
  │
T07 (semantic search)           ─── P3, can start Phase A in parallel with T06
```

The recommended order front-loads the quick wins (T04, T05) to establish momentum, then tackles the high-impact items (T01, T02, T03), and finishes with the intelligence layer (T06, T07).

---

## Success Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | Agent receives file-tree manifest without making `ls` calls | Inspect system prompt in execution logs |
| 2 | `glob`/`grep` skip gitignored directories | Unit test + manual test on repo with `venv/` |
| 3 | Second `glob` call in same execution uses cache | Timing comparison + cache hit logging |
| 4 | `vendor`, `dist`, `build`, `target` are never traversed | Unit test for `_SKIP_DIR_NAMES` |
| 5 | Prompt includes context-efficiency guidance | Inspect enhanced prompt output |
| 6 | User message mentioning "login.go" results in `## Potentially Relevant Files` | Integration test |
| 7 | `search("authentication middleware")` returns relevant files | Integration test with sample repo |

---

## Files Touched (Full Map)

| File | Tasks |
|------|-------|
| `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` | T02, T03, T04 |
| `backend/libs/python/graphton/src/graphton/core/backends/daytona.py` | T02, T03 |
| `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` | T03, T05, T07 |
| `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py` | T05 |
| `backend/services/agent-runner/worker/workspace/provisioner.py` | T01 |
| `backend/services/agent-runner/worker/workspace/sources/git.py` | T01 |
| `backend/services/agent-runner/worker/workspace/sources/local_path.py` | T01 |
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | T01, T04, T06 |
| `backend/libs/python/graphton/src/graphton/core/workspace_index.py` (new) | T07 |
| `backend/libs/python/graphton/tests/` | T01–T07 |

---

## Notes

- T01 and the existing `_build_directory_tree()` in `execute_graphton.py` solve similar problems. T01 should reuse or generalize that function rather than duplicating it.
- T02 adds a new dependency (`pathspec`). This needs to be added to `pyproject.toml` for the graphton library.
- T03's cache must be invalidated conservatively — `execute` can do anything, so full cache invalidation on any `execute` call is the safe default.
- T07 Phase B (embeddings) is exploratory. Phase A (structural indexing) should be evaluated first — it may provide sufficient value without the complexity of an embedding pipeline.
