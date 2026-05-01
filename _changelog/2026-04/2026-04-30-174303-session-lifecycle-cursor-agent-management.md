# Session Lifecycle: Cursor Agent Management (T07)

**Date**: April 30, 2026

## Summary

Hardened the Cursor harness session lifecycle with three targeted fixes: registered a missing Temporal local activity that would have caused every Cursor execution to fail at runtime, replaced a dangerous silent-fallback in agent resume with a fail-loud error path, and restricted session deletion to platform operators to protect the billing audit trail. Verified Java and TypeScript persistence wiring end-to-end.

## Problem Statement

The Cursor harness session lifecycle (built in T03/T04) had three issues discovered during hardening review:

### Pain Points

- **Runtime crash**: The Go Temporal worker never registered `ReadSessionThreadId` as a local activity, meaning every Cursor harness execution would fail with "activity type not found" at runtime
- **Silent context loss**: When `Agent.resume()` failed (agent expired, Cursor-side deletion), `resolveAgent()` silently created a new agent — discarding the entire conversation history with no indication to the user
- **Unprotected billing trail**: Any session owner could delete sessions, which could orphan `AgentExecution` billing records that reference those sessions

## Solution

Three surgical fixes, each addressing a distinct failure mode:

1. **Register the missing activity** in Go `worker_config.go` — add `ReadSessionThreadIdActivityImpl` to struct, constructor, and worker registration
2. **Fail loud on resume failure** in TypeScript `session-lifecycle.ts` — replace `console.warn` + fallback with `throw new Error(...)` containing an actionable message
3. **Restrict session deletion to operators** via proto annotation change (`can_delete_session` on `platform:stigmer`) and FGA model updates in both repos

## Implementation Details

### Go Worker Registration Fix (stigmer)

Added `readSessionThreadIdImpl` to `WorkerConfig`:
- Struct field, constructor instantiation, and `w.RegisterActivity()` call
- Matches the existing pattern used by `LoadAgentExecution`, `DeleteExecutionContext`, and `WaitForRunnerReady`

### Resume Failure Hardening (stigmer)

Changed `resolveAgent()` semantics:
- Empty `threadId` (first execution): creates agent normally — unchanged
- Non-empty `threadId` (subsequent execution): resumes agent, or throws with `"Failed to resume Cursor agent ... Please start a new session to continue"`
- The workflow catches this, marks execution as FAILED, and the error surfaces to the user

### Operator-Only Session Deletion (stigmer + stigmer-cloud)

Proto changes:
- Added `can_delete_session = 26` to `IamPermission` enum
- Changed `delete` RPC annotation: `resource_kind = platform`, `permission = can_delete_session`, `resource_id = "stigmer"`

FGA model changes:
- `platform.fga`: Added `define can_delete_session: operator`
- `session.fga`: Removed `define can_delete: owner`

OSS impact: None — the Go server has no FGA authorization interceptor, so the annotation change is a no-op.

### Verifications (read-only)

- **Java wiring**: Confirmed `readSessionThreadId` is correctly wired through `UpdateExecutionStatusActivity` local activity stub — no registration gap (different pattern from Go)
- **ThreadId persistence**: Confirmed `execute-cursor.ts` correctly persists `agent.agentId` via session update RPC — safe from concurrent modification because session spec is immutable during execution

## Benefits

- **Runtime correctness**: Cursor harness executions will actually work in the Go edition (previously guaranteed to crash)
- **Data integrity**: Multi-turn conversations cannot silently lose context on resume failure
- **Billing safety**: Session deletion is now an operator-only operation, preserving the audit trail
- **Dual-edition confidence**: Both Go (OSS) and Java (Cloud) wiring verified correct

## Impact

- **Cursor harness users**: Resume failures surface clearly instead of silently starting over
- **Platform operators**: Session deletion now requires operator role
- **Regular users**: Can no longer delete sessions (intentional — protects billing data)
- **Codegen**: 33 files in stigmer, 20 files in stigmer-cloud regenerated from proto changes

## Related Work

- T03: Cursor Runner TypeScript Service (built `session-lifecycle.ts`)
- T04: Workflow Harness Dispatch (built `ReadSessionThreadId` activity and Go/Java workflows)
- T06: Cost Model and Billing Integration (billing records on `AgentExecution`)
- T08: SDK/React Session Harness Picker (next task)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
