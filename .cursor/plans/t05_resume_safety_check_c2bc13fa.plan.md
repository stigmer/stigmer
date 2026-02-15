---
name: T05 Resume Safety Check
overview: Add a lightweight workspace integrity check to the resume fast-path in execute_graphton.py. On resume, verify one sentinel file exists before trusting the fast-path; if it's missing (volume mount failure, data loss), gracefully fall back to full skill/attachment setup with WARNING logging.
todos:
  - id: helper-fn
    content: Add _check_workspace_file_exists helper function near top of execute_graphton.py
    status: completed
  - id: sentinel-check
    content: Add workspace integrity check block after skills fetch, before resume branch (Step 2.75)
    status: completed
  - id: skills-condition
    content: Change skills fast-path condition to include workspace_files_intact, add fallback logging
    status: completed
  - id: attachments-condition
    content: Change attachments fast-path condition to include workspace_files_intact, add fallback logging
    status: completed
  - id: verify-lints
    content: Run lints and verify no errors introduced
    status: completed
isProject: false
---

# T05: Resume Fast-Path Workspace Integrity Check

## Context

The `is_resume` fast-path in `[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` (lines 767-777 for skills, lines 947-961 for attachments) skips all file I/O on the assumption that files persist from the previous execution. With T02/T04 complete, files now live on a Daytona Volume — but if the volume mount fails silently, the fast-path leaves the agent in an empty workspace.

T05 adds a **single-file sentinel check** that validates the full chain (volume mounted -> subpath correct -> data intact) with one cheap I/O call. If it fails, we fall back to full setup (re-download + re-write), logging a WARNING for ops.

## Design Decisions

- **Single sentinel, not per-file**: One `test -f` call validates the entire chain. Checking every file would negate the fast-path performance benefit.
- **Skills-based sentinel**: Use the first skill's `SKILL.md` as the sentinel. Skills are deterministic (`bin/skills/{name}/SKILL.md`), always written first, and present in the vast majority of executions. If no skills exist, the check is skipped (vacuously true) — the rare "no skills + only attachments" edge case can be addressed later if needed.
- **One flag governs both skills AND attachments**: If the volume mount failed, both are missing. No independent checks needed.
- **Graceful degradation**: Fall back to full setup, log WARNING. The path `/home/daytona/workspace` exists whether the volume is mounted or not — the write works identically, it just won't persist across sandbox lifecycle.
- **Both local and cloud modes**: Local mode uses `Path.exists()` (essentially free). Cloud mode uses `sandbox.process.exec("test -f ...")` (same pattern as the existing health check).

## Approach

### 1. Add helper function `_check_workspace_file_exists`

Add near the top of `execute_graphton.py` (around line 133, before `inject_attachments`):

```python
def _check_workspace_file_exists(
    sandbox: Any | None,
    local_root: str | None,
    workspace_root: str | None,
    path: str,
    logger: logging.Logger,
) -> bool:
    """Check whether a workspace-relative file exists.

    Used as a lightweight sentinel check on the resume fast-path to
    verify that the persistent volume is mounted and prior files are
    intact.  Returns *True* when the file is confirmed present,
    *False* on any error or absence.

    Cloud mode: ``sandbox.process.exec("test -f <abs_path>")``
    Local mode: ``Path(local_root, path).exists()``
    """
```

- Local mode: `Path(local_root).joinpath(path).exists()` — pure filesystem, no exception expected
- Cloud mode: build absolute path `{workspace_root}/{path}`, run `sandbox.process.exec(f"test -f {abs_path}", timeout=5)`, return `exit_code == 0`
- All exceptions caught and logged — returns `False` on failure
- If neither `sandbox` nor `local_root` provided — return `True` (vacuously, nothing to check)

### 2. Workspace integrity check block (new Step 2.75)

Insert **after line 765** (skills fetched) and **before line 767** (`if is_resume:`):

- Compute sentinel: `SkillWriter.compute_skill_paths(skills)` -> take first entry -> append `/SKILL.md`
- Call `_check_workspace_file_exists(...)` with the sentinel path
- Store result in `workspace_files_intact: bool`
- Log INFO on success: `[RESUME] Workspace integrity verified (sentinel=...) — volume-backed files intact`
- Log WARNING on failure: `[RESUME] Workspace integrity check FAILED (sentinel=...) — falling back to full setup`
- If `is_resume` but no skills: skip check, `workspace_files_intact = True`

### 3. Modify skills fast-path condition (line 767)

Change:

```python
if is_resume:
```

To:

```python
if is_resume and workspace_files_intact:
```

In the `else:` block, add a log line when this is a fallback from failed integrity check:

```python
if is_resume:
    activity_logger.warning(
        "[RESUME-FALLBACK] Re-writing %d skills to workspace "
        "(workspace integrity check failed)", len(skills),
    )
```

### 4. Modify attachments fast-path condition (line 947)

Same pattern — change `if is_resume:` to `if is_resume and workspace_files_intact:`, with fallback logging in the else branch.

### 5. Enhanced logging

- Update the existing resume log messages to mention volume backing where applicable
- The resume banner at line 460 stays unchanged (it logs regardless of integrity)
- New log lines are at INFO (success) and WARNING (failure) levels — consistent with the codebase

## Files Modified

- `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` — all changes in this one file

## Estimated Scope

- ~20 lines: `_check_workspace_file_exists` helper
- ~15 lines: sentinel check block (Step 2.75)
- ~6 lines: modified conditions + fallback log lines in Steps 3 and 3.5
- Total: ~40 lines of focused, well-documented code

## What This Does NOT Do

- No tests in T05 scope (deferred to T06 per plan)
- No attachment-only sentinel (rare edge case, acceptable risk for MVP)
- No alerting/metrics integration (future work — can key off the WARNING logs)
- No retry of the sentinel check (one shot; if it fails, fall back immediately)

