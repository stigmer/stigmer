# Structural Symbol Search for Agent Platform

**Date**: March 1, 2026

## Summary

Added a `search` platform tool to the graphton agent library that builds a lazy, cached structural symbol index from workspace source files, enabling agents to find code definitions by concept rather than exact text. This completes the smart-workspace-context project (T01-T07), closing the gap between Stigmer's reactive workspace interaction and proactive, structure-aware context retrieval.

## Problem Statement

Agents working in unfamiliar codebases had no way to discover code by concept. If an agent needed to find "the authentication middleware," it had to either:
1. Guess file names and paths (`grep "auth"` across all files)
2. Read directory trees and manually scan for relevant-sounding files
3. Try multiple `grep` patterns until something useful emerged

This exploration tax was especially costly for large, polyglot codebases where definitions span dozens of files across multiple languages.

### Pain Points

- `grep` returns every occurrence of a text pattern, burying structural definitions in noise (e.g., searching "login" returns variable references, string literals, comments, and actual class/function definitions indiscriminately)
- No concept-aware search — agents couldn't ask "where is user registration handled?" and get ranked structural results
- Each execution rediscovered the same codebase structure from scratch

## Solution

A new `search` platform tool backed by a lazy, per-execution structural symbol index. The index parses source files using language-specific regex patterns, extracts structural definitions (classes, functions, methods, types, etc.), and provides token-aware fuzzy matching so agents can search by concept.

Key design choices:
- **Lazy construction** — index built on first `search` call, not during provisioning, avoiding wasted latency for executions that never search
- **Regex-based parsing** — zero new dependencies; each language gets 3-7 simple patterns
- **Token-aware fuzzy matching** — identifier tokenisation (camelCase/snake_case splitting) enables conceptual queries like `"auth middleware"` matching `AuthMiddleware`

## Implementation Details

### New Module: `workspace_index.py`

Location: `backend/libs/python/graphton/src/graphton/core/workspace_index.py`

Core types:
- `SymbolKind` enum — 11 kinds: CLASS, FUNCTION, METHOD, STRUCT, ENUM, INTERFACE, TYPE, TRAIT, MODULE, OBJECT, IMPL
- `Symbol` frozen dataclass — name, kind, file_path, line_number, signature, pre-computed lowercase tokens
- `LanguageSpec` — per-language regex patterns with named groups for `name` and `kind`
- `WorkspaceIndex` — holds symbol list, provides `search(query, max_results)` with ranked results
- `SearchResult` — symbol paired with its relevance score

Language support (13 languages):
- Python, Go, JavaScript/TypeScript, Rust, Java, Ruby, C/C++, PHP, Kotlin, Scala, C#, Swift, Elixir

Scoring algorithm:
- Query tokens matched against symbol tokens: exact (1.0) > prefix (0.7) > substring (0.4)
- Results ranked by aggregate score, then file path for stability
- Minimum threshold (0.3) filters noise

Safety constraints:
- Max 2000 files indexed (configurable)
- Max 100KB per file (skips generated/vendored)
- Max 200 symbols per file (prevents pathological files)
- Reuses T03's cached `list_files()` and `is_directory()` for traversal

### Search Tool: `_create_search_tool`

Location: `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py`

- Safe, read-only tool (no approval required)
- Lazy-builds `WorkspaceIndex` on first call, caches in closure
- Returns formatted results with kind, name, file:line, and full signature line

### Prompt Enhancement

Updated `FILESYSTEM_CAPABILITY` to mention `search` and guide agents on when to use it vs `grep`:
- `search` for finding definitions by concept
- `grep` for finding exact text patterns

## Benefits

- **Concept-to-code navigation** — agents can ask `search("database connection pool")` and get `class ConnectionPool` in `db/pool.py` without knowing file names
- **Reduced exploration overhead** — structural awareness eliminates multiple grep-and-read cycles
- **Polyglot support** — 13 languages from day one, extensible by adding `LanguageSpec` entries
- **Zero provisioning cost** — lazy build means no latency unless the agent actually searches
- **No new dependencies** — regex-based parsing, standard library only

## Impact

- **Agents**: Gain a new tool for structural code navigation alongside existing `grep`/`glob`
- **Platform**: Completes the smart-workspace-context initiative (7/7 tasks done)
- **Extensibility**: Adding a new language is a single `LanguageSpec` definition

## Related Work

- T01: Workspace tree snapshot at startup (structural awareness)
- T02: .gitignore-aware file filtering (clean traversal)
- T03: File-tree cache across tool calls (fast directory walking)
- T04: Extended skip-directory set (noise reduction)
- T05: Context-efficiency prompt guidance (smart tool usage)
- T06: Task-aware relevance signaling (file path extraction)
- T07: This changelog (structural symbol search)

---

**Status**: Production Ready
**Timeline**: 1 session (Session 6 of 20260301.01.smart-workspace-context)
