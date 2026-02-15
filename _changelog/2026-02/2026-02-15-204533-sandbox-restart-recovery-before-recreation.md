# Sandbox Restart/Recovery Before Recreation (T03)

**Date**: February 15, 2026

## Summary

Replaced the binary alive/dead health check in Daytona sandbox management with a state-aware recovery chain that restarts stopped sandboxes, restores archived ones, and recovers from errors — only creating a new sandbox as a last resort. This preserves runtime packages (pip/apt installs, compiled tools, environment modifications) across most resume scenarios, complementing the persistent volume (T02) that already preserves workspace files.

## Problem Statement

When an agent execution pauses for human approval, the Daytona sandbox auto-stops after 15 minutes of inactivity. The previous implementation used a single `echo alive` health check to determine sandbox reusability — if the sandbox didn't respond (because it was stopped, not dead), the system discarded it and created a brand new one.

### Pain Points

- **Runtime state lost on every resume**: Agent-installed packages (`pip install numpy`, `apt install jq`), compiled binaries, and environment customizations were discarded whenever the sandbox was stopped — even though the sandbox was perfectly recoverable with a simple `start()` call.
- **Unnecessary resource consumption**: Creating new Daytona sandboxes takes 30-60 seconds and consumes cloud resources when a restart takes 5-10 seconds.
- **Binary health model was too coarse**: The system treated everything non-responsive as "dead" when the Daytona SDK exposes a rich state machine (STARTED, STOPPED, ARCHIVED, ERROR, DESTROYED, plus 10 transitional states) with targeted recovery actions for each.

## Solution

Introduced a state-aware sandbox recovery chain in `SandboxManager._try_revive_daytona_sandbox()` that inspects `sandbox.state` and takes the appropriate action before falling back to recreation.

## Implementation Details

### Recovery Priority Chain

| Sandbox State | Action | Timeout | What's Preserved | Typical Duration |
|---|---|---|---|---|
| STARTED | Health check (`echo alive`) | 5s | Everything | Instant |
| STOPPED | `sandbox.start()` | 60s | Packages + files | 5-30s |
| ARCHIVED | `sandbox.start()` | 120s | Packages + files | 30-120s |
| ERROR (recoverable) | `sandbox.recover()` | 60s | Packages + files | Varies |
| ERROR (non-recoverable) | Create new sandbox | — | Files only (volume) | 30-60s |
| DESTROYED | Create new sandbox | — | Files only (volume) | 30-60s |
| Transitional/unknown | Create new sandbox | — | Files only (volume) | 30-60s |

### Key Design Decisions

- **One attempt per state, no retry loops**: Each recovery action gets a single attempt with a generous SDK timeout. If it fails, we fall through to creation. The persistent volume guarantees file survival regardless, so this is safe.
- **STARTED state still gets a health check**: Even though the SDK reports STARTED, we verify with `echo alive` to catch edge cases where the process layer is hung but the state API hasn't caught up. This is the only state that needs it — `start()` and `recover()` already wait for readiness internally.
- **`DaytonaNotFoundError` for gone sandboxes**: Replaced bare `Exception` catch with the SDK's typed error for the specific case where `daytona.get()` can't find the sandbox, giving clearer logging and intent.
- **`auto_delete_interval=-1` at creation**: Explicitly disables auto-deletion on all new sandboxes as defense-in-depth. Although the SDK default is "disabled", we make the invariant explicit — sandboxes should never disappear without our involvement.

### Discovery: SandboxState Enum

The Daytona SDK (v0.129.0) `SandboxState` enum has 16 members — far more than the 4-5 documented in the public docs:

STARTED, STOPPED, ARCHIVED, ERROR, DESTROYED, CREATING, RESTORING, STARTING, STOPPING, DESTROYING, ARCHIVING, BUILD_FAILED, PENDING_BUILD, BUILDING_SNAPSHOT, PULLING_SNAPSHOT, UNKNOWN.

The implementation handles all 5 primary states explicitly and treats the remaining 11 transitional/terminal states as "cannot revive, create new."

### Files Modified

- `backend/services/agent-runner/worker/sandbox_manager.py` (+195 net lines)
  - Added `SandboxState`, `DaytonaNotFoundError` imports
  - New `_try_revive_daytona_sandbox()` method (167 lines) with full state machine
  - Updated `get_or_create_daytona_sandbox()` caller to use typed errors and new recovery method
  - Added `auto_delete_interval=-1` to both `CreateSandboxFromSnapshotParams` constructions

## Benefits

- **Runtime packages survive approval waits**: The most common case (sandbox auto-stopped after 15-min idle) is now handled by a fast restart (~5-30s) instead of full recreation (~30-60s).
- **Faster resume**: Restarting a stopped sandbox is 3-6x faster than creating a new one.
- **Lower resource consumption**: Reuse instead of recreate reduces cloud compute churn.
- **Operational visibility**: Every recovery branch logs sandbox_id, state, action taken, and elapsed time with `time.monotonic()`.
- **Defense-in-depth with volumes**: If recovery fails for any reason, the persistent volume (T02) ensures workspace files survive. Only runtime packages are lost — and that's acceptable for an edge case.

## Impact

- **Agent execution flow**: Post-approval resumes now attempt sandbox restart before recreation, making the common case (auto-stopped sandbox) significantly faster.
- **No API changes**: All changes are internal to `sandbox_manager.py`. No proto, CLI, or workflow changes needed.
- **Backward compatible**: Ephemeral sandboxes (no session_id) are unaffected. Local mode is unaffected.

## Related Work

- **T01**: Session-scoped local workspace directories (completed)
- **T02**: Daytona volume initialization at worker startup (completed)
- **T04** (next): Backend workspace root from volume mount path
- **T05** (future): Simplify resume fast-path with volume safety checks
- Parent project: `_projects/2026-02/20260215.01.persistent-session-workspace`
- Design decision: `DD02-sandbox-restart-before-recreation.md`

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
