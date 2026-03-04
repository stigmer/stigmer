# Hierarchical .gitignore Filtering for Multi-Workspace Sessions

**Date**: March 4, 2026

## Summary

Added per-entry `.gitignore` discovery to `FilesystemBackend` so that multi-workspace sessions respect each workspace entry's `.gitignore` patterns. Previously, multi-workspace sessions had zero gitignore filtering because the backend only loaded `.gitignore` from the container root (which doesn't have one). Agents now see clean directory listings without `node_modules/`, build artifacts, or other ignored files cluttering their context.

## Problem Statement

When multiple `--workspace` entries are provisioned, git clones land in subdirectories of a container root (e.g., `./workspace/sessions/{id}/stigmer/`, `./workspace/sessions/{id}/stigmer-cloud/`). Each entry carries its own `.gitignore`, but `FilesystemBackend` only loaded `.gitignore` from `root_dir` — the container level, which has none.

### Pain Points

- Zero gitignore filtering in multi-workspace sessions — agents saw `node_modules/`, `dist/`, `__pycache__/`, etc.
- Wasted context budget on noise directories in tool listings and `read_file()` directory reads
- Confusing agent navigation through workspace entries full of build artifacts

## Solution

Auto-discover `.gitignore` files in immediate subdirectories of `root_dir` at construction time. Build a `dict[str, GitIgnoreFilter]` mapping subdirectory name to its compiled filter. In `_should_include()`, when a path's first component matches a known entry, apply that entry's filter in addition to the root filter.

## Implementation Details

**`filesystem.py`** — Two changes:

1. `_discover_entry_gitignores()`: Scans immediate children of `root_dir`, skipping hidden directories. For each child with a `.gitignore` file, compiles a `GitIgnoreFilter` and stores it keyed by subdirectory name.

2. `_should_include()`: Extended with a third filtering layer after the existing hidden/skip-dir and root-gitignore checks. Uses `rel_path.split("/", 1)` to extract the first path component. When `len(parts) == 2` and the first component is in `_entry_gitignores`, checks the remainder against the entry's filter. The `len(parts) == 2` guard ensures entry directories themselves are never filtered by their own `.gitignore`.

**`test_filesystem_backend.py`** — `TestMultiEntryGitignore` class with 11 test cases covering entry-level filtering, cross-entry isolation, root+entry combination, directory listing item counts, no-gitignore fallback, and single-workspace backward compatibility.

## Benefits

- Multi-workspace sessions now have correct gitignore filtering per entry
- Reduced noise in agent tool listings — cleaner context, fewer wasted tokens
- Matches real git semantics (nested `.gitignore` applies to subtree)
- Zero API change — constructor signature, `sandbox_factory.py`, and `execute_graphton.py` untouched
- Single-workspace sessions gain a net-positive correction (subdirectory `.gitignore` files now respected)

## Impact

- **Agents**: Cleaner workspace navigation in multi-workspace sessions
- **Context budget**: Less noise means more room for useful file content
- **Backward compatibility**: Single-workspace behavior unchanged; existing 102 filesystem backend tests pass without modification

## Related Work

- T01: Tool alias descriptions (same project, committed as `229e6f2d`)
- T02: Multi-root relevance signaling (same project, committed as `a7468869`)
- T04: Multi-workspace system prompt improvements (upcoming)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
