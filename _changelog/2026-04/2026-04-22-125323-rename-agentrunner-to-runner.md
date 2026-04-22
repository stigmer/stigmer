# Rename AgentRunner to Runner

**Date**: April 22, 2026

## Summary

Renamed the `AgentRunner` resource to `Runner` across the entire codebase — protos, generated stubs, Go server, Python agent-runner, CLI, SDKs, and codegen schemas. Runner is not agent-specific; workflow executions will use the same resource model. Also removed `sandbox_id` from both `RunnerStatus` (replaced with metadata label) and `SessionSpec` (deprecated), and fixed the `not_search_indexed` flag.

## Problem Statement

The `AgentRunner` name implied the resource was agent-specific, but the same authentication pattern, proxy routing, heartbeat protocol, and lifecycle management apply equally to workflow runners. The resource type should be runner-agnostic — the Docker image is what differs, not the resource.

### Pain Points

- `AgentRunner` naming blocked reuse for workflow execution without conceptual confusion
- `sandbox_id` on `RunnerStatus` leaked a Daytona-specific implementation detail into the API contract
- `sandbox_id` on `SessionSpec` was dead code — the `sandbox_manager.py` that used it was deleted in the Daytona removal session
- `not_search_indexed: false` contradicted the implementation decision that runners are infrastructure, not searchable content

## Solution

Renamed the resource from `AgentRunner` to `Runner` across all layers. Moved `sandbox_id` from a status field to a metadata label (`stigmer.ai/sandbox-id`) for launcher-agnostic infrastructure tracking. Deprecated the session-level `sandbox_id` field and removed its dedicated RPC.

## Implementation Details

### Proto changes (6 new files, 4 cross-reference updates)

- New package `apis/ai/stigmer/agentic/runner/v1/` with `Runner`, `RunnerStatus`, `RunnerSpec`, `RunnerPhase`, `RunnerHeartbeatInput`, `RunnerId`, `RunnerCommandController`, `RunnerQueryController`
- `RunnerStatus.sandbox_id` removed, field 7 reserved — launcher uses `stigmer.ai/sandbox-id` metadata label instead
- `ApiResourceKind`: `agent_runner` -> `runner`, id prefix `arn` -> `rnr`, `not_search_indexed: true`
- `SessionSpec.agent_runner_id` -> `runner_id`; `sandbox_id` marked `[deprecated = true]`
- `AgentExecutionStatus.agent_runner_id` -> `runner_id`
- `IamPermission.can_create_agent_runner` -> `can_create_runner`
- `updateSandboxId` RPC and `UpdateSessionSandboxIdRequest` removed from Session
- Old `agentrunner/v1/` package deleted

### Go server (stigmer-server)

- Controller package moved from `agentrunner/` to `runner/`
- `RunnerController`, `NewRunnerController`, pipeline names `runner-*`
- Task queue prefix changed from `agent-runner:` to `runner:`
- Dispatch: `RunnerID` field, `GetRunnerId()`, `RUNNER_PHASE_*` enums
- `update_sandbox_id.go` deleted from session controller

### Java server (stigmer-cloud)

- Domain package moved from `agentrunner/` to `runner/`: 10 handler classes, repo, auto-controller
- Downstream gRPC: `RunnerGrpcRepo`, `RunnerGrpcRepoImpl`
- Dispatch: `RunnerDispatchService`, `DispatchResult.runnerId`
- Sandbox migration: `DaytonaSandboxRunnerLauncher` writes `stigmer.ai/sandbox-id` label on metadata instead of `status.sandbox_id`; `DeprovisionInfrastructureStep` reads from labels
- FGA: `runner.fga`, `can_create_runner`
- MongoDB: collection renamed from `agent_runner` to `runner`, migration updated in-place

### Python agent-runner

- `class AgentRunner` -> `class Runner`; `runner_client.py` with `RunnerClient`
- Config: `runner_id` field, `STIGMER_RUNNER_ID` env var
- Dead `update_sandbox_id()` method removed from session client

### CLI

- `RunnerPIDFileName`, `bootstrapRunnerRuntime`, `buildRunnerEnv`, `downloadRunnerBinary`, `GetRunnerBinary`
- File renamed: `runner_native.go`

### Generated code (via `make codegen` / `make protos`)

- All stubs regenerated across Go, Java, Python, TypeScript, Dart
- SDKs regenerated: Go, Java, Python, TypeScript
- MCP server, codegen schemas, docs all updated

## Benefits

- Runner resource is now reusable for both agent and workflow executions without naming confusion
- `sandbox_id` on status no longer couples the API contract to a specific launcher implementation
- Session proto is cleaner — deprecated field will age out naturally
- Search index no longer processes runner documents (runners are infrastructure)

## Impact

- **Proto wire compatibility**: `runner_id` replaces `agent_runner_id` at the same field numbers — feature branch only, no production wire break
- **MongoDB**: collection rename is safe since the feature branch has no deployed data
- **FGA**: permission rename is coordinated with the model file

## Related Work

- Part of the `20260420.01.agent-runner-as-resource` project
- Builds on Sessions 5-17 which established the AgentRunner resource
- Enables future workflow runner integration without resource duplication

---

**Status**: Production Ready
**Timeline**: 1 session
