# Task-Aware Relevance Signaling (Phase A)

**Date**: March 1, 2026

## Summary

Added a relevance signaling module that extracts file path references from the user's message, verifies them against the workspace, and injects a `## Potentially Relevant Files` section into the agent's system prompt. This gives agents targeted file awareness before their first tool call, complementing the structural awareness provided by the workspace tree (T01).

## Problem Statement

Even with the workspace tree snapshot (T01), the agent has no signal about *which* files in the tree are relevant to the user's current request. The user often mentions specific files (`src/auth/login.go`, `README.md`) or directories in their message, but the agent must still scan the tree or issue exploratory tool calls to locate them.

### Pain Points

- Agent spends tool calls confirming that user-mentioned files exist
- Mentioned paths may be truncated out of the tree (repos >500 entries)
- No targeted "start here" signal for file-specific tasks like code review or refactoring

## Solution

A lightweight, pre-agent extraction pipeline that:
1. Tokenizes the user message and identifies file-path candidates (paths with `/`, recognized extensions, known filenames like `Dockerfile`)
2. Resolves each candidate against the workspace filesystem via `os.path.exists`
3. Formats confirmed paths into a prompt section with file sizes and directory labels

The design is intentionally conservative — false positives are silently dropped, and the extraction uses simple token heuristics rather than complex regex or NLP.

## Implementation Details

**New module**: `worker/activities/relevance.py`

Three composable functions with clean separation:
- `extract_file_path_candidates(message)` — pure text extraction; identifies tokens with path separators, source-code extensions (`.py`, `.go`, `.ts`, etc.), or known filenames (`Dockerfile`, `Makefile`); excludes URLs, emails, `@`-prefixed tokens; deduplicates preserving order
- `resolve_workspace_paths(candidates, workspace_root)` — filesystem checks via `os.path.exists`/`os.path.isdir`/`os.path.getsize`; returns frozen `ResolvedPath` value objects
- `build_relevance_prompt_section(user_message, workspace_root)` — public orchestrator; extract -> resolve -> format; caps output at 15 results

**Value object**: `ResolvedPath` (frozen dataclass) — `path`, `is_directory`, `size_bytes`

**Integration**: 1 import + 5 lines in `execute_graphton.py`, placed after the workspace section and before skills, following the identical pattern used by `build_workspace_prompt_section()` and `build_referenced_files_prompt_section()`.

**Tests**: 49 unit tests covering extraction (slash paths, extensions, backticks, quotes, URL/email exclusion, deduplication, edge cases), resolution (files, directories, mixed valid/invalid, empty), value object behavior, and end-to-end integration (header format, sizes, cap enforcement, omission notice).

## Benefits

- Agent can immediately target user-mentioned files without exploratory tool calls
- Saves 1-3 tool calls per file-specific execution (~5-15K tokens)
- Zero latency cost — uses `os.path.exists` (no filesystem walking or grep)
- Graceful degradation — returns empty string when nothing resolves
- Complements rather than duplicates the workspace tree (targeted vs structural)

## Impact

- **Agent Runner**: System prompt now includes relevance signals when users mention workspace files
- **End Users**: Agents respond faster and more accurately to file-specific requests
- **Codebase**: New self-contained module with no changes to graphton library

## Related Work

- T01: Workspace Tree Snapshot at Startup (structural awareness — this adds targeted awareness)
- T02: .gitignore-Aware File Filtering
- T03: File-Tree Cache Across Tool Calls
- T04/T05: Extended skip-dirs and context-efficiency prompt guidance
- Phase B (future): Identifier extraction + definition grep for class/function names

---

**Status**: Production Ready
**Project**: 20260301.01.smart-workspace-context (T06)
