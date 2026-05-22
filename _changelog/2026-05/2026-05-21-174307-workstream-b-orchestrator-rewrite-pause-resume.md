# Workstream B: Java + Go Orchestrator Rewrite with Signal-Based Pause/Resume

**Date**: May 21, 2026

## Summary

Rewrote both Java (Cloud) and Go (OSS) workflow execution orchestrators to dispatch child workflows to the unified TS runner instead of calling the deleted Go `ExecuteWorkflow` activity. Implemented signal-based pause/resume leveraging Temporal-native durability — the engine pauses at task boundaries via `condition()` blocking, with no external checkpoint infrastructure needed. Unified all runner queues under `stigmer_runner`. Fixed 24 broken integration test files (54 references to deleted `WorkflowRunner` field).

## Problem Statement

The old Go `workflow-runner` was deleted (May 21, 2026 — 322K lines). The Java/Go orchestrators still dispatched to the deleted `ExecuteWorkflow` activity on the `workflow_execution_runner:wf-orch` queue. Workflow execution through the Java service (the production path) was broken. Additionally, the Go OSS orchestrator lacked signal handling for LISTEN/human_input tasks, and 24 integration test files failed to compile.

### Pain Points

- Workflow execution completely broken — orchestrators dispatched to a deleted activity on a queue nobody polls
- 24 integration test files (54 occurrences) referenced deleted `testHarness.WorkflowRunner` field
- Go OSS orchestrator had no signal handling — LISTEN/human_input tasks couldn't receive signals
- Queue naming was fragmented (`agent_execution_runner`, `workflow_execution_runner`, `:wf-orch`, `:wf-exec`)
- Pause/resume was planned (Gap C1) but never delivered — Java code had CancellationScope structure but the Go engine lacked checkpoint support
- Documentation referenced deleted Go runner, LangGraph checkpoints for workflows, and old queue suffix architecture

## Solution

Five-part implementation:

1. **TS Engine Pause/Resume (B.0)** — Added `checkPause` yield points to the CNCF engine between tasks, for-each iterations, and try retries. Created shared signal definitions (`workflow-signals.ts`) with Temporal `defineSignal` + `setHandler` + `condition()` blocking. Both workflow entry points (`execute-from-execution`, `execute-serverless-workflow`) register pause/resume handlers.

2. **Java Orchestrator Rewrite (B.1)** — Replaced `ExecuteWorkflowActivity` remote activity stub with `Workflow.newUntypedChildWorkflowStub("stigmer/workflow/execute-from-execution")`. Removed CancellationScope pause/resume loop (~80 lines). Signal handlers now update execution status and relay directly to child workflow. Added `Workflow.getVersion("child-workflow-migration")` for deterministic replay safety. Deleted `ExecuteWorkflowActivity.java`. Removed `:wf-orch`/`:wf-exec` suffix system.

3. **Go Orchestrator Rewrite (B.2)** — Replaced activity call with `workflow.ExecuteChildWorkflow`. Added signal handling (previously missing in Go OSS): pause, resume, and relaySignal channels via `workflow.Go()` goroutines. Added version gate. Updated agent execution config to `stigmer_runner` for parity.

4. **Test Fixes + Harness (B.3)** — Replaced 54 `testHarness.WorkflowRunner` → `testHarness.UnifiedRunner` references across 24 test files. Changed harness queue from `agent_execution_runner` to `stigmer_runner`.

5. **Documentation Cleanup (B.4)** — Fixed stale references to LangGraph checkpoints, Go workflow-runner, and queue suffix architecture in `pause.go`, `resume.go`, `README.md`, and `IMPLEMENTATION_SUMMARY.md`.

## Implementation Details

### Signal-Based Pause/Resume Architecture

The key architectural insight: the TS engine runs as a Temporal **workflow** (not an activity like the old Go engine). Each task result is in Temporal history. Temporal's workflow history IS the checkpoint — no external checkpoint store needed.

```
Pause flow:
  API → outer orchestrator (Java/Go) → updateStatus(PAUSED) → signal child "pause"
  → child's checkPause callback → condition(() => !paused) → blocks

Resume flow:
  API → outer orchestrator → updateStatus(RUNNING) → signal child "resume"
  → paused = false → condition resolves → engine continues from next task
```

Worker crash while paused: Temporal replays workflow, signal events restore `paused=true`, `condition()` blocks again. Fully durable.

### Queue Unification

All runner work routes to `stigmer_runner`. The old domain-specific queues (`agent_execution_runner`, `workflow_execution_runner`) and suffix system (`:wf-orch`, `:wf-exec`) are eliminated. Single queue for the unified runner, single name across both repos.

### New Files

- `backend/services/runner/src/workflows/workflow-signals.ts` — Shared pause/resume signal definitions and handler setup
- `backend/services/runner/src/workflow-engine/__tests__/pause-resume.test.ts` — 8 engine-level pause/resume tests
- `backend/services/stigmer-server/.../workflows/invoke_workflow_impl_test.go` — 7 Go orchestrator tests
- `stigmer-cloud/.../workflow/InvokeWorkflowExecutionWorkflowImplTest.java` — 7 Java orchestrator tests

### Architectural Decisions

- **AD-B1**: Single queue `stigmer_runner` — unified runner handles all work types
- **AD-B2**: Signal-based pause/resume — Temporal-native, no external checkpointing
- **AD-B3**: Drop return value — progressive gRPC updates are the status mechanism
- **AD-B4**: Add Go signal handling — fixes pre-existing gap for LISTEN/human_input
- **AD-B5**: Remove WorkflowRunTimeout — pause-compatible, matches agent execution pattern
- **AD-B6**: Temporal workflow versioning — deterministic replay for in-flight workflows
- **AD-B7**: Memo key rename — `activityTaskQueue` → `runnerTaskQueue`

## Benefits

- Workflow execution path restored — Java/Go orchestrators dispatch to the unified TS runner
- Signal-based pause/resume works without external checkpoint infrastructure (~50 lines vs ~1000+)
- Pause is durable across worker crashes via Temporal replay
- Go OSS now has signal handling parity with Java (LISTEN/human_input tasks work)
- Queue naming simplified — one name (`stigmer_runner`) across all configs
- 24 broken test files now compile
- Stale documentation corrected

## Impact

| Component | Change |
|-----------|--------|
| TS runner engine | `checkPause` yield points in do-executor, for, try |
| TS runner workflows | Pause/resume signal handlers, `workflow-signals.ts` |
| TS runner config | Default queue → `stigmer_runner` |
| Java orchestrator | Activity → child workflow, signal forwarding, CancellationScope removed |
| Go orchestrator | Activity → child workflow, signal handling added |
| Agent execution config (Go + Java) | Queue → `stigmer_runner` |
| Integration tests | 24 files fixed (54 references), harness queue updated |
| Kustomize overlays | Both queue env vars → `stigmer_runner` |
| Documentation | 4 files updated (pause.go, resume.go, README, IMPLEMENTATION_SUMMARY) |

## Related Work

- [TS Hydration Activity and Wrapper Workflow](2026-05-21-164357-ts-hydration-activity-wrapper-workflow.md) — Workstream A (prerequisite)
- [Delete Legacy Runners, Migrate Integration Harness](2026-05-21-153507-delete-legacy-runners-migrate-integration-harness.md) — Legacy runner deletion that created the gap
- Pre-deploy integration test expansion project — `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/`

---

**Status**: Production Ready (pending integration test validation)
**Timeline**: ~1.5 hours (single session, 4 parallel workstreams)
