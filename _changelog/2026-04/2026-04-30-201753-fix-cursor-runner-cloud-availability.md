# fix(cli): cursor-runner never starts in cloud mode

**Date**: April 30, 2026

## Summary

Fixed a chicken-and-egg bug where the cursor-runner process was always skipped when a runner connected to the cloud backend (desktop app or `stigmer up runner --standalone`). The availability gate checked for `CURSOR_API_KEY` or `STIGMER_PROXY_ENDPOINT` in the parent process environment, but neither is present in cloud mode — `STIGMER_PROXY_ENDPOINT` is only derived and injected into the child process environment at start time.

## Problem Statement

When the desktop app starts a runner via `stigmer up runner --standalone --endpoint api.stigmer.ai:443 --token T`, the cursor-runner TypeScript process was silently skipped. Only the Python agent-runner started, leaving the `ExecuteCursor` Temporal activity unregistered on the runner's task queue.

### Pain Points

- `IsCursorRunnerAvailable()` checked `os.Getenv("STIGMER_PROXY_ENDPOINT")`, but that variable is computed from `BackendInfo.Endpoint` and only set for the child process in `appendCursorCloudEnv()`
- `CURSOR_API_KEY` is not needed in cloud mode (the proxy injects it server-side), but the gate required one of the two
- No log message indicated why the cursor-runner was skipped in cloud mode, making the issue invisible

## Solution

Made `IsCursorRunnerAvailable` backend-context-aware by accepting `*BackendInfo`:

- **Cloud mode** (`!IsLocal`): cursor-runner is available if the source is present — no credential check needed because the proxy derives credentials at child-env construction time
- **Local mode** (`IsLocal`): `CURSOR_API_KEY` is still required for direct Cursor API access

## Implementation Details

**`cursor.go`** — Changed function signature from `IsCursorRunnerAvailable()` to `IsCursorRunnerAvailable(backendInfo *BackendInfo)`. Cloud mode returns true immediately after source check; local mode falls back to `CURSOR_API_KEY` env check.

**`start.go`** — Updated call site to pass `reg.backendInfo`. Restructured skip-reason debug logs to distinguish between "source not found" and "local mode missing CURSOR_API_KEY".

## Benefits

- Cursor harness starts automatically when a runner connects to the Stigmer cloud backend
- Desktop app users get the `ExecuteCursor` activity registered on their runner's task queue without needing to set any credentials manually
- Debug logging now accurately reports why the cursor-runner was skipped

## Impact

- **Desktop app**: Runners started from the desktop app will now include the cursor-runner process
- **CLI cloud runners**: `stigmer up runner --standalone` connecting to cloud backends will start both agent-runner and cursor-runner
- **Local/daemon path**: No change — still requires `CURSOR_API_KEY` (correct behavior, no proxy available)
- **Daytona sandbox path**: No change — starts both processes via shell command

---

**Status**: Production Ready
