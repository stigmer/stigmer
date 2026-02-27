---
name: Phase 3 Integration Wire-Up
overview: Wire the WorkspaceProvisioner into execute_graphton.py's execution flow with idempotent provisioning (no workspace_state proto), credential stripping, git-exclude for platform files, and post-execution git diff artifact generation. Gated behind STIGMER_WORKSPACE_PROVISIONING_ENABLED feature flag.
todos:
  - id: 3.1-idempotent
    content: Extend git source handler for idempotent provisioning (detect existing repo, handle corrupted state, setup git excludes)
    status: completed
  - id: 3.7-sync-fix
    content: Fix provisioner sync/async alignment (provision() should be sync, not async def)
    status: completed
  - id: 3.2-env-reorder
    content: Move environment merge block to before workspace provisioning in execute_graphton.py
    status: completed
  - id: 3.3-wire-up
    content: Wire provisioner into execution flow with feature flag + backend re-creation for local_path
    status: completed
  - id: 3.4-credential-strip
    content: Strip consumed_keys from merged_env_vars after provisioning, before MCP config and status tracking
    status: completed
  - id: 3.5-input-path
    content: Change default attachment mount path from inputs/ to .stigmer-inputs/ and update system prompt
    status: completed
  - id: 3.6-git-diff
    content: Add post-execution git diff artifact generation for git_repo workspaces
    status: completed
isProject: false
---

# Phase 3: Integration Wire-Up

## Architectural Decisions (resolved during planning)

- **No workspace_state proto.** Idempotent provisioning checks ground truth (`.git` directory, empty dir) instead of recorded state. More robust, self-healing, zero proto changes.
- **sandbox_id / thread_id misplacement in SessionSpec noted as tech debt.** Not addressed in this phase.
- **Input files and skills stay inside workspace root.** Platform directories (`.stigmer-inputs/`, `bin/skills/`) added to `.git/info/exclude` at provisioning time. Excluded from `git diff` via pathspec. No directory layout changes.

## Implementation Sequence

Seven sub-tasks, each independently testable and committable. Total touches ~3 files heavily + 1 file lightly.

---

### Sub-task 3.1: Extend Git Source Handler for Idempotent Provisioning

**File:** [worker/workspace/sources/git.py](backend/services/agent-runner/worker/workspace/sources/git.py)

The current `provision()` function only handles fresh clones into empty directories. For multi-execution sessions, subsequent executions find an already-cloned workspace. The provisioner needs to detect this and return metadata from the existing repo instead of failing.

**Changes to `provision()`:**

Add an `_detect_existing_repo()` check before `_verify_target_empty()`:

```python
existing = _detect_existing_repo(backend)
if existing is not None:
    logger.info("Workspace already provisioned (git repo detected), reusing")
    return existing
```

Three workspace states to detect:

1. **Empty directory** -- proceed with fresh clone (current behavior)
2. `**.git` exists** -- already provisioned. Run `git rev-parse --abbrev-ref HEAD` and `git rev-parse HEAD` to reconstruct `GitMetadata`. Return `ProvisionResult` with existing state. Log: `"Workspace already provisioned — reusing existing clone"`.
3. **Non-empty, no `.git`** -- corrupted partial state. Clean directory contents (`rm -rf` via `backend.execute()`), then proceed with fresh clone. Log warning: `"Workspace contains partial state (no .git), cleaning up before re-provisioning"`.

**Also add:** `_setup_git_excludes(backend)` called after successful clone (and after detecting existing repo). Writes `.stigmer-inputs` and `bin/skills` to `.git/info/exclude` if not already present.

**Tests (in test_git_source.py):**

- Already-provisioned workspace returns correct GitMetadata without cloning
- Corrupted workspace (non-empty, no .git) is cleaned and re-cloned
- `.git/info/exclude` entries are written after fresh clone
- `.git/info/exclude` entries are idempotent (not duplicated on re-detection)

---

### Sub-task 3.2: Reorder Environment Merge in Execution Flow

**File:** [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)

**The problem:** Environment merge is currently Step 4 (line ~1248), AFTER workspace initialization and skill/attachment injection. The provisioner needs `merged_env_vars` (for `GITHUB_TOKEN`), so the merge must happen earlier.

**The move:** Relocate the entire environment merge block (lines ~1248-1340) to immediately after `initialize_workspace` (line ~974), BEFORE skills and attachments.

**Safety analysis:** Nothing between workspace init (line 967) and env merge (line 1248) uses `merged_env_vars`. Skills use the skill client (gRPC). Attachments use artifact storage. So the reorder is safe.

**New flow order after this change:**

```
workspace_backend, sandbox = initialize_workspace(...)
merged_env_vars = _merge_environment(...)  # MOVED UP
# ... skills ...
# ... attachments ...
# ... MCP config (uses merged_env_vars) ...
```

Consider extracting the ~90-line environment merge block into a helper function `_resolve_merged_environment()` to make the main function more readable and the move cleaner. (This is optional -- discuss with user if the current inline style is preferred.)

**Tests:** No new tests needed -- existing behavior is unchanged. Verify existing test suite passes.

---

### Sub-task 3.3: Wire Provisioner into Execution Flow

**File:** [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)

The core integration. After environment merge, call the provisioner. Gate everything behind a feature flag.

**Feature flag:**

```python
_PROVISIONING_ENABLED = os.environ.get(
    "STIGMER_WORKSPACE_PROVISIONING_ENABLED", ""
).lower() in ("1", "true", "yes")
```

**Integration point** (after env merge, before skills):

```python
provision_result: ProvisionResult | None = None

if _PROVISIONING_ENABLED and _has_workspace_source(session):
    provisioner = WorkspaceProvisioner(log=activity_logger)
    provision_result = await provisioner.provision(
        workspace_source=session.spec.workspace_source,
        backend=workspace_backend,
        merged_env=merged_env_vars,
        is_local_mode=worker_config.is_local_mode(),
    )

    # Backend re-creation: when ProvisionResult.root_dir differs from
    # the original backend (local_path mode), create a new backend
    # pointing at the authoritative workspace root.
    if provision_result.root_dir != workspace_backend.root_dir:
        workspace_backend = LocalWorkspaceBackend(
            root_dir=provision_result.root_dir,
        )
        activity_logger.info(
            "Workspace root changed by provisioning: %s -> %s",
            workspace_backend.root_dir,
            provision_result.root_dir,
        )
```

**When flag is OFF or no workspace_source:** Zero behavior change. The provisioner is never called. All downstream code (skills, attachments, agent creation) uses the original `workspace_backend` unchanged.

**Important: `WorkspaceProvisioner.provision()` is currently synchronous** (the `_dispatch` method is not async). The git source handler calls `backend.execute()` which is also synchronous (both `LocalWorkspaceBackend` and `DaytonaWorkspaceBackend` have sync `execute()`). So `await provisioner.provision(...)` needs the provision method to be async, OR we call it without await. Need to verify the provisioner's async status. If `_dispatch` is sync, we may need to wrap it or make `provision()` sync.

**Pause point:** Verify whether `WorkspaceProvisioner.provision()` should remain sync or become async. The current implementation has `async def provision()` but `_dispatch()` is sync. The `await` on line 169 (`result = self._dispatch(...)`) is missing -- this is a latent bug. The git source handler's `backend.execute()` is sync. **Decision: make `provision()` and `_dispatch()` both sync, call without await.** This matches the reality that all operations (git clone via `backend.execute()`, path checks) are synchronous.

**Tests:**

- Feature flag OFF: provisioner not called, existing behavior preserved
- Feature flag ON, no workspace_source: provisioner not called
- Feature flag ON, git_repo source: provisioner called, ProvisionResult consumed
- Feature flag ON, local_path source: backend re-created with new root_dir
- WorkspaceProvisionError propagates as execution failure

---

### Sub-task 3.4: Credential Stripping

**File:** [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)

After provisioning returns `consumed_keys`, strip those keys from `merged_env_vars` before they reach MCP config transformation (line ~1376) or status tracking (line ~1466).

```python
if provision_result and provision_result.consumed_keys:
    for key in provision_result.consumed_keys:
        if key in merged_env_vars:
            del merged_env_vars[key]
    activity_logger.info(
        "Stripped %d provisioning key(s) from agent environment: %s",
        len(provision_result.consumed_keys),
        ", ".join(provision_result.consumed_keys),
    )
```

This placement (after provisioning, before MCP/status) ensures:

- `GITHUB_TOKEN` used for git clone is NOT leaked into MCP server config `${GITHUB_TOKEN}` placeholders
- `GITHUB_TOKEN` is NOT listed in status builder's resolved environment keys
- `WORKSPACE_PROVISION_*` prefixed keys are also stripped

**Tests:**

- consumed_keys removed from merged_env_vars
- MCP config transformation does not see stripped keys
- Status builder does not report stripped keys
- Empty consumed_keys: no mutation

---

### Sub-task 3.5: Input File Default Path Change

**File:** [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) -- `inject_attachments()` function

Change the default mount path from `inputs/{filename}` to `.stigmer-inputs/{filename}`:

```python
# Line 300, change:
mount_path = f"inputs/{attachment.filename}"
# To:
mount_path = f".stigmer-inputs/{attachment.filename}"
```

**Also update** the system prompt's input files section (line ~1502) to reflect the new path prefix and add the "read-only reference" guidance from T01.

**Note:** Attachments with explicit `mount_path` set by the user are NOT affected. Only the default changes. This is backward-compatible for anyone who was relying on explicit mount_path. Users relying on the default `inputs/` path will see files at `.stigmer-inputs/` instead -- this is acceptable since the system prompt includes the exact paths.

**PAUSE POINT:** This is a behavioral change even when the feature flag is OFF (the default path changes for ALL executions, not just provisioned ones). We have two options:

1. Always use `.stigmer-inputs/` (cleaner, single convention)
2. Only use `.stigmer-inputs/` when provisioning is active (conditional, preserves existing behavior)

**My recommendation:** Option 1. The `.stigmer-inputs/` prefix is better regardless of provisioning -- it's clearly namespaced and won't collide with user project directories named `inputs/`. But I want to flag this for your decision.

**Tests:**

- Default mount_path is `.stigmer-inputs/{filename}`
- Explicit mount_path is unchanged
- System prompt includes correct paths

---

### Sub-task 3.6: Post-Execution Git Diff Artifact

**File:** [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) -- new function + call site near `_auto_publish_written_files` (line ~2396)

Add a new function `_generate_git_diff_artifact()`:

```python
async def _generate_git_diff_artifact(
    workspace_backend: WorkspaceBackend,
    provision_result: ProvisionResult,
    execution_id: str,
    storage: ArtifactStorage,
    status_builder: "StatusBuilder",
    logger,
) -> bool:
    """Generate a .patch artifact from git diff if workspace is git-backed."""
    if provision_result.source_type != SourceType.GIT_REPO:
        return False

    result = workspace_backend.execute(
        "git diff -- ':!.stigmer-inputs' ':!bin/skills'",
        timeout=30,
    )
    if result.exit_code != 0 or not result.stdout.strip():
        logger.info("[GIT_DIFF] No changes detected or git diff failed")
        return False

    patch_content = result.stdout.encode("utf-8")
    # Upload and register as artifact...
```

**Call site:** Right before `_auto_publish_written_files` (line ~2396), add:

```python
if provision_result is not None:
    await _generate_git_diff_artifact(
        workspace_backend, provision_result, execution_id,
        artifact_storage, status_builder, activity_logger,
    )
```

The git diff excludes `.stigmer-inputs` and `bin/skills` via pathspec, producing a clean patch of only the agent's code changes. The patch is uploaded as an `ExecutionArtifact` with filename `{execution_id}.patch`.

**Tests:**

- Git diff generated for git_repo workspace with changes
- Git diff NOT generated for empty workspace
- Git diff excludes .stigmer-inputs and bin/skills
- No-changes case produces no artifact
- Git diff failure is non-fatal (logged, execution continues)

---

### Sub-task 3.7: Provisioner Sync/Async Alignment

**File:** [worker/workspace/provisioner.py](backend/services/agent-runner/worker/workspace/provisioner.py)

**Latent bug:** `provision()` is declared `async def` but `_dispatch()` is a regular function that returns a `ProvisionResult` directly (not a coroutine). The `result = self._dispatch(...)` call on line 169 works by accident (calling a sync function without `await` in an async context just gets the return value), but it's misleading.

**Fix:** Change `provision()` from `async def` to `def`. All underlying operations (`backend.execute()`, path checks) are synchronous. The caller in execute_graphton.py will call it as `provision_result = provisioner.provision(...)` (no `await`).

**Tests:** Existing provisioner tests continue to pass.

---

## Risk Mitigation

- **Feature flag** (`STIGMER_WORKSPACE_PROVISIONING_ENABLED`): When OFF, the entire provisioning path is skipped. Zero behavior change to existing executions.
- **Idempotent provisioning**: Self-healing. No external state to corrupt or repair.
- **Sub-task ordering**: Each sub-task is independently committable. If we hit a blocker on sub-task 3.6 (git diff), sub-tasks 3.1-3.5 still deliver value.
- **Environment merge reorder** (sub-task 3.2): Verified that nothing between workspace init and env merge depends on env vars. Safe to move.

## Files Changed Summary


| File                                                      | Change Type                                                      | Sub-tasks               |
| --------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------- |
| `worker/workspace/sources/git.py`                         | Modified (idempotent + git exclude)                              | 3.1                     |
| `worker/activities/execute_graphton.py`                   | Modified (env reorder, wire-up, stripping, input path, git diff) | 3.2, 3.3, 3.4, 3.5, 3.6 |
| `worker/workspace/provisioner.py`                         | Modified (sync fix)                                              | 3.7                     |
| `tests/workspace/test_git_source.py`                      | Modified (new idempotent tests)                                  | 3.1                     |
| NEW: `tests/integration/test_provisioning_integration.py` | New (integration tests)                                          | 3.3, 3.4, 3.5, 3.6      |


