# Embedded Runner Identity in `stigmer up server`

**Date**: April 22, 2026

## Summary

The daemon's embedded agent-runner is now registered as a first-class Runner resource when `stigmer up server` starts. The Python process launches with `STIGMER_RUNNER_ID` and `STIGMER_TASK_QUEUE` from the beginning, enabling heartbeats, visibility in `stigmer list runners`, and parity with standalone runners started via `stigmer up`.

## Problem Statement

When `stigmer up server` started the full local stack, the embedded agent-runner ran anonymously on a hardcoded Temporal queue with no Runner resource identity.

### Pain Points

- No heartbeats — the Python `HeartbeatEmitter` only activates when `STIGMER_RUNNER_ID` is set
- Invisible to `stigmer list runners` — users couldn't see whether a runner was active
- Invisible to the web UI runner picker — sessions couldn't target the embedded runner
- The upcoming dispatch fail-fast (T07) can't check for active runners without Runner resources

## Solution

Register the embedded runner as a Runner resource inside the daemon process, between stigmer-server readiness and agent-runner start. This required solving an ordering problem: seedpack bootstrap (which creates the org) had to move into the daemon process to ensure the organization exists before `Runner.Apply` is called.

## Implementation Details

### Ordering Problem

The original plan assumed the org already existed when the daemon started. In reality, the org is created by seedpack bootstrap, which ran in the parent process *after* the daemon (including agent-runner) had already started. The fix: run seedpack bootstrap inside the daemon process, between `WaitForReady` and runner start. The parent's seedpack call becomes an idempotent no-op via the marker file.

### New Registration Flow in `daemon_process.go`

- `registerEmbeddedRunner()`: After stigmer-server is ready, runs seedpack bootstrap (idempotent), discovers the org via `FindMyOrganizations`, then calls `Runner.Apply` with name/slug "embedded" using raw gRPC proto clients (same pattern as `EnsureOrgContext`).
- `buildRunnerEnv()` now accepts `runnerID` and `taskQueue` parameters. Sets `STIGMER_RUNNER_ID` and `STIGMER_TASK_QUEUE` when provided; falls back to the legacy hardcoded queue when empty.
- `buildComponents()` accepts a double pointer to the identity struct; the agent-runner closure dereferences it at start time (after registration has populated it).

### State Management

- `saveEmbeddedRunnerState()` / `removeEmbeddedRunnerState()`: Write/delete `~/.stigmer/runners/embedded.json` directly, avoiding a circular dependency (the `runner` package imports `daemon`).
- The JSON schema matches `runner.RunnerState` with an additional `managed_by_daemon: true` field.
- `RunnerState.ManagedByDaemon` added to the runner package with `omitempty` for backward compatibility.

### Stop Protection

- `StopRunner()` returns with a guidance message when `ManagedByDaemon` is true: "Use 'stigmer down' to stop it."
- `StopAllRunners()` filters out daemon-managed runners, only stopping standalone ones.

### Down Command Behavior

| Command | Behavior |
|---------|----------|
| `stigmer down` | Stops daemon (agent-runner killed, STOPPED heartbeat, embedded.json removed) + stops standalone runners |
| `stigmer down server` | Stops daemon only; standalone runners remain |
| `stigmer down runner` | Skips embedded runner; stops standalone runners |
| `stigmer down runner --name embedded` | Prints guidance: "Use 'stigmer down' to stop it" |

## Benefits

- Every agent-runner — embedded or standalone — now has a Runner resource with heartbeat
- `stigmer list runners` shows the embedded runner alongside standalone ones
- Unified model: dispatch, session routing, and web UI can treat all runners identically
- Foundation for T07 dispatch fail-fast (can now check for READY/BUSY runners)

## Impact

- **CLI users**: `stigmer list runners` now shows the embedded runner when `stigmer up server` is running
- **Web UI**: Runner picker will be able to show the embedded runner (T08)
- **Backend**: No changes — `Runner.Apply` and heartbeat are idempotent, existing infrastructure handles everything
- **Python agent-runner**: No changes — already supports `STIGMER_RUNNER_ID` and `STIGMER_TASK_QUEUE`

## Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/daemon/daemon_process.go` | +229 lines: `registerEmbeddedRunner()`, `buildRunnerEnv()` params, `buildComponents()` pointer capture, state persistence, shutdown cleanup |
| `client-apps/cli/internal/cli/runner/state.go` | +1 field: `ManagedByDaemon bool` |
| `client-apps/cli/internal/cli/runner/stop.go` | Modified: daemon-managed protection in `StopRunner()` and `StopAllRunners()` |
| `client-apps/cli/internal/cli/daemon/BUILD.bazel` | +2 deps: runner proto, apiresource proto |

## Related Work

- Part of the Runner UX & CLI Restructure project (20260422.01), task T06
- Builds on T02 (daemon server-only mode), T04 (runner lifecycle), T05 (multi-runner management)
- Enables T07 (dispatch fail-fast without runner)
- Forward-compatible with the runner command stream project (20260422.02) which will replace Python heartbeat with a Go supervisor + bidi gRPC stream

---

**Status**: Production Ready
**Timeline**: 1 session
