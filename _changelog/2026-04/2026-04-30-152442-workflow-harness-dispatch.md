# Harness-Based Workflow Dispatch (T04)

**Date**: April 30, 2026

## Summary

Added harness-based activity dispatch to both Go (OSS) and Java (Cloud) Temporal workflows. The workflow now routes to `ExecuteCursor` for Cursor harness sessions or `ExecuteGraphton` for Native harness sessions based on `SessionSpec.harness`. Also removed the vestigial `approvalDecisions` parameter from ExecuteGraphton across Go, Java, and Python -- all three languages now use the cleaner DB-driven approval model exclusively.

## Problem Statement

T01 added the `Harness` proto enum and `SessionSpec.harness` field. T03 built the cursor-runner TypeScript service implementing `ExecuteCursor`. But the Go/Java workflow layer had no awareness of the harness -- it always dispatched `ExecuteGraphton` unconditionally. The workflow needed to read the session's harness and route to the correct activity type.

### Pain Points

- Workflow always dispatched `ExecuteGraphton` regardless of session harness
- No mechanism to propagate harness from session through dispatch to workflow
- `approvalDecisions` parameter on `ExecuteGraphton` was unused across all call sites (always nil/null) but still part of the interface, creating confusion
- Cursor flow needed a different mechanism for obtaining threadId (Cursor agentId vs LangGraph thread)

## Solution

**Minimal branching**: The Cursor workflow flow is structurally identical to Graphton -- same HITL approval loop, same pause/resume pattern, same signals. The only variation points are: (a) how threadId is obtained, (b) which activity is called, (c) no GenerateSessionSubject for Cursor.

**Harness propagation**: Session harness flows from DB through dispatch to workflow via `DispatchResult.Harness` -> `WorkflowInput.Harness`. Zero extra DB calls (session is already loaded during dispatch for runner resolution).

**ReadSessionThreadId**: New local activity for Cursor flow. Python's `EnsureThread` generates deterministic `"thread-{sessionId}"` which is not a valid Cursor agentId. The Cursor flow reads `session.spec.thread_id` from the DB instead -- empty on first execution, populated with the Cursor agentId after the first `ExecuteCursor` stores it.

## Implementation Details

### Part A: Remove Vestigial approvalDecisions (3 languages, 2 repos)

| Language | File | Change |
|----------|------|--------|
| Go | `activities/execute_graphton.go` | Removed `approvalDecisions` from interface, stub, and `workflow.ExecuteActivity` call |
| Go | `invoke_workflow_impl.go` | Removed `nil` third arg from both HITL loop call sites |
| Go | `invoke_workflow_pause_test.go` | Updated stub function and all 5 mock registrations |
| Java | `ExecuteGraphtonActivity.java` | Removed `ApprovalDecisionList` parameter |
| Java | `InvokeAgentExecutionWorkflowImpl.java` | Removed `null` arg from both call sites |
| Python | `execute_graphton.py` | Removed `approval_decisions_wrapper` param and unwrapping code |

### Part B: Harness Propagation (Dispatch -> WorkflowInput)

| Language | File | Change |
|----------|------|--------|
| Go | `dispatch.go` | Added `Harness` to `DispatchResult`, reads `session.GetSpec().GetHarness()` |
| Go | `workflow_input.go` | Added `Harness int32` field |
| Go | `controller/create.go` | Sets `Harness` from dispatch result |
| Java | `DispatchResult.java` | Added `int harness` to record |
| Java | `RunnerDispatchService.java` | Reads harness from session, threads through all dispatch paths |
| Java | `InvokeAgentExecutionWorkflowInput.java` | Added `int harness` field, updated factory methods |
| Java | `AgentExecutionCreateHandler.java` | Passes `dispatch.harness()` to workflow input |

### Part C: New Activities

| File | Type | Purpose |
|------|------|---------|
| `execute_cursor.go` | Go activity stub | `ExecuteCursor(executionID, threadID)` -- routes to TypeScript cursor-runner |
| `read_session_thread_id.go` | Go local activity | Reads `session.spec.thread_id` for Cursor agentId resolution |
| `ExecuteCursorActivity.java` | Java activity interface | `@ActivityMethod(name = "ExecuteCursor")` with `invokerIdentityAccountId` |
| `UpdateExecutionStatusActivity.java` | Java (extended) | Added `readSessionThreadId(sessionId)` method |

### Part D: Workflow Harness Dispatch

Both Go and Java workflows:
- `Run()` dispatches to `executeCursorFlow()` or `executeGraphtonFlow()` based on `input.Harness`
- `executeCursorFlow`: ReadSessionThreadId -> ExecuteCursor, same HITL loop and pause/resume as Graphton, no GenerateSessionSubject
- `executeCursorWithHitl`: Re-reads threadId before HITL reinvocation (picks up agentId stored by first ExecuteCursor call)

## Benefits

- **End-to-end harness dispatch**: Sessions with `harness=CURSOR` now route to the cursor-runner
- **Clean interface**: Vestigial `approvalDecisions` parameter removed across all three languages
- **Minimal branching**: Cursor flow reuses the same orchestration patterns (HITL, pause/resume, signals)
- **Zero breaking changes**: UNSPECIFIED harness defaults to NATIVE, in-flight workflows unaffected

## Impact

- **Go stigmer-server**: 7 files modified, 2 new files (285 insertions, 76 deletions net)
- **Java stigmer-service**: 7 files modified, 1 new file
- **Python agent-runner**: 1 file modified (26 lines simplified)
- **T05-T09 unblocked**: CLI embedding, billing, session lifecycle, and SDK/React all build on this dispatch layer

## Related Work

- T01: Proto changes (Harness enum, SessionSpec.harness) -- `2026-04-30-130933-cursor-harness-proto-foundation.md`
- T02: HITL research spike -- `2026-04-30-135545-cursor-harness-hitl-research-spike.md`
- T03: Cursor Runner TypeScript Service -- `2026-04-30-144627-cursor-runner-typescript-service.md`

---

**Status**: Production Ready (pending T05 CLI integration for end-to-end testing)
**Timeline**: ~30 minutes implementation after collaborative plan design
