# Resume Fast-Path Workspace Integrity Check (T05)

**Date**: February 15, 2026

## Summary

Implemented a lightweight workspace integrity check that gates the resume fast-path in agent execution. When resuming after approval, the system now verifies that workspace files (skills and attachments) are intact before trusting the fast-path optimization. If the check fails (e.g., volume mount failure), the system gracefully falls back to full setup rather than leaving the agent in an empty workspace.

## Problem Statement

The resume fast-path optimization (introduced as part of the persistent session workspace project) skips skill and attachment writes on the assumption that files persist from the previous execution. With T02 (Daytona Volumes) and T04 (workspace root alignment) complete, files should survive sandbox lifecycle events — but if the volume mount fails silently (e.g., infrastructure issue, configuration error), the fast-path would proceed with empty workspace paths, leaving the agent with no skills or attachments.

### Pain Points

- **Silent volume mount failures**: If a Daytona Volume mount fails, the path `/home/daytona/workspace` exists anyway (as an empty directory on the sandbox's ephemeral filesystem), so writes don't fail — they just write to the wrong place.
- **Fast-path assumes success**: The `is_resume` flag skips all file I/O, including verification that files exist from the prior execution.
- **Hard-to-diagnose failures**: An agent resuming in an empty workspace would fail with cryptic errors (e.g., "skill not found") that don't clearly indicate the root cause was a volume mount failure.
- **No automatic recovery**: Without a safety check, ops would need to manually detect the issue, diagnose it, and trigger a re-run.

## Solution

Add a **single-file sentinel check** at Step 2.75 (after skills are fetched, before the resume branch). This validates the entire chain (volume mounted → subpath correct → data intact) with one cheap I/O operation.

**Design principles:**
1. **One sentinel file, not per-file**: Checking the first skill's `SKILL.md` validates the full chain without negating the fast-path performance benefit.
2. **One flag for both skills and attachments**: If the volume mount failed, both are missing. No independent checks needed.
3. **Graceful degradation**: Fall back to full setup (re-download artifacts, re-write files), log WARNING. User gets served, ops gets alerted.
4. **Both local and cloud modes**: Local mode uses `Path.exists()`, cloud mode uses `sandbox.process.exec("test -f ...")`.

## Implementation Details

All changes in `backend/services/agent-runner/worker/activities/execute_graphton.py`:

### 1. New import (line 7)
```python
from pathlib import Path
```
Moved to top-level since it's now used by a module-level function (previously only imported locally inside `inject_attachments`).

### 2. Helper function `_check_workspace_file_exists` (lines 136-190)
A focused function that checks whether a workspace-relative file exists:
- **Local mode**: `Path(local_root).joinpath(path).exists()` — pure filesystem check
- **Cloud mode**: `sandbox.process.exec(f"test -f {abs_path}", timeout=5)` — same mechanism as existing sandbox health checks
- All exceptions caught and logged, returns `False` on failure
- Returns `True` vacuously if neither sandbox nor local_root is available (nothing to check against)

### 3. `workspace_files_intact` flag initialization (line 810)
Initialized before Step 3 so both skills (Step 3) and attachments (Step 3.5) sections can read it. Defaults to `True`.

### 4. Sentinel check block (lines 843-875, Step 2.75)
After skills are fetched via gRPC and before the `if is_resume:` branch:
1. Compute sentinel path: `SkillWriter.compute_skill_paths(skills)` → take first entry → append `/SKILL.md`
2. Call `_check_workspace_file_exists(...)` with the sentinel path
3. Store result in `workspace_files_intact`
4. Log INFO on success: `[RESUME] Workspace integrity verified (sentinel=...) — volume-backed files intact`
5. Log WARNING on failure: `[RESUME] Workspace integrity check FAILED (sentinel=...). Falling back to full skill/attachment setup.`
6. If `is_resume` but no skills: skip check, `workspace_files_intact` remains `True` (vacuously valid)

### 5. Skills fast-path gate (line 877)
Changed condition from:
```python
if is_resume:
```
to:
```python
if is_resume and workspace_files_intact:
```

The `else:` block (full setup path) now logs `[RESUME-FALLBACK]` warning when falling back due to failed integrity check.

### 6. Attachments fast-path gate (line 1065)
Same pattern — condition changed to include `workspace_files_intact`, with `[RESUME-FALLBACK]` warning in the else block.

**Total scope**: ~45 lines of new code, +134/-9 in diff stats.

## Benefits

### Operational Safety
- **Automatic detection**: Volume mount failures caught immediately at resume time
- **Clear diagnostics**: `[RESUME] Workspace integrity check FAILED` in logs with sentinel path
- **Self-healing**: Graceful fallback means user execution proceeds despite infrastructure issue
- **Ops alerting**: WARNING logs provide clear signal for monitoring/alerting

### Performance Preservation
- **Fast-path still fast**: Only one `test -f` call added (< 100ms), not per-file verification
- **No happy-path penalty**: When volume is working correctly, the check is nearly free
- **Efficient fallback**: Full setup is only triggered when actually needed

### Developer Experience
- **No cryptic failures**: Clear log messages explain what went wrong and what action was taken
- **Transparent recovery**: User's execution completes successfully; infrastructure issue logged for ops
- **Maintainable**: Single sentinel check validates entire chain, easy to understand and debug

## Impact

### Who/What is Affected
- **Agent execution flow**: All agent executions that resume after approval (post-T02/T04)
- **Operations**: New WARNING logs provide early signal of volume mount issues
- **End users**: Transparent — fallback ensures execution succeeds even when volume fails

### Risk Reduction
- **Before T05**: Silent volume mount failure → empty workspace → agent execution failure with cryptic error
- **After T05**: Silent volume mount failure → detected → logged → automatic fallback → execution succeeds

### Monitoring Implications
- Ops teams can alert on `[RESUME] Workspace integrity check FAILED` patterns to detect persistent volume issues
- Can correlate with Daytona infrastructure health metrics

## Related Work

**Part of the persistent session workspace project (20260215.01)**:
- **T01** ✅ (2026-02-15): Session-scoped directories for local mode
- **T02** ✅ (2026-02-15): Daytona Volume auto-create and mount at worker startup
- **T03** ✅ (2026-02-15): Sandbox restart/recovery before recreation (package preservation)
- **T04** ✅ (2026-02-15): Backend workspace root alignment with volume mount path
- **T05** ✅ (2026-02-15, this changelog): Resume fast-path workspace integrity check
- **T06** (pending): Comprehensive testing

**Changelogs**:
- T01-T04 are covered in the 2026-02-15 session-2 checkpoint
- This changelog documents T05 specifically

**Design decisions**:
- `_projects/2026-02/20260215.01.persistent-session-workspace/design-decisions/DD01-persistent-volume-over-sandbox-filesystem.md` — Volume strategy
- `_projects/2026-02/20260215.01.persistent-session-workspace/design-decisions/DD02-sandbox-restart-before-recreation.md` — Restart priority chain

---

**Status**: ✅ Production Ready (pending T06 testing)  
**Complexity**: Small (~45 LOC, single file)  
**Risk**: Very low (graceful degradation, no breaking changes)
