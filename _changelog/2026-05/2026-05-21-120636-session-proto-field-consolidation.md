# Session Proto Field Consolidation

**Date**: May 21, 2026

## Summary

Renamed `SessionSpec.thread_id` to `harness_state_id` to accurately reflect its dual-purpose semantics (LangGraph thread ID for NATIVE harness, Cursor agent ID for CURSOR harness). Deleted the deprecated `sandbox_id` field entirely. Updated all consumers across both repositories — Go server, TypeScript runners, Python agent-runner, Java cloud service, React SDK, CLI embedded copies, and all generated stubs.

## Problem Statement

The `SessionSpec` proto had three field-level issues creating confusion and technical debt:

1. **`thread_id` (field 3)**: Misleadingly named — for NATIVE harness it stores a deterministic LangGraph thread ID (`thread-{sessionId}`), but for CURSOR harness it stores a Cursor SDK agent ID (`agent-xxx` or `bc-xxx`). The name "thread_id" implied a single purpose.

2. **`sandbox_id` (field 4)**: Deprecated after the Runner API deletion (T01-T05). The `updateSandboxId` RPC was already removed, and sandbox identity moved to the task queue naming convention (`session:{session_id}`). The deprecated field was dead weight.

3. **`cursor_mode` vs `execution_target` confusion**: Initially appeared redundant (both have LOCAL/CLOUD values), but analysis confirmed they are orthogonal — `execution_target` determines where the runner process lives (client vs cloud sandbox), while `cursor_mode` determines which Cursor SDK API to call. Kept both fields with improved documentation.

### Pain Points

- `thread_id` required reading implementation code to understand what it actually stored
- The overloaded semantics made the immutability sentinel (`thread_id != ""` means "session has been used") non-obvious
- `sandbox_id` cluttered the proto with a dead field and `[deprecated = true]` annotation
- New engineers couldn't tell why `cursor_mode` and `execution_target` coexisted

## Solution

Single-pass rename and deletion across both repositories, preserving all runtime behavior while improving semantic clarity.

## Implementation Details

### Proto Changes
- Renamed `thread_id` (field 3) to `harness_state_id` with comprehensive documentation explaining per-harness semantics and its role as the immutability sentinel
- Deleted `sandbox_id` (field 4) entirely — no `reserved`, no `deprecated`, clean removal
- Field numbers unchanged (wire-compatible)

### Go Server (stigmer-server)
- Renamed `read_session_thread_id.go` to `read_harness_state_id.go`
- Renamed struct `ReadSessionThreadIdActivityImpl` → `ReadHarnessStateIdActivityImpl`
- Renamed activity constant `ReadSessionThreadIdActivityName` → `ReadHarnessStateIdActivityName`
- Updated `validate_harness_immutability.go`: `GetThreadId()` → `GetHarnessStateId()`
- Updated `invoke_workflow_impl.go`: Cursor flow uses `harnessStateID`, Graphton flow keeps `threadID` (LangGraph concept)
- Updated `worker_config.go`, `BUILD.bazel`, `resume.go`, tests

### TypeScript Runners (unified runner + cursor-runner)
- Updated `execute-cursor/index.ts`: `sessionSpec.threadId` → `sessionSpec.harnessStateId`
- Updated `session-lifecycle.ts`: `resolveAgent()` parameter renamed `threadId` → `harnessStateId`
- Updated `session-memory.ts`: comment references
- LangGraph-internal `thread_id` references (checkpoint keys, `configurable.thread_id`) correctly left unchanged

### Java Cloud Service (stigmer-service)
- Updated `SessionContext.java`: record field `threadId` → `harnessStateId`
- Updated `UpdateExecutionStatusActivityImpl.java`: `getThreadId()` → `getHarnessStateId()`
- Updated `InvokeAgentExecutionWorkflowImpl.java`: `ctx.threadId()` → `ctx.harnessStateId()`
- Updated `SessionUpdateHandler.java`: immutability guard field access
- `ProxyAuthorizationService.sessionIdFromThreadId()` intentionally unchanged — parses LangGraph `thread-{sessionId}` format

### React SDK
- Updated `useSessionConversation.ts`: `spec?.threadId` → `spec?.harnessStateId`, removed `sandboxId` reference
- Updated `session-spec-converters.test.ts`: mock spec helper

### Python Agent-Runner
- No source changes needed — all `thread_id` references are LangGraph internals (checkpoint configurable keys, activity parameters), not session proto field access

### Codegen
- `stigmer`: `make codegen` regenerated Go, TypeScript, Python, Java, Dart stubs + SDK clients + JSON schemas + docs
- `stigmer-cloud`: `make protos` regenerated all stubs including previously stale TS `ExecutionTarget` enum

## Benefits

- **Semantic clarity**: `harness_state_id` communicates that this field's meaning depends on the harness, eliminating the misleading "thread" name
- **Cleaner proto**: Dead `sandbox_id` field removed — no deprecated annotations cluttering the schema
- **Better documentation**: `cursor_mode` vs `execution_target` distinction now clearly documented at both proto and code level
- **Consistent naming**: All consumers use the same terminology across Go, TypeScript, Java, Python, and React

## Impact

| Component | Change |
|-----------|--------|
| Proto (session) | 1 field renamed, 1 field deleted |
| Go stigmer-server | 7 files (1 renamed, 6 modified) |
| TypeScript runners | 6 source files + 4 test files |
| Java stigmer-service | 5 source files + 3 test files |
| React SDK | 2 files |
| Generated stubs | All languages regenerated |
| CLI embedded copies | 3 proto stubs updated |

## Related Work

- T01-T05: Runner API deletion (prerequisite — `sandbox_id` became dead after this)
- T06c: Desktop-owned embedded runner with execution target routing (added `execution_target`)
- Future: `EnsureSessionSandbox` activity for CLOUD execution target

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (single session)
