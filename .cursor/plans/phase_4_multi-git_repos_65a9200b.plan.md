---
name: Phase 4 Multi-Git Repos
overview: Enable multiple git repositories to be cloned into named subdirectories of the workspace root in cloud mode, with per-entry idempotency, recovery, file trees, git excludes, and git diff artifacts.
todos:
  - id: step1-git-subdir
    content: "git.py: Add target_subdir parameter and scope all internal functions (detect, recover, clone, resolve, excludes) to subdirectory via cwd and path prefixing"
    status: completed
  - id: step2-provisioner-thread
    content: "provisioner.py: Thread target_subdir from provision_all() through provision() and _dispatch(); fix _enrich_with_file_tree and _load_gitignore_filter for subdirectory entries"
    status: completed
  - id: step3-tree-cwd
    content: "tree.py: Add cwd parameter to build_workspace_file_tree and _build_directory_tree_via_find for remote-mode subdirectory scoping"
    status: completed
  - id: step4-graphton-multientry
    content: "execute_graphton.py: Guard backend replacement for multi-entry, add cwd to _generate_git_diff_artifact, multi-entry patch naming"
    status: completed
  - id: step5-tests
    content: "Tests: subdirectory clone/idempotency/recovery/excludes in git.py, multi-git provision_all, remote tree cwd, multi-entry git diff and backend skip"
    status: completed
isProject: false
---

# Phase 4: Backend Provisioner -- Multiple Git Repos

## Domain Analysis

The original Phase 4 plan (T01 Gaps 17, 19, 20, 25-27) describes this as "Medium effort" across `git.py` and `execute_graphton.py`. After deep analysis, the actual surface area is broader. Three architectural concerns were discovered that the plan did not anticipate:

### Concern 1: Backend replacement creates unreachable siblings

[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) lines 1367-1378 replace `workspace_backend` with the primary entry's `root_dir`. For multi-git, the primary's root would be `{workspace_root}/frontend/` while a sibling entry lives at `{workspace_root}/backend/`. After replacement, the backend cannot reach sibling directories -- `_generate_git_diff_artifact` (line 2779) uses `workspace_backend.execute("git diff")` which runs in the replaced root, making non-primary diffs impossible.

### Concern 2: Remote tree builder ignores `root_dir`

`_build_directory_tree_via_find` in [tree.py](backend/services/agent-runner/worker/workspace/tree.py) line 267 runs `find` via `backend.execute(cmd)` with no `cwd`, operating in `backend.root_dir` regardless of the `root_dir` parameter. For subdirectory entries, this generates the entire workspace tree instead of the entry's tree.

### Concern 3: Gitignore filter reads from workspace root in remote mode

`_load_gitignore_filter` in [provisioner.py](backend/services/agent-runner/worker/workspace/provisioner.py) line 388 calls `backend.read_file(".gitignore")` (relative to `backend.root_dir`), reading the wrong `.gitignore` for subdirectory entries.

All three concerns are solvable with a consistent approach, but the work spans more files than the original plan anticipated: `git.py`, `provisioner.py`, `tree.py`, and `execute_graphton.py`.

---

## Design Decisions (need your confirmation)

### D1: Subdirectory scoping strategy

The `WorkspaceBackend` protocol already supports `cwd` on `execute()` and relative paths on `read_file` / `write_file`. Rather than creating per-entry backend instances (which would require a backend factory and Daytona SDK considerations), we thread a `target_subdir: str | None` through [git.py](backend/services/agent-runner/worker/workspace/sources/git.py)'s internal functions:

- `execute()` calls get `cwd=target_subdir`
- File I/O calls get path-prefixed: `f"{target_subdir}/.git/info/exclude"`
- Clone target becomes `os.path.join(backend.root_dir, target_subdir)`
- Result `root_dir` becomes `os.path.join(backend.root_dir, target_subdir)`

This keeps changes local to git.py, avoids new backend types, and works on both Local and Daytona backends.

**Recommendation: Thread `target_subdir` (no new backend types).**

### D2: Backend replacement for multi-entry

After provisioning, `execute_graphton.py` replaces `workspace_backend` with the primary entry's root. For multi-entry this breaks sibling access (Concern 1 above).

- **Option A**: Skip replacement when `len(provision_results) > 1` -- agent CWD = workspace root, entries are immediate subdirectories. Simpler, symmetrical, avoids sibling problem.
- **Option B**: Replace to primary and store original root for git diff -- more code paths, original root leaks into post-execution logic.

**Recommendation: Option A.** For multi-entry, the workspace root IS the container. The system prompt already names the primary and instructs the agent to navigate by paths. This mirrors the VS Code multi-root model where the workspace root is the parent of all folders.

### D3: Single vs. multi behavior split

- **Single git entry**: Clone into workspace root (existing behavior, backward compatible, no subdirectory).
- **Multiple entries**: Each git entry clones into `{workspace_root}/{entry.name}/`.

This avoids a breaking change for existing single-git sessions. `provision_all()` decides: `use_subdirs = len(entries) > 1`.

**Recommendation: Keep the split for MVP.** Consistency (always-subdirectory) is cleaner long-term but would break existing sessions and change single-workspace agent CWD.

### D4: Multi-entry patch artifact naming

Currently the artifact is `{execution_id}.patch`. For multi-git, each entry needs a separate patch file.

- **Single entry**: `{execution_id}.patch` (backward compatible)
- **Multi entry**: `{execution_id}-{entry_name}.patch`

---

## Implementation Plan

### Step 1: git.py -- Subdirectory-aware provisioning

**File**: [sources/git.py](backend/services/agent-runner/worker/workspace/sources/git.py)

Add `target_subdir: str | None = None` parameter to `provision()`. Thread through internals:

- `_run_git()`: add `cwd: str | None = None` param, pass to `backend.execute(command, cwd=cwd)`
- `_detect_existing_repo()`: accept `target_subdir`, use `cwd=target_subdir` for `.git` check, prefix file paths
- `_recover_non_empty_workspace()`: accept `target_subdir`, scope `ls -A` and `rm -rf` to subdirectory only
- `_build_clone_command()`: target becomes `os.path.join(backend.root_dir, target_subdir)` when subdir set
- `_resolve_branch()`, `_resolve_head()`: accept and pass `cwd`
- `_setup_git_excludes()`: accept `target_subdir`, prefix `.git/info/exclude` path, use `cwd` for any execute calls
- `provision()` return: `root_dir = os.path.join(backend.root_dir, target_subdir)` when subdir set

Key behavioral note: When `target_subdir` is `None`, every function behaves identically to today. Zero regression risk for single-entry.

### Step 2: provisioner.py -- Thread target_subdir through dispatch

**File**: [provisioner.py](backend/services/agent-runner/worker/workspace/provisioner.py)

- Add `target_subdir: str | None = None` to `provision()` and `_dispatch()` signatures
- `_dispatch()` passes `target_subdir` to `git_source.provision()`; local_path and empty handlers ignore it
- `provision_all()` computes: `use_subdirs = len(entries) > 1`, passes `entry.name if use_subdirs else None`
- `_enrich_with_file_tree()`: compute relative subdir from `result.root_dir` vs `backend.root_dir`, pass as `cwd` to tree builder (addresses Concern 2)
- `_load_gitignore_filter()`: in remote mode, use `f"{rel_subdir}/.gitignore"` when rel_subdir is non-empty (addresses Concern 3)

### Step 3: tree.py -- Accept cwd for remote tree building

**File**: [tree.py](backend/services/agent-runner/worker/workspace/tree.py)

- Add `cwd: str | None = None` parameter to `build_workspace_file_tree()`
- Thread to `_build_directory_tree_via_find()`, which passes `cwd` to `backend.execute(cmd, cwd=cwd)`
- Local mode is unaffected (uses `root_dir` directly with `os.listdir`)

This is a small, surgical change. The `find` command already uses relative paths (`. -maxdepth ...`), so setting `cwd` correctly scopes it.

### Step 4: execute_graphton.py -- Multi-entry backend and git diff

**File**: [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)

**Backend replacement (lines 1367-1378)**: Add multi-entry guard:

```python
if provision_results:
    primary = provision_results[0]
    if len(provision_results) == 1 and primary.root_dir != workspace_backend.root_dir:
        # Single entry: replace backend (existing behavior)
        workspace_backend = LocalWorkspaceBackend(...)
    # Multi-entry: keep workspace_backend at sandbox root
```

**Git diff artifact (lines 2779-2787 + function at line 756)**: Modify `_generate_git_diff_artifact` to accept and use a `cwd` parameter:

```python
# Compute cwd from provision_result.root_dir relative to backend root
rel = os.path.relpath(pr.root_dir, workspace_backend.root_dir)
cwd = rel if rel != "." else None
```

**Artifact naming**: Use `{execution_id}-{entry_name}.patch` when `provision_result.entry_name` is non-empty.

### Step 5: Tests

- **git.py tests**: Subdirectory clone (target created, correct root_dir), subdirectory idempotency (detect `.git` in subdir), subdirectory recovery (clean only subdir), subdirectory excludes (correct path)
- **provisioner.py tests**: Multi-git `provision_all()` with 2+ git entries, verify `target_subdir` threading, single-entry passes `None`
- **tree.py tests**: Remote tree builder with `cwd` parameter
- **execute_graphton tests**: Backend replacement skipped for multi-entry, per-entry git diff with correct cwd, multi-entry patch naming

---

## Risks and Open Questions

- **Daytona `cwd` behavior**: Verify that `DaytonaWorkspaceBackend.execute(cmd, cwd=subdir)` correctly scopes to the subdirectory. If Daytona's SDK doesn't support `cwd`, this approach needs revision. (Mitigation: the protocol defines `cwd`; any conforming backend must implement it.)
- **Agent CWD for multi-entry**: Not replacing the backend means the agent starts in the workspace root, not the primary entry's repo root. The system prompt compensates, but agent behavior may differ subtly. Worth monitoring in integration testing.
- **Mixed local+git entries**: If one entry is local-path and another is git, `use_subdirs = True`. Git entry clones into subdir; local-path ignores subdir. This works but the primary root_dir heuristic may produce unexpected results. Flag as known limitation for MVP.

