# Reject LocalPathSource in Cloud Session Creation

**Date**: March 17, 2026

## Summary

Added an API-level validation step to the Java cloud backend (`stigmer-cloud`) that rejects `LocalPathSource` workspace entries during session creation. This closes a defense-in-depth gap where API callers could bypass the frontend and submit local path entries that would only fail late during agent runner workspace provisioning.

## Problem Statement

When a session with `LocalPathSource` workspace entries was created against the cloud backend, it was accepted, persisted, and an execution started — only to fail deep in the agent runner's workspace provisioning step with "LocalPathSource is only supported in local mode." The user had already created a session and waited for execution to begin before seeing the error.

### Pain Points

- API callers (SDK, curl, platform builders) could bypass the frontend's UI hiding and submit `LocalPathSource` entries directly
- Late failure: error surfaced during agent runner provisioning, not at session creation time
- Confusing UX: session appeared to be created successfully, then execution failed with an obscure provisioning error
- Wasted resources: session and execution records created for a request that could never succeed

## Solution

Added `RejectLocalPathWorkspaceStep` to the `SessionCreateHandler` pipeline in `stigmer-cloud`. This is a pure validation step (no injected dependencies) that iterates `session.spec.workspace_entries`, checks if any entry's source has `local_path` set, and returns `INVALID_ARGUMENT` immediately.

## Implementation Details

- **File**: `SessionCreateHandler.java` in stigmer-cloud backend
- **Inner class**: `RejectLocalPathWorkspaceStep` implements `RequestPipelineStepV2<CreateContextV2<Session>>`
- **Pipeline placement**: After `validateFieldConstraints` (proto structure valid), before `authorize` (no point authorizing a doomed request)
- **Status code**: `INVALID_ARGUMENT` — consistent with other validation failures
- **Error message**: Matches the agent runner's message for consistency across layers
- **No Go backend changes**: The Go backend serves both local and cloud modes; `LocalPathSource` is valid in local mode

### Defense-in-Depth Model (4 layers)

1. **Frontend**: "Local Folder" button hidden when `deploymentMode !== "local"`
2. **Java Backend** (new): `RejectLocalPathWorkspaceStep` returns `INVALID_ARGUMENT` at API time
3. **Agent Runner**: `is_local_mode` check raises `WorkspaceProvisionError`
4. **Daytona Sandbox**: Isolated filesystem — host paths don't exist inside the sandbox

## Benefits

- **Fail-fast**: API callers get an immediate, clear error instead of a delayed provisioning failure
- **Defense-in-depth**: Closes the gap between frontend UI hiding and agent runner validation
- **Zero breaking changes**: Pure additive validation — existing valid requests are unaffected
- **Minimal code**: ~20 lines of new code, single file change, no new dependencies

## Impact

- Cloud API consumers receive immediate validation feedback when submitting unsupported `LocalPathSource` entries
- Platform builders integrating via SDK or direct gRPC get consistent error handling
- No impact on local mode or Go backend — those paths remain fully functional

## Related Work

- [Local Folder Browser (2026-03-17)](2026-03-17-150749-local-folder-browser.md) — The feature that introduced `LocalPathSource` as a first-class workspace source in local mode
- `ResolveDefaultAgentInstanceStep` — Follows the same inner-class pipeline step pattern in `SessionCreateHandler`

---

**Status**: Production Ready
