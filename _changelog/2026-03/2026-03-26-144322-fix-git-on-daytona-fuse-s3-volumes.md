# Fix Git Operations on Daytona FUSE+S3 Volumes

**Date**: March 26, 2026

## Summary

Git clone and all subsequent git operations now work correctly on Daytona sandbox volumes. The root cause was the FUSE+S3-backed volume's lack of `rename()` support (ENOSYS), which git requires for atomic config and index writes. The fix uses `--separate-git-dir` to place git metadata on the local sandbox filesystem while keeping the working tree on the persistent volume.

## Problem Statement

Agent executions using `git_repo` workspace sources were failing during provisioning with:
```
error: could not write config file .git/config: Function not implemented
```

This blocked the entire "agents push code and create PRs" feature pipeline, since no git operations could succeed on Daytona volumes.

### Pain Points

- Agents could not clone repositories into persistent workspace volumes
- All git operations (clone, status, commit, push) failed on FUSE+S3 mounts
- The error message was misleading — initial hypothesis was `flock()`, but the actual failing syscall was `rename()`
- Secondary issues (dubious ownership, chmod failure) compounded the problem

## Solution

Split the git repository into two locations:
- **Working tree** (source files) stays on the FUSE+S3 volume for persistence across sandbox restarts
- **Git metadata** (`.git/` internals) lives on the local sandbox filesystem at `/home/daytona/.git-repos/{entry}` where all POSIX operations work

A `.git` text file on the volume points git to the metadata location — all standard git commands follow this pointer transparently.

Two global git configurations address secondary issues:
- `safe.directory = *` — bypasses ownership checks (volume files are `nobody:nogroup`, process runs as `daytona`)
- `core.fileMode = false` — prevents false-positive status changes from `chmod()` failures

## Implementation Details

### Core Changes (`worker/workspace/sources/git.py`)

**New constants and helpers:**
- `_GIT_DIR_BASE = "/home/daytona/.git-repos"` — base path for separated git metadata
- `_git_dir_path()` — deterministic path computation per workspace entry
- `_prepare_separate_git_dir()` — creates parent directory (not target — git creates that)
- `_configure_fuse_volume_compat()` — sets global git config for volume compatibility

**Modified `provision()`:**
- New `is_local_mode` parameter (default `True` for backward compatibility)
- When `False`: configures FUSE compat, uses `--separate-git-dir`, prepares git dir
- When `True`: unchanged behavior (standard git clone)

**Modified `_detect_existing_repo()`:**
- Now detects both `.git` directory (standard clone) and `.git` file (separated clone)
- Validates stale pointers: if the gitdir target doesn't exist (sandbox restart), returns `None` to trigger re-clone

**Modified `_setup_git_excludes()`:**
- Uses `git rev-parse --absolute-git-dir` to resolve the actual git directory
- Works correctly for both normal and separated clones
- Uses shell commands instead of `backend.read_file`/`write_file` (the exclude file may live outside the workspace root)

**Modified `_classify_error()`:**
- New classification for "Function not implemented" — provides clear guidance about FUSE volume incompatibility

### Provisioner Change (`worker/workspace/provisioner.py`)

One-line change: passes `is_local_mode` through to `git_source.provision()` in `_dispatch()`.

### Diagnostic Validation

Before implementation, ran comprehensive diagnostics on a live Daytona sandbox:
- Confirmed `rename()` → ENOSYS (errno 38) as root cause
- Confirmed `flock()` actually works (disproving initial hypothesis)
- Validated `--separate-git-dir` + `safe.directory` + `core.fileMode` fixes all issues
- Full agent workflow tested: clone, status, branch, add, commit, diff, log — 19/19 tests passed

## Benefits

- **Unblocks the PR pipeline**: Agents can now clone, modify, commit, and push from Daytona sandboxes
- **Zero impact on local mode**: Changes are gated behind `is_local_mode=False`
- **Self-healing on sandbox restart**: Stale pointers are detected and trigger automatic re-clone
- **Comprehensive test coverage**: 61 tests (10 new), covering cloud mode, stale pointers, error classification

## Impact

- **Agent Runner**: `worker/workspace/sources/git.py` and `worker/workspace/provisioner.py`
- **Test Suite**: `tests/workspace/test_git_source.py` — 61 tests, all passing
- **Downstream**: Enables Phase 1 (token persistence), Phase 2 (create_pr tool), Phase 3 (HITL gating)

## Related Work

- Prerequisite for the full "sandbox GitHub PR" feature pipeline (`20260326.01.sandbox-github-pr`)
- Builds on the DaytonaWorkspaceBackend session API switch (`69e9164a`)
- Builds on the GITHUB_TOKEN injection from personal environment (`81bbe1cd`)

---

**Status**: Production Ready (pending E2E deployment validation)
**Timeline**: 1 session (~2 hours diagnostic + implementation)
