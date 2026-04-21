# Dispatch Integration: AgentRunner-Aware Execution Routing

**Date**: April 21, 2026

## Summary

Wired the AgentRunner resource into the agent execution workflow so that executions route Python activities to per-runner Temporal task queues when a session has a bound runner. This is the dispatch integration (Phase 1, item 10) that connects the AgentRunner aggregate (Sessions 5-7) to the actual execution path. Backward-compatible: executions without a bound runner use the global shared queue exactly as before.

## Problem Statement

With AgentRunner established as a first-class resource (proto in Session 5, Java aggregate in Session 6, Go controller in Session 7), the execution workflow had no awareness of it. All executions routed to a single shared Temporal queue (`agent_execution_runner`), meaning any runner pod could pick up any execution. There was no way to direct work to a specific runner, which is the foundation for persistent runners, per-user runners, and the eventual credential-free runtime.

### Pain Points

- No per-runner routing: all Python activities went to a global shared queue
- `SessionSpec.agent_runner_id` existed in proto but was unused by the execution path
- `AgentExecutionStatus.agent_runner_id` existed for observability but was never populated
- Persistent runners (Phase 3) and ephemeral per-execution runners (Phase 2) both require per-runner queue routing

## Solution

Introduced a dispatch resolution step in the execution create pipeline that reads the session's `agent_runner_id`, loads the AgentRunner resource, verifies it is in an active phase (READY or BUSY), and passes the runner's per-runner task queue to the workflow via the existing memo mechanism. The workflow implementation itself is unchanged — it already reads the queue from memo.

## Implementation Details

### Go (stigmer OSS)

- **New `dispatch.go`**: `ResolveActivityTaskQueue` function that loads session, checks `agent_runner_id`, loads runner, verifies active phase, returns `DispatchResult{TaskQueue, AgentRunnerID}`
- **Modified `workflow_creator.go`**: `Create` now accepts `*DispatchResult`; uses the resolved queue in memo instead of always using global config
- **Modified `create.go`**: `startWorkflowStep` calls dispatch before starting the workflow; maps dispatch errors to `FAILED_PRECONDITION`
- **Modified `workflow_input.go`**: Added `AgentRunnerID` field for observability (carried in Temporal history)

### Dual-Edition Consistency

The Java (stigmer-cloud) implementation mirrors the Go logic exactly:
- `AgentRunnerDispatchService` with identical resolution logic
- `DispatchResult` record with `hasRunner()` convenience
- `RunnerUnavailableException` for fail-fast error semantics
- Same active-phase set (READY, BUSY)
- Same backward-compatible fallback to global queue

## Benefits

- **Per-runner routing works**: sessions with `agent_runner_id` route to `agent-runner:{runner-id}` queue
- **Zero regression**: sessions without a runner binding behave identically to before
- **Fail-fast on unavailable runners**: explicit runner choice that can't be honored returns `FAILED_PRECONDITION` rather than silently falling back
- **Observability**: `agentRunnerId` on the workflow input records which runner was dispatched to in Temporal history
- **Foundation for items 11-14**: RunnerLauncher, runner auth migration, heartbeat client, and idle self-termination all build on this dispatch plumbing

## Impact

- **Agent execution path**: both Go and Java create pipelines now resolve runner before starting workflow
- **Temporal workflow**: no changes — already reads queue from memo; memo value now varies per execution
- **Python agent-runner**: no changes — still polls same queue(s), still creates its own sandbox
- **Proto**: no changes — fields already existed from Session 5

## Related Work

- Session 5: AgentRunner proto definition (`_changelog/2026-04/2026-04-20-213108-agentrunner-proto-resource-definition.md`)
- Session 6: AgentRunner Java aggregate (stigmer-cloud commit `fbafc288`)
- Session 7: AgentRunner Go controller (`_changelog/2026-04/2026-04-21-105048-agentrunner-go-controller-implementation.md`)
- Next: Item 11 — RunnerLauncher abstraction (KubernetesJobRunnerLauncher + DaytonaSandboxRunnerLauncher)

---

**Status**: Production Ready
**Timeline**: Session 8 (1 session)
