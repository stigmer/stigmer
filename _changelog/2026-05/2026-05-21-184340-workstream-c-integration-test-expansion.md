# Workstream C: Go Integration Test Expansion — Proto-Grounded Gap Coverage

**Date**: May 21, 2026

## Summary

Added 8 new Go integration tests across 3 files, covering proto contract gaps identified through a deep audit of all 11 existing `agent_execution_*_test.go` files against the full AgentExecution proto model. Includes the first-ever gRPC streaming Subscribe tests in the integration suite. Also discovered and documented a critical runtime gap: agent execution pause/resume is broken end-to-end in the TS unified runner.

## Problem Statement

The existing integration test suite had structural blind spots in three areas:

### Pain Points

- **Recover RPC precondition guards** were only tested for the happy path (FAILED → recover). The three rejection cases (CANCELLED, COMPLETED, TERMINATED) had zero coverage — a regression in precondition validation would silently allow corrupted state recovery.
- **ToolCall proto fields** — existing tests asserted only 2 of 19 ToolCall fields (`name` and `mcp_server_slug`). The SDK's `<ExecutionViewer />` renders `id`, `args`, `result`, `status`, `started_at`, `completed_at` — all uncovered. A server-side regression in any of these would break every embedded execution viewer with no CI signal.
- **Subscribe streaming RPC** — the primary real-time data path for the web console (`useExecutionStream` hook) had zero integration test coverage. Stream behavior (phase progression delivery, late-subscriber snapshot, termination semantics) was undocumented and unverified.

## Solution

Proto-grounded gap analysis: every test is justified by a specific proto contract field or RPC precondition that had zero existing coverage. No tests were invented for coverage numbers.

## Implementation Details

### File 1: `agent_execution_12_lifecycle_edge_cases_test.go` (4 tests)

| Test | Proto Contract |
|------|---------------|
| `RecoverCancelled_Rejected` | Recover precondition: CANCELLED is not recoverable |
| `RecoverCompleted_Rejected` | Recover precondition: only FAILED is recoverable |
| `RecoverTerminated_Rejected` | Recover precondition: TERMINATED has incomplete checkpoint |
| `RapidFireExecutions_AllComplete` | Concurrent execution creation: no lost/corrupted executions |

### File 2: `agent_execution_13_tool_calls_test.go` (2 tests)

| Test | Proto Fields Verified |
|------|----------------------|
| `ToolCall_ProtoFieldContract` | `id`, `name`, `args` (Struct), `result`, `status` (COMPLETED), `started_at`, `completed_at`, `mcp_server_slug` |
| `ToolCall_FailedStatus_HasError` | `status` (FAILED vs COMPLETED), `error` field population on tool failure |

### File 3: `agent_execution_14_streaming_test.go` (2 tests)

| Test | Streaming Behavior Verified |
|------|----------------------------|
| `Subscribe_DeliversPhaseProgression` | Stream delivers 2+ events with monotonic phase progression ending in terminal |
| `Subscribe_TerminalExecution_ReturnsSnapshot` | Late subscriber receives initial DB snapshot; breaks client-side (server hangs after snapshot) |

### Critical Discovery: Agent Execution Pause/Resume Gap

Investigation revealed the TS unified runner's `ExecuteDeepAgent` activity does not handle Temporal activity cancellation for pause. The orchestrator layer (Java/Go) is complete, but the runner catches `CancelledFailure` as a generic error and persists `EXECUTION_FAILED`, overwriting the `EXECUTION_PAUSED` phase. Follow-up workstream documented in `next-task.md` with 7 implementation steps.

## Benefits

- **Proto contract regression protection**: 8 new tests covering fields and preconditions that the SDK and web console depend on
- **Streaming RPC validation**: first integration coverage for the real-time execution viewer data path
- **Architecture gap documented**: pause/resume broken-ness surfaced with clear remediation plan rather than remaining a silent failure

## Impact

- **Test infrastructure**: Integration suite grows by 8 tests (29 total for Workstream C across 3 sessions)
- **SDK consumers**: ToolCall structural contract now verified — prevents silent regressions in `@stigmer/react` rendering
- **Web console**: Subscribe streaming behavior documented and tested for the first time
- **Follow-up**: Agent execution pause/resume identified as a separate workstream requiring TS runner changes

## Related Work

- Prior Workstream C sessions: `agent_execution_11_conversation_journey_test.go`, `session_lifecycle_test.go`, `agent_crud_test.go` (21 tests)
- Workstream B (orchestrator rewrite): `_changelog/2026-05/2026-05-21-174307-workstream-b-orchestrator-rewrite-pause-resume.md`
- Plan: `.cursor/plans/workstream_c_integration_tests_f07fad0d.plan.md`

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour)
