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

**Status**: ⏸️ TODO
**Created**: 2026-03-25 11:59
**Repo**: stigmer (Python)

### Subtasks
- [ ] Read invoker identity from Temporal workflow/activity input in `execute_graphton.py`
- [ ] Modify `AuthClientInterceptor` (or create new interceptor) to attach `x-on-behalf-of` metadata key alongside `authorization`
- [ ] Thread the identity through to all gRPC client instantiations (`ChannelProvider` or interceptor-level)
- [ ] Verify all 8 gRPC clients get the header: ExecutionContext, AgentExecution, Agent, AgentInstance, Session, Environment, Skill, McpServer
- [ ] Also cover `generate_session_subject.py` and `sandbox_manager.py` activity paths
- [ ] Test locally

### Notes
- The metadata key is `x-on-behalf-of` (defined in `OnBehalfOfMetadata.java`)
- Best approach: add to `AuthClientInterceptor` so all clients get it automatically
- The `STIGMER_API_KEY` (Bearer token) stays — it authenticates the machine account; the OBO header overrides the effective identity

## Task 6: Workflow runner — attach x-on-behalf-of to all gRPC calls

**Status**: ⏸️ TODO
**Created**: 2026-03-25 11:59
**Repo**: stigmer (Go)

### Subtasks
- [ ] Read invoker identity from Temporal workflow/activity input in `execute_workflow_activity.go`
- [ ] Add `x-on-behalf-of` to gRPC metadata in all client calls (via shared interceptor or per-client metadata append)
- [ ] Verify all clients get the header: ExecutionContext, Workflow, WorkflowInstance, WorkflowExecution (UpdateStatus)
- [ ] Also cover `progress_interceptor.go` (UpdateStatus on each task step)
- [ ] Cover `task_builder_call_agent_activities.go` (GetByReference, Create AgentExecution)
- [ ] Test locally

### Notes
- Go clients use `metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+apiKey)` — add `x-on-behalf-of` alongside it
- `task_builder_call_agent_activities.go` has its own `initGrpcConnection` that doesn't use `pkg/grpc_client` — needs separate handling

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

**Status**: ⏸️ TODO
**Created**: 2026-03-25 11:59
**Repo**: stigmer-cloud

### Subtasks
- [ ] Confirm no `type execution_context` exists in any `.fga` file (verified in analysis)
- [ ] Design FGA type: child of agent_execution OR workflow_execution with inherited view/edit
- [ ] Create `execution_context.fga` in `fga/model/agentic/`
- [ ] Update proto `AuthorizationConfig` for execution_context kind to use PARENT scope
- [ ] Wire into `CreateAuthorizationTuplesStepV2` flow
- [ ] Run FGA model validation tests

### Notes
- ExecutionContext holds decrypted secrets — most sensitive resource in the system
- Currently has zero FGA protection (relies on transport-level auth only)
- Proposed model: `session` as parent for agent-exec contexts, `organization` scope for workflow-exec contexts
- Alternative: single parent relation to either agent_execution or workflow_execution


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

