# AgentRunner Go Controller Implementation (Dual-Edition Parity)

**Date**: April 21, 2026

## Summary

Implemented the complete Go/SQLite AgentRunner controller in stigmer-server, achieving dual-edition behavioral parity with the Java/MongoDB aggregate in stigmer-cloud. This completes Phase 1 item 9 of the agent-runner-as-resource project: every AgentRunner RPC defined in the proto (apply, create, update, delete, heartbeat, get, getByReference, list) now has a working implementation in both editions of the platform.

## Problem Statement

The AgentRunner proto resource was defined in Session 5 (6 proto files, 10 modified protos, 154 generated stubs). The Java aggregate was implemented in Session 6 (12 handler/repo files). Without a corresponding Go implementation in the OSS server, the AgentRunner resource would only exist in the cloud edition, breaking the dual-edition consistency contract that is foundational to Stigmer's architecture.

### Pain Points

- AgentRunner proto RPCs had no OSS server implementation — clients calling the OSS server would get `Unimplemented` errors
- The CLI's `stigmer runner start` flow (which calls `apply`) would fail entirely in the OSS edition
- No dual-edition test surface for validating AgentRunner behavior before wiring dispatch logic

## Solution

Created 9 Go files implementing an `AgentRunnerController` struct that satisfies both the `AgentRunnerCommandControllerServer` and `AgentRunnerQueryControllerServer` gRPC interfaces. The implementation follows the established pipeline framework pattern used by all other controllers in stigmer-server, with custom pipeline steps for the two domain-specific behaviors (status initialization on create, status preservation on update) and a fully custom handler for heartbeat.

## Implementation Details

**Controller structure**: Single `AgentRunnerController` struct embedding both `Unimplemented*Server` types, holding only a `store.Store` dependency. No cross-aggregate dependencies (unlike Agent which needs AgentInstance).

**Command handlers** (5 RPCs):
- **Create**: Pipeline with custom `initializeRunnerStatusStep` — sets `task_queue = "agent-runner:{id}"` and `phase = PENDING` after `BuildNewState` generates the ID
- **Update**: Pipeline with custom `preserveRunnerStatusStep` — restores status from existing resource after `BuildUpdateState` clears it (status is heartbeat-only)
- **Delete**: Standard delete pipeline (validate, extract ID, load for return, delete)
- **Apply**: Standard apply pipeline (validate, resolve slug, check existence, delegate to create or update)
- **Heartbeat**: Fully custom handler using `store.UpdateResource` atomic read-modify-write. Phase gate rejects FAILED runners. Reactivation logic transitions PENDING/STOPPED to READY with timestamp management.

**Query handlers** (3 RPCs):
- **Get**: Standard pipeline with `LoadTargetStep`
- **GetByReference**: Standard pipeline with `LoadByReferenceStep` for org+slug lookup
- **List**: Custom `listRunnersByOrgAndLabelsStep` — loads all runners, filters by org and labels (AND semantics), sorts by created_at DESC

**Server wiring**: Registered both controllers in `server.go` before the in-process server starts.

## Benefits

- **Dual-edition parity**: Every AgentRunner RPC now works identically in both OSS (Go/SQLite) and cloud (Java/MongoDB)
- **CLI readiness**: The `apply` and `heartbeat` RPCs are the primary CLI registration and keepalive paths — both now work in OSS
- **Pipeline consistency**: All standard handlers use the same generic pipeline steps as Agent, Session, Workflow, etc.
- **Clean build**: `go build ./...` and `go vet` pass cleanly with zero new warnings

## Impact

- **stigmer-server**: 9 new files, 1 modified file (~600 lines of Go)
- **Downstream**: Enables item 10 (dispatch integration) and item 12 (runner auth migration) to proceed
- **Testing surface**: OSS server can now serve as a lightweight test environment for the full AgentRunner lifecycle before deploying to cloud

## Related Work

- Session 5: AgentRunner proto definition (`_changelog/2026-04/2026-04-20-213108-agentrunner-proto-resource-definition.md`)
- Session 6: Java aggregate implementation (`_changelog/2026-04/2026-04-21-103215-agentrunner-aggregate-handlers.md`)
- Next: Phase 1 item 10 — dispatch integration in stigmer-cloud

---

**Status**: Production Ready
**Timeline**: 1 session
