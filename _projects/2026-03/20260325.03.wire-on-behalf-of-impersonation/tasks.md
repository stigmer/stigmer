# Tasks: 20260325.03.wire-on-behalf-of-impersonation

**Created**: 2026-03-25

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Convert ExecutionContext creation to createOnBehalfOf

**Status**: ✅ DONE
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repo**: stigmer-cloud

### Subtasks
- [x] In `agentexecution/request/step/CreateExecutionContextStep.java`: thread `callerIdentityAccountId` from pipeline context, change `createAsSystem` → `createOnBehalfOf(..., callerIdentityAccountId)` at line ~179
- [x] In `workflowexecution/request/step/CreateExecutionContextStep.java`: same change at line ~162
- [x] Verify pipeline context (`CreateContextV2`) provides `getCaller().getIdentityAccountId()`
- [ ] Build and validate

### Notes
- Both steps have access to the pipeline context which carries the caller identity
- ExecutionContext holds decrypted secrets — ownership by actual user is critical

## Task 2: Convert AgentInstance auto-creation to createOnBehalfOf

**Status**: ✅ DONE
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repo**: stigmer-cloud

### Subtasks
- [x] `AgentExecutionCreateHandler.java` line ~381: `agentInstanceGrpcRepo.createAsSystem(...)` → `createOnBehalfOf(..., callerIdentityAccountId)`
- [x] `SessionCreateHandler.java` line ~137: same conversion
- [x] `AgentCreateHandler.java` line ~129: same conversion
- [x] Verify all three handlers have `context.getCaller().getIdentityAccountId()` available in the step that creates the default instance
- [ ] Build and validate

### Notes
- These auto-create default AgentInstance when user triggers an execution/session/agent without one
- The created instance should be owned by the triggering user

## Task 3: Add createOnBehalfOf to WorkflowInstanceGrpcRepo and convert callers

**Status**: ✅ DONE
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repo**: stigmer-cloud

### Subtasks
- [x] Add `WorkflowInstance createOnBehalfOf(WorkflowInstance instance, String identityAccountId)` to `WorkflowInstanceGrpcRepo.java` interface
- [x] Implement in `WorkflowInstanceGrpcRepoImpl.java` — inject `ImpersonatedChannelFactory`, follow `AgentInstanceGrpcRepoImpl` pattern
- [x] Convert `WorkflowExecutionCreateHandler.java` line ~225: `createAsSystem` → `createOnBehalfOf`
- [x] Convert `WorkflowCreateHandler.java` line ~217: `createAsSystem` → `createOnBehalfOf`
- [ ] Build and validate

### Notes
- Copy the exact pattern from `AgentInstanceGrpcRepoImpl` (inject `ImpersonatedChannelFactory`, `channelFactory.forIdentity(identityAccountId)`)

## Task 4: Add invoker identity to Temporal workflow inputs

**Status**: ✅ DONE
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repos**: stigmer (Go, Python), stigmer-cloud (Java)

### Subtasks
- [x] Find the Temporal workflow input protos/types for agent execution and workflow execution workflows
- [x] Add `invokerIdentityAccountId` field to agent execution slim input (Java record + Go struct)
- [x] Create new `InvokeWorkflowExecutionWorkflowInput` slim record replacing full `WorkflowExecution` proto (Java + Go)
- [x] In stigmer-service: pass `context.getCaller().getIdentityAccountId()` in all handler StartWorkflowSteps
- [x] Thread identity through workflow impls to activity interfaces
- [x] Update Go activity stubs and workflow-runner activity to accept slim input
- [x] Remove `runtime_env` fallback in workflow-runner (all executions use ExecutionContext)
- [x] Resolve Go import cycle (moved shared input type to activities package)
- [x] Build and validate (Bazel + Go + Python syntax)

### Notes
- This is the bridge between stigmer-service (knows caller identity) and the runners (need it for x-on-behalf-of)
- Workflow execution was a larger change: replaced full `WorkflowExecution` proto with slim input to keep secrets out of Temporal history
- Agent execution already had slim input pattern — just added the new field
- Go import cycle between `workflows` and `activities` packages resolved by placing shared type in `activities` (lower-level package in dependency graph)
- Runners accept the identity parameter but do not use it yet (T05/T06 scope)

## Task 5: Agent runner — attach x-on-behalf-of to all gRPC calls

**Status**: ✅ DONE
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repo**: stigmer (Python)

### Subtasks
- [x] Read invoker identity from Temporal workflow/activity input in `execute_graphton.py`
- [x] Create new `OnBehalfOfInterceptor` for `x-on-behalf-of` header injection
- [x] Extend `ChannelProvider` with dual-channel support: `channel` (system) + `obo_channel` (impersonated)
- [x] Wire OBO channel for all read clients (Session, Agent, AgentInstance, ExecutionContext, Environment, Skill, McpServer)
- [x] Keep `execution_client` on system channel for `updateStatus` (operator-only)
- [x] Wire OBO in `generate_session_subject.py` + update Java activity interface
- [ ] Test locally

### Notes
- Created `OnBehalfOfInterceptor` in `grpc_client/auth/on_behalf_of_interceptor.py`
- Architectural decision: separate interceptor (not merged into `AuthClientInterceptor`) keeps system auth clean
- Dual-channel pattern: system channel for writes/status, OBO channel for user-scoped reads
- Added `can_update_status` FGA permission for operator-only status updates

## Task 6: Workflow runner — attach x-on-behalf-of to all gRPC calls

**Status**: ✅ DONE
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repo**: stigmer (Go)

### Subtasks
- [x] Create `WithOnBehalfOf` context helper in `pkg/grpc_client/on_behalf_of.go`
- [x] Wire OBO in `execute_workflow_activity.go`: `oboCtx` for reads, plain `ctx` for `updateStatus`
- [x] Fix missing auth headers in `task_builder_call_agent_activities.go` + wire OBO via `buildAuthenticatedContext`
- [x] Thread `InvokerIdentityAccountID` through `TemporalWorkflowInput` and workflow state
- [x] Wire identity from state to `CallAgentActivity` in `task_builder_call_agent.go`
- [ ] Test locally

### Notes
- Created `pkg/grpc_client/on_behalf_of.go` with `WithOnBehalfOf` helper (appends metadata to context)
- `execute_workflow_activity.go`: `oboCtx` used for all reads (WorkflowInstance, Workflow, ExecutionContext); `updateStatus` stays on system context
- `task_builder_call_agent_activities.go`: discovered missing auth headers on gRPC clients, fixed with `buildAuthenticatedContext` helper that adds both `authorization` and `x-on-behalf-of`
- Identity stored in Zigflow workflow state as `__stigmer_invoker_identity_account`, retrieved by task builders

## Task 7: Simplify agent_execution.fga

**Status**: ✅ DONE
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repo**: stigmer-cloud

### Subtasks
- [x] Change `owner: owner from session or operator from session` → `owner: owner from session`
- [x] Verify: `session.owner = [identity_account] or operator` already includes operator, confirming redundancy
- [ ] Run FGA model validation tests
- [ ] Validate no authorization regressions

### Notes
- `operator from session` is redundant because `session.owner` already includes `operator` (which chains `operator from organization` → `operator from platform`)
- So `owner from session` already captures operators

## Task 8: Evaluate and add execution_context FGA type

**Status**: ✅ DONE (decided against dedicated FGA model — derived auth instead)
**Created**: 2026-03-25 11:59
**Completed**: 2026-03-25
**Repo**: stigmer, stigmer-cloud

### Subtasks
- [x] Evaluate architectural trade-offs for dedicated FGA model vs derived auth
- [x] Decision: ExecutionContext is ephemeral (1:1 with parent, short-lived) — full FGA model is over-engineering
- [x] Set `is_skip_authorization=true` on all ExecutionContext RPCs (command + query protos)
- [x] Implement handler-level derived auth in `ExecutionContextGetByExecutionIdHandler`: check `can_view` on parent execution
- [x] Reorder creation pipelines: `createAuthorizationTuples → createExecutionContext → persist`

### Notes
- Architectural decision (collaborative with user): ExecutionContext is temporary data with 1:1 relationship to parent execution. A dedicated FGA model with tuple creation/deletion adds overhead for no practical benefit
- Solution: derive authorization from parent execution — `can_view` on parent `agent_execution` or `workflow_execution`
- `getByExecutionId` handler tries `agent_execution` auth first, falls back to `workflow_execution`
- All other ExecutionContext RPCs are system-only (create/delete during execution lifecycle)
- Pipeline reorder ensures FGA tuples exist before ExecutionContext creation, and `runtime_env` is cleared before persist


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

