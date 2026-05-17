# Workflow Runner Sandbox Integration (Phases 1-4b)

**Date**: May 15, 2026

## Summary

Added the workflow-runner to the Daytona sandbox image alongside agent-runner and cursor-runner, made the Java orchestration layer runner-queue-aware for workflow executions (matching the existing agent execution pattern), and enabled co-located agent execution from within workflows via `preferred_runner_id` so `call: agent` tasks reuse the same sandbox instead of spinning up new ones.

## Problem Statement

The workflow-runner ran as a standalone K8s pod polling global Temporal queues. This meant no execution isolation, no co-location with agent-runner, and every `call: agent` task within a workflow provisioned a separate Daytona sandbox -- adding cold-start latency and wasting resources.

### Pain Points

- Workflow-runner not in sandbox image -- cloud workflows depended on a separately-deployed K8s pod
- All workflow executions shared one Go worker pod (no isolation)
- Agent calls from workflows provisioned separate sandboxes instead of using the co-located agent-runner
- No per-runner queue support for workflow executions (unlike agent executions)

## Solution

Unified all three runners in a single Daytona sandbox image with per-runner queue derivation from `STIGMER_TASK_QUEUE`, and added `preferred_runner_id` on `AgentExecutionSpec` for co-located agent routing.

## Implementation Details

### Phase 1: Sandbox Image (stigmer repo)

- Added `workflow-runner-builder` Docker build stage to `Dockerfile.sandbox.full` -- compiles the Go binary with CGO_ENABLED=0
- Binary is copied to `/workflow-runner/workflow-runner` in the final image
- Updated CI trigger paths in `release.sandbox-cloud.yaml` to include `backend/services/workflow-runner/**` and `apis/stubs/go/**`

### Phase 2: Queue Derivation (stigmer repo)

- `worker/config/config.go`: When `STIGMER_TASK_QUEUE` is set (cloud/sandbox mode), derives `:wf-orch` and `:wf-exec` queue suffixes from the base queue. Validation queue is not registered in sandbox mode (global K8s pod handles it).
- `worker/worker.go`: Validation worker creation and registration are conditional on `!SandboxMode`
- Added `BaseTaskQueue`, `SandboxMode`, `RunnerID` fields to Config

### Phase 3: Proto Changes (both repos)

- `AgentExecutionSpec`: Added `preferred_runner_id` (field 11) for co-located agent execution routing
- `RunnerHeartbeat`: Added `process_type` (field 5) for future server-side idle aggregation across multi-process sandboxes
- All language stubs regenerated (Go, Java, Python, TypeScript)

### Phase 4: Java Dispatch (stigmer-cloud repo)

- New `WorkflowExecutionDispatchService`: provisions ephemeral runners for workflow executions (mirrors `RunnerDispatchService` pattern)
- New `WorkflowDispatchResult`: carries base queue + runner ID, derives `:wf-orch` and `:wf-exec` suffixes
- `InvokeWorkflowExecutionWorkflowCreator`: accepts `WorkflowDispatchResult`, passes base queue via Temporal memo
- `InvokeWorkflowExecutionWorkflowImpl`: derives `:wf-orch` suffix from memo base queue, increased `ScheduleToStartTimeout` to 5min for sandbox boot
- `WorkflowExecutionCreateHandler.StartWorkflowStep`: calls dispatch service before starting workflow

### Phase 4b: Co-located Agent Routing (both repos)

- Go: `CallAgentActivities.createAgentExecution` passes `STIGMER_RUNNER_ID` as `preferred_runner_id`
- Java: `RunnerDispatchService.resolvePreferredRunner()` validates runner exists and is active, returns its queue
- Java: `AgentExecutionCreateHandler.StartWorkflowStep` checks `preferred_runner_id` before normal dispatch resolution

### Cloud Config Changes (stigmer-cloud repo)

- `application-runner-launcher.yaml`: Start command extended to include workflow-runner; removed `idle-timeout-seconds` (lifecycle moving to server-side aggregation in Phase 5)
- `RunnerLauncherConfig.java`: Removed `idleTimeoutSeconds` field
- `DaytonaSandboxRunnerLauncher.java`: Removed `STIGMER_IDLE_TIMEOUT_SECONDS` env var injection

## Pending Work (Next Session)

- **Phase 5**: Unified sandbox lifecycle -- server-side idle aggregation across all runner processes, remove Python idle watchdog
- **Phase 6**: Integration testing -- update existing LLM/agent call tests, add sandbox co-location tests

## Benefits

- **Unified sandbox**: All three runners (agent, cursor, workflow) co-located in one Daytona sandbox
- **Zero cold-start for agent calls**: Workflows reuse the co-located agent-runner via `preferred_runner_id`
- **Per-execution isolation**: Each workflow execution gets its own sandbox (matching agent execution pattern)
- **Cloud-ready**: Workflow-runner in sandbox needs only `STIGMER_TASK_QUEUE` + credentials

## Impact

- **Sandbox image**: Gains workflow-runner binary (~30-50MB static Go binary)
- **Workflow executions**: Now provision ephemeral sandboxes (like agent executions)
- **Agent calls from workflows**: Route to co-located agent-runner (no new sandbox)
- **Validation**: Unchanged -- stays on global K8s pod

## Related Work

- Workflow-runner LLM proxy integration (same day, earlier session)
- Agent-runner sandbox provisioning (existing `DaytonaSandboxRunnerLauncher` pattern)
- E2E workflow testing infrastructure (project `20260514.01`)

---

**Status**: In Progress (Phases 1-4b complete, Phases 5-6 pending)
**Timeline**: ~2 hours implementation
