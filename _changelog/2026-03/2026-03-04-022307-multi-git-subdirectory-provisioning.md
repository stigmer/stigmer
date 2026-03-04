# Multi-Git Subdirectory Provisioning (Phase 4)

**Date**: March 4, 2026

## Summary

Enabled multiple git repositories to be cloned into named subdirectories of the workspace root in cloud mode, completing the backend foundation for multi-source workspace sessions. Each git entry is provisioned independently with full idempotency, recovery, file-tree generation, git-exclude setup, and per-entry git diff artifact generation — all scoped correctly to its subdirectory.

## Problem Statement

After Phase 3 introduced multi-workspace provisioning for local paths, git repositories still lacked subdirectory support. In cloud mode (Daytona sandboxes), multiple git entries would all clone into the same workspace root, overwriting each other. The backend needed to route each git entry into its own named subdirectory while preserving backward compatibility for single-entry sessions.

### Pain Points

- All git operations (clone, `.git` detection, recovery, excludes, metadata resolution) assumed they operated at the workspace root
- The `execute_graphton.py` backend replacement logic would swap the workspace backend to the primary entry's root, making sibling entries unreachable for post-execution operations like `git diff`
- The remote tree builder ran `find` at the backend root regardless of which entry's tree was being built
- The gitignore filter read `.gitignore` from the backend root instead of the entry's subdirectory
- Git diff artifacts had no way to scope to a specific entry's directory or distinguish between multiple patches

## Solution

Threaded a `target_subdir: str | None` parameter through the git provisioning stack, using the existing `WorkspaceBackend` protocol's `cwd` parameter on `execute()` and relative path prefixing on file I/O methods. No new backend types or factories were needed. When `target_subdir` is `None`, every function behaves identically to before — zero regression risk.

## Implementation Details

### git.py — Subdirectory-aware provisioning
- Added `_effective_root()` (computes absolute subdirectory path) and `_scoped_path()` (prefixes file I/O paths) helpers
- Added `target_subdir` keyword parameter to `provision()`, threaded through all 7 internal functions:
  - `_detect_existing_repo()`: checks `.git` in subdirectory via `cwd`
  - `_recover_non_empty_workspace()`: scopes `ls -A` and `rm -rf` to subdirectory only
  - `_run_git()`: passes `cwd` to `backend.execute()`
  - `_resolve_branch()`, `_resolve_head()`: operate in subdirectory
  - `_setup_git_excludes()`: reads/writes `.git/info/exclude` under subdirectory
  - Clone target becomes `os.path.join(backend.root_dir, target_subdir)`

### provisioner.py — Subdirectory routing
- `provision_all()` decides: `use_subdirs = len(entries) > 1`
- Multi-entry: passes `entry.name` as `target_subdir` to git source
- Single-entry: passes `None` (backward compatible)
- `_enrich_with_file_tree()` computes relative subdir and passes as `cwd` to tree builder
- `_load_gitignore_filter()` reads `.gitignore` from correct subdirectory in remote mode
- Added `_relative_subdir()` helper

### tree.py — Remote tree cwd scoping
- Added `cwd` parameter to `build_workspace_file_tree()` and `_build_directory_tree_via_find()`
- Passes `cwd` to `backend.execute()` so `find` runs inside the entry's subdirectory
- Local mode unaffected (uses `root_dir` directly)

### execute_graphton.py — Multi-entry guards
- Backend replacement: only for single-entry (`len(provision_results) == 1`)
- Multi-entry: keep workspace backend at sandbox root so all subdirectories remain reachable
- `_generate_git_diff_artifact()` computes per-entry `cwd` from `os.path.relpath()`
- Patch naming: `{execution_id}-{entry_name}.patch` for named entries

### Tests — 28 new tests
- 12 git source tests: subdirectory clone, idempotency, recovery, excludes (cwd tracking, path verification)
- 4 provisioner tests: multi-git routing, single-entry backward compat
- 4 tree tests: cwd threaded to find, public API, local mode ignores
- 8 git diff artifact tests: per-entry cwd, naming, skip conditions

## Benefits

- **Multi-repo agents**: Sessions can now operate across multiple git repositories in cloud mode, each cloned into its own named subdirectory
- **Zero regression risk**: When `target_subdir` is `None` (single-entry), every function path is identical to before
- **Correct scoping**: File trees, git excludes, gitignore filters, and git diff artifacts are all scoped to the correct entry subdirectory
- **Per-entry artifacts**: Each git repo produces its own `.patch` file, distinguishable by entry name
- **Architectural consistency**: All 4 files use the same `target_subdir`/`cwd` threading pattern

## Impact

- **Agent-runner backend**: 4 production files modified, 1 new test file, 3 test files updated
- **Test coverage**: 28 new tests, all 292 backend tests passing
- **Backward compatibility**: Single-entry sessions completely unaffected
- **Foundation**: Completes the backend provisioning layer for multi-source workspaces; only integration tests and polish remain (Phase 5)

## Related Work

- Phase 1: Proto schema (`WorkspaceEntry`, `repeated workspace_entries`)
- Phase 2: CLI multi-workspace (`--workspace` repeatable flag)
- Phase 3: Backend provisioner for local paths (`provision_all`, prompt section)
- Phase 5 (next): Integration tests and polish

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
