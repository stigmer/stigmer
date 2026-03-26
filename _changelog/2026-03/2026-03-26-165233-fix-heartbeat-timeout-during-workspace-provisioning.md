# Fix Heartbeat Timeout During Git Workspace Provisioning

**Date**: March 26, 2026

## Summary

Fixed a critical bug where the Temporal activity heartbeat would time out during git workspace provisioning, causing the agent execution to fail with a confusing "Activity task timed out" error. The root cause was a synchronous git clone call blocking the asyncio event loop for up to 5 minutes, starving Temporal heartbeat delivery. Additionally, transient Daytona proxy timeouts now trigger automatic retry instead of immediate failure.

## Problem Statement

When an agent execution required cloning a git repository into a Daytona sandbox, the provisioning step would block the asyncio event loop with a synchronous HTTP call to the Daytona proxy (up to 300 seconds). During this time, no Temporal heartbeats could be sent, causing the Temporal server to kill the activity after its 2-minute heartbeat timeout — even though the clone was still running.

### Pain Points

- Users saw a cryptic "Activity task timed out" error instead of actionable feedback about what was happening
- The Temporal server marked the activity as failed at 2 minutes, but the worker continued running the doomed clone for another 3 minutes, wasting resources
- The worker never learned about the cancellation because cancellation is delivered via the heartbeat mechanism — which was blocked
- Transient Daytona proxy timeouts (network blips, load spikes) caused immediate, unrecoverable failures with no retry

## Solution

Two targeted changes in the agent-runner, with no modifications to the Temporal workflow configuration (which is architecturally sound):

1. **Async heartbeat wrapper**: A new `_run_sync_with_heartbeat()` utility runs the synchronous provisioning code in a background thread via `asyncio.to_thread()`, keeping the event loop free to send heartbeats every 30 seconds and detect cancellation.

2. **Clone retry with transient error classification**: The git clone call now retries up to 3 times on transient network failures (proxy timeouts, connection resets), with proper workspace cleanup between attempts. Non-transient errors (auth, repo-not-found) fail immediately.

## Implementation Details

### Change 1: `_run_sync_with_heartbeat()` in `execute_graphton.py`

- Dispatches a synchronous callable to a thread via `asyncio.to_thread(functools.partial(fn, *args, **kwargs))`
- Uses `asyncio.wait()` with timeout (not `wait_for`, which cancels the underlying future) to poll every 30 seconds
- Between polls: sends a Temporal heartbeat with phase name, heartbeat count, and elapsed time; checks `activity.is_cancelled()` to detect server-side cancellation
- On cancellation: raises `asyncio.CancelledError` so the worker stops promptly instead of blocking until the thread finishes
- The `provisioner.provision_all()` call is wrapped with this utility

### Change 2: Clone retry in `git.py`

- New `_TRANSIENT_PATTERNS` tuple defines known transient error substrings (`"read timed out"`, `"connectionreset"`, `"broken pipe"`, etc.)
- New `_is_transient_error()` function checks if an error message matches any transient pattern
- New transient classification branch in `_classify_error()` produces clear, actionable error messages with `transient=True` flag on `WorkspaceProvisionError`
- New `_clone_with_retry()` function wraps the clone call: retries on transient errors (up to 3 attempts with 5-second delay), cleans partial state between retries, fails immediately on non-transient errors
- `WorkspaceProvisionError` gains a `transient` attribute (default `False`) for programmatic retriability signaling

### Change 3: Docstring correction

- Fixed stale docstring on `heartbeat_during_setup()` that claimed a 30-second heartbeat timeout; the actual Java configuration is 2 minutes
- Added cross-reference to `_run_sync_with_heartbeat` for long-running blocking operations

## Benefits

- Agent executions with git workspaces no longer fail due to heartbeat starvation during clone
- Transient Daytona proxy failures are automatically retried instead of failing the entire execution
- Users see clear, actionable error messages ("transient network/proxy error") instead of cryptic Temporal timeouts
- Worker detects cancellation promptly between heartbeats, avoiding minutes of wasted compute
- The `_run_sync_with_heartbeat` utility is generic and reusable for any future long-running synchronous operation in the setup phase

## Impact

- **Agent Runner**: Three files changed in `backend/services/agent-runner/worker/`
- **End Users**: Git-backed agent sessions are significantly more reliable, especially for larger repositories or during network instability
- **Operators**: Reduced wasted compute from workers running doomed operations after Temporal cancellation
- **No changes to stigmer-cloud**: The Temporal workflow configuration (2-min heartbeat, 24h start-to-close, no retries) is correct; the fix is purely in the Python worker

## Files Changed

| File | Changes |
|------|---------|
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | Added `_run_sync_with_heartbeat()`, wrapped provisioning call, fixed docstring |
| `backend/services/agent-runner/worker/workspace/sources/git.py` | Added `_clone_with_retry()`, `_is_transient_error()`, transient error classification, retry constants |
| `backend/services/agent-runner/worker/workspace/provisioner.py` | Added `transient` attribute to `WorkspaceProvisionError` |

## Related Work

- [Inject GitHub Token from Personal Environment](2026-03-26-123838-inject-github-token-from-personal-environment.md) — the token injection that enables authenticated git clones
- [Git Credential Persistence via Credential Store](2026-03-26-150111-git-credential-persistence-via-credential-store.md) — credential handling for post-clone git operations

---

**Status**: ✅ Production Ready
