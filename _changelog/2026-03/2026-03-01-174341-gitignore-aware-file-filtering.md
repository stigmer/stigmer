# .gitignore-Aware File Filtering

**Date**: March 1, 2026

## Summary

Implemented `.gitignore`-aware filtering across all three surfaces — graphton tool backends (local + Daytona) and the agent-runner tree module. `list_files()`, `glob`, `grep`, and the startup file tree now respect `.gitignore` patterns, eliminating traversal of build artifacts, vendored dependencies, and other gitignored noise.

## Problem Statement

Agent tools (`glob`, `grep`, `list_files`) traversed the entire workspace without respecting `.gitignore`. A Python project with `venv/` would cause `glob("*.py")` to scan 10K+ virtualenv files. The system prompt file tree showed gitignored directories that tools would never reach, creating confusion. Daytona sandbox mode had no filtering at all beyond what the inner backend provided.

### Pain Points

- `glob` and `grep` descended into `node_modules/`, `venv/`, `dist/`, and other large gitignored directories
- Directory listings and `read` on directories included gitignored entries
- System prompt tree diverged from tool-visible paths
- Daytona path lacked any `.gitignore` awareness

## Solution

Extracted `.gitignore` parsing into a `GitIgnoreFilter` value object (immutable, independently testable, composable). Three consumers initialize it differently based on lifecycle:

- **FilesystemBackend** (local): eager init at construction
- **WorkspaceNormalizingBackend** (Daytona): lazy init on first `list_files()` call
- **tree.py**: receives filter as optional parameter from the provisioner

Filtering composes with existing layers (hidden entries, `_SKIP_DIR_NAMES`); all three gates must pass for an entry to appear.

## Implementation Details

### New Module: `GitIgnoreFilter`

- **File**: `graphton/core/backends/gitignore_filter.py`
- Uses `pathspec` with `gitwildmatch` for correct `.gitignore` semantics
- `from_file(Path)` and `from_content(str)` factory methods; returns `None` when no actionable patterns
- `is_ignored(rel_path, is_dir=True|False|None)` — `None` for conservative matching when entry type unknown (Daytona)

### FilesystemBackend

- Eager `GitIgnoreFilter.from_file(root_dir / ".gitignore")` in `__init__`
- Extracted `_should_include(parent_dir, name, is_dir)` consolidating hidden/skip-dir/gitignore checks
- Applied in `list_files()` and `_format_directory_listing()` (including item-count calculation)
- Platform-mount paths bypass gitignore via `ValueError` catch on `relative_to()` (`.stigmer/` never filtered)

### WorkspaceNormalizingBackend (Daytona)

- Lazy `_get_gitignore()` on first `list_files()` — reads `.gitignore` via inner backend RPC
- `_workspace_relative(path)` helper for correct prefix stripping before gitignore matching
- Filter applied in overridden `list_files()` with `is_dir=None` (conservative; type unknown for remote entries)

### Tree Module

- Added `gitignore_filter` parameter to `build_directory_tree()`, `_parse_find_output()`, `_build_directory_tree_via_find()`, and `build_workspace_file_tree()`
- Local walker applies filter after `os.path.isdir()`; remote walker applies during parse (D/F type known)
- Provisioner `_load_gitignore_filter()` creates filter (local: `from_file`, remote: `backend.read_file` + `from_content`) and passes to tree builder

### Dependency

- Added `pathspec>=0.12.0,<1.0.0` to graphton `pyproject.toml`

## Benefits

- `glob("*.py")` on a Python project skips `venv/`, `__pycache__/`, and other gitignored directories
- `grep` stops reading compiled assets in `dist/` and vendored code in `vendor/`
- System prompt tree and tool layer see the same filtered view — no divergence
- Daytona sandbox gets `.gitignore` filtering (lazy load avoids constructor I/O)
- Zero changes to `tool_wrappers.py` — tools benefit via `backend.list_files()` filtering

## Impact

- **graphton**: New `GitIgnoreFilter` module, `pathspec` dependency, changes to `FilesystemBackend` and `WorkspaceNormalizingBackend`
- **agent-runner**: Changes to `tree.py` and `provisioner.py`; `pathspec` becomes transitive dependency
- **Tests**: 45 new tests (GitIgnoreFilter unit, FilesystemBackend integration, Daytona integration, tree module)

## Related Work

- **T01** (Workspace Tree Snapshot): Tree module now receives `GitIgnoreFilter` from provisioner
- **T04** (Skip-Directory Set): `_SKIP_DIR_NAMES` remains as safety net; gitignore is main filter for git repos
- **Deferred**: Hardcoded `_SKIP_DIR_NAMES` for Daytona (pre-existing gap); nested `.gitignore` support

---

**Status**: ✅ Production Ready
