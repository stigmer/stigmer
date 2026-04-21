# Next Task: 20260420.01.agent-runner-as-resource

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260420.01.agent-runner-as-resource

**Description**: Promote AgentRunner to a first-class API resource with orthogonal lifecycle/scope/placement axes; introduce a Stigmer Side-Channel Proxy that injects all platform secrets so runners carry only the user JWT; eliminate the can_impersonate machine-account model; unify per-execution sandbox and agent-runner into a single Daytona container; enable browser-launched local runners via stigmer:// URL scheme.
**Goal**: Eliminate the platform-wide can_impersonate superpower for agent execution by making every agent-runner authenticate as the triggering user and routing all infrastructure secrets through a Stigmer-hosted side-channel proxy that the runner never sees.
**Tech Stack**: Java/Spring Boot WebFlux (stigmer-service), Python (agent-runner), Protobuf, OpenBAO/Vault, Daytona, Temporal, Auth0, Tauri/Go (CLI/Desktop)
**Components**: apis/ai/stigmer/agentic/agentrunner/v1 (new proto resource); backend/services/stigmer-service (proxy endpoints, AgentRunner aggregate, dispatch logic, RunnerLauncher abstraction); backend/services/agent-runner (remove machine account, point clients at proxy, run inside Daytona); client-apps/cli and Stigmer Desktop (stigmer:// URL handler, register-as-AgentRunner flow); cloud frontend (AgentRunner UI for Persistent runners)

## Current State
- **Status**: Phase 0 code complete; Phase 1 Java aggregate complete; Phase 1 Go aggregate complete; Phase 1 dispatch integration complete; Phase 2 Daytona gates validated
- **Last Session**: 2026-04-21 — Dispatch integration in both repos (Session 8)
- **Active Task**: Phase 1 item 11 — RunnerLauncher abstraction

## Session Progress (2026-04-21, Session 8 — Dispatch Integration)

### Accomplished
- Implemented complete dispatch integration in both stigmer and stigmer-cloud (item 10 from Phase 1)
- Created `AgentRunnerDispatchService` in stigmer-cloud: resolves session → agent_runner_id → runner phase → task queue
- Created `DispatchResult` record and `RunnerUnavailableException` for fail-fast error semantics
- Modified `InvokeAgentExecutionWorkflowCreator` (both Java and Go) to accept dispatch result and route to per-runner queue
- Modified `StartWorkflowStep` in both editions to call dispatch before starting the workflow
- Added `agentRunnerId` to `InvokeAgentExecutionWorkflowInput` (both Java record and Go struct)
- Backward-compatible: no runner binding → global queue (identical to pre-dispatch behavior)
- `go build ./...` passes cleanly; `go vet` passes cleanly
- Bazel build: only 2 pre-existing strict-dep errors (HttpSecurityConfig, LlmProxyController — Phase 0 work, unrelated)

### Key Decisions Made
34. **BUSY runners accept routed work** — the session was bound when the runner was READY; by execution time it might be BUSY. Temporal handles queuing. Session-runner binding is intentional and should not be silently overridden.
35. **Fail fast on unavailable runner** — when a session explicitly references a runner in FAILED/STOPPED/PENDING/deleted state, the execution fails with FAILED_PRECONDITION. The user chose this runner; silently falling back to global would be surprising.
36. **agentRunnerId on workflow input, not pipeline DB write** — recording runner ID via the workflow (Option B from plan) keeps status updates in the workflow's domain. No extra DB write in the create pipeline.
37. **No FGA check in dispatch** — session authorization happened at creation time. If the user could bind a runner to their session, they can dispatch to it.
38. **RunnerUnavailableException as separate type** — distinct from generic exceptions so StartWorkflowStep maps it to FAILED_PRECONDITION (not INTERNAL).

### Files Created (this session)

**stigmer-cloud (3 new files):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/dispatch/AgentRunnerDispatchService.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/dispatch/DispatchResult.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/dispatch/RunnerUnavailableException.java`

**stigmer (1 new file):**
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go`

### Files Modified (this session)

**stigmer-cloud (3 modified):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowCreator.java` — added dispatch-aware `create(input, dispatch)` overload
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowInput.java` — added `agentRunnerId` field, backward-compatible factory overload
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionCreateHandler.java` — `StartWorkflowStep` now injects `AgentRunnerDispatchService`, resolves queue, catches `RunnerUnavailableException`

**stigmer (3 modified):**
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflow_creator.go` — `Create` now accepts `*DispatchResult`, added `FallbackRunnerQueue()` accessor
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/workflow_input.go` — added `AgentRunnerID` field
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` — `startWorkflowStep` now calls `ResolveActivityTaskQueue` before starting workflow

## Session Progress (2026-04-21, Session 7 — Go AgentRunner Controller Implementation)

### Accomplished
- Implemented complete AgentRunner controller in stigmer OSS (item 9 from Phase 1)
- Created `AgentRunnerController` struct implementing both `AgentRunnerCommandControllerServer` and `AgentRunnerQueryControllerServer`
- Implemented 5 command handlers using the pipeline framework:
  - `Create` with custom `initializeRunnerStatusStep` (sets task_queue + PENDING phase)
  - `Update` with custom `preserveRunnerStatusStep` (status is heartbeat-only)
  - `Delete` (standard delete pipeline)
  - `Apply` (idempotent create-or-update, primary CLI registration path)
  - `Heartbeat` (fully custom: atomic read-modify-write via `store.UpdateResource`, FAILED gate, phase transitions, reactivation timestamps)
- Implemented 3 query handlers:
  - `Get` (standard get by ID via `LoadTargetStep`)
  - `GetByReference` (org+slug resolution via `LoadByReferenceStep`)
  - `List` (custom `listRunnersByOrgAndLabelsStep` with org filtering + AND-semantics label matching)
- Registered AgentRunner controllers in `server.go` (both command + query)
- `go build ./...` passes cleanly; `go vet` passes cleanly
- Dual-edition behavioral consistency verified against Java aggregate (Session 6)

### Key Decisions Made
29. **No search indexing for AgentRunner** — runners are infrastructure, not user-authored content like Agents or Workflows. Consistent with the domain model: search indexes surface blueprints, not runtime infrastructure.
30. **Heartbeat uses `store.UpdateResource` atomic RMW** — not a pipeline. The heartbeat is a single atomic operation: load, validate phase, mutate status, persist. The pipeline framework's step-by-step pattern doesn't fit because the input type (`AgentRunnerHeartbeatInput`) differs from the resource type (`AgentRunner`).
31. **Error handling in heartbeat distinguishes store.ErrNotFound from domain errors** — `UpdateResource` returns `store.ErrNotFound` when the runner doesn't exist, but the `modify` callback returns gRPC status errors (e.g., `FAILED_PRECONDITION`). The handler uses `errors.Is` and `status.FromError` to route correctly.
32. **No FGA/IAM in OSS heartbeat** — consistent with all other OSS handlers. Cloud has `VerifyCallerOwnership` via FGA `can_edit`; OSS skips it.
33. **List handler does not paginate** — consistent with Session list and AgentExecution list in OSS. Proto supports `page_info` for cloud use; OSS returns all matching results.

### Files Created (this session)

**stigmer (9 new files):**
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/agentrunner_controller.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/create.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/update.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/delete.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/apply.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/heartbeat.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/get.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/get_by_reference.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/list.go`

### Files Modified (this session)

**stigmer (1 modified):**
- `backend/services/stigmer-server/pkg/server/server.go` — added import for `agentrunnerv1` and `agentrunnercontroller`, registered both command and query controllers

## Session Progress (2026-04-21, Session 6 — AgentRunner Java Aggregate Implementation)

### Accomplished
- Implemented complete AgentRunner domain aggregate in stigmer-cloud (item 8 from Phase 1)
- Generated Java stubs from OSS protos via `make protos` — all AgentRunner types available in stigmer-cloud
- Created FGA authorization model: `agent_runner.fga` type with org/owner/viewer relations
- Added `can_create_agent_runner: member` to organization.fga (any org member can register a runner)
- Registered `agent_runner.fga` in `fga.mod`
- Created `AgentRunnerRepo` (MongoDB, collection `agent_runner`) with label-filtered queries using `$getField`
- Created `AgentRunnerGrpcAutoController` (annotation-processor marker)
- Implemented 5 command handlers:
  - `AgentRunnerCreateHandler` with custom `InitializeRunnerStatus` step (sets task_queue + PENDING phase)
  - `AgentRunnerUpdateHandler` with custom `PreserveRunnerStatus` step (status is heartbeat-only)
  - `AgentRunnerDeleteHandler` (standard delete pipeline)
  - `AgentRunnerApplyHandler` (idempotent create-or-update, primary CLI registration path)
  - `AgentRunnerHeartbeatHandler` (custom: load, FGA ownership check, phase transition, persist)
- Implemented 3 query handlers:
  - `AgentRunnerGetHandler` (standard get with FGA can_view)
  - `AgentRunnerGetByReferenceHandler` (org+slug resolution, custom auth)
  - `AgentRunnerListHandler` (FGA-filtered query pattern with label AND semantics)
- Created MongoDB index migration: unique (org,slug), unique (id), compound (org,phase)
- Added AgentRunner descriptors to `ProtoFgaSchemaConsistencyTest`
- Bazel build passes for all new AgentRunner code (pre-existing proxy strict dep errors are separate)
- Committed: `fbafc288` on `feat/secrets-vault-migration` branch

### Key Decisions Made
24. **`can_create_agent_runner: member`** — runners are user-managed infrastructure, not admin-controlled resources. Any org member should be able to register their laptop as a runner.
25. **Heartbeat ownership via FGA `can_edit` check** — not metadata comparison, because FGA is the single source of truth for authorization.
26. **FAILED phase blocks heartbeat transitions** — a runner in FAILED phase requires explicit investigation; heartbeat cannot automatically recover it.
27. **Status preservation on update** — the framework's `buildNewState` clears status from input; a custom `PreserveRunnerStatus` step restores status from the existing resource. Status is exclusively managed by heartbeat and server-side transitions.
28. **Audit timestamps not manually set in InitializeRunnerStatus** — the framework's `setAudit` step handles audit info; the custom step only sets domain-specific fields (task_queue, phase).

### Files Created (this session)

**stigmer-cloud (12 new files):**
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent_runner.fga`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/repo/AgentRunnerRepo.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/controller/AgentRunnerGrpcAutoController.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerCreateHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerUpdateHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerDeleteHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerApplyHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerHeartbeatHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerGetHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerGetByReferenceHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerListHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/U20260421_AgentRunnerIndexes.java`

### Files Modified (this session)

**stigmer-cloud (3 modified + 128 total with stubs):**
- `backend/services/stigmer-service/src/main/resources/fga/model/fga.mod` — added agent_runner.fga
- `backend/services/stigmer-service/src/main/resources/fga/model/tenancy/organization.fga` — added can_create_agent_runner: member
- `backend/services/stigmer-service/src/test/java/ai/stigmer/schema/ProtoFgaSchemaConsistencyTest.java` — added AgentRunner descriptors
- All generated stubs across Go, Java, Python, TypeScript, Dart (synced from OSS protos via `make protos`)

## Previous Sessions

### Session 5 (2026-04-20) — AgentRunner Proto Definition

### Accomplished
- Extensive design brainstorm with principal architect and backend engineer roles
- Challenged and refined the original T01 design: dropped lifecycle/placement/runtime enums, dropped max_concurrent_executions spec field, adopted Kubernetes Node pattern (thin spec, rich status)
- Key insight from brainstorm: AgentRunner IS a resource (not just infrastructure) because persistent runners need user-facing CRUD, appear in session composer, and are addressable by name
- Queue is per-runner (`agent-runner:{runner-id}`), not per-user or per-execution
- Both ephemeral (cloud) and persistent (user-created) runners are saved as AgentRunner resources; ephemeral ones labeled `stigmer.ai/system-managed` and hidden from UI
- Created 6 new proto files under `apis/ai/stigmer/agentic/agentrunner/v1/`: api.proto, spec.proto, enum.proto, io.proto, command.proto, query.proto
- Modified 4 existing proto files: ApiResourceKind (agent_runner=46), IamPermission (can_create_agent_runner=25), SessionSpec (agent_runner_id=9), AgentExecutionStatus (agent_runner_id=19)
- Ran `make codegen` — stubs generated across Go, Java, Python, TypeScript, plus SDK clients, MCP server, docs, and schemas (154 files changed)
- `buf lint` passes, `buf breaking` passes (all changes purely additive)

### Key Decisions Made
16. **AgentRunner IS a domain resource, not just infrastructure** — the session composer dropdown, CLI `stigmer runner start`, and platform-for-platforms framing all demand a first-class API resource with CRUD, identity persistence, and per-runner queues.
17. **No lifecycle/placement/runtime enums** — the runner is a process with a name, a queue, and connection info. Cloud vs local is metadata the runner reports via heartbeat, not a spec distinction.
18. **Kubernetes Node pattern** — thin spec (only `description`), rich status (phase, task_queue, heartbeat, capacity, sandbox_id, connection_info). The user declares almost nothing; the runner self-reports everything.
19. **Runner identity persists across restarts** — CLI stores runner ID in `~/.stigmer/runner.json`. On restart, calls `apply` to reactivate. Same resource, same queue, same identity.
20. **`agent_runner_id` on SessionSpec** — replaces the role of `sandbox_id` as session's execution context binding. Sandbox becomes a property of the runner (status), not the session.
21. **`agent_runner_id` on AgentExecutionStatus** — observability: which runner handled this execution.
22. **Heartbeat RPC on command controller** — dedicated lightweight RPC (not a full update), called every 30s, 90s timeout for STOPPED transition.
23. **`apply` RPC for CLI registration** — idempotent create-or-update. If runner exists (from yesterday), reactivates. If not, creates. This is the "match a restarted runner" pattern.

### Files Created (this session)

**stigmer (6 new proto files):**
- `apis/ai/stigmer/agentic/agentrunner/v1/api.proto` — AgentRunner resource, AgentRunnerStatus, AgentRunnerConnectionInfo
- `apis/ai/stigmer/agentic/agentrunner/v1/spec.proto` — AgentRunnerSpec (thin: description only)
- `apis/ai/stigmer/agentic/agentrunner/v1/enum.proto` — AgentRunnerPhase (Pending, Ready, Busy, Stopped, Failed)
- `apis/ai/stigmer/agentic/agentrunner/v1/io.proto` — AgentRunnerId, AgentRunnerHeartbeatInput, ListAgentRunnersRequest, AgentRunnerList
- `apis/ai/stigmer/agentic/agentrunner/v1/command.proto` — AgentRunnerCommandController (apply, create, update, delete, heartbeat)
- `apis/ai/stigmer/agentic/agentrunner/v1/query.proto` — AgentRunnerQueryController (get, getByReference, list)

### Files Modified (this session)

**stigmer (4 modified proto files + all generated stubs):**
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` — added `agent_runner = 46`
- `apis/ai/stigmer/iam/v1/enum.proto` — added `can_create_agent_runner = 25`
- `apis/ai/stigmer/agentic/session/v1/spec.proto` — added `agent_runner_id = 9` to SessionSpec
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` — added `agent_runner_id = 19` to AgentExecutionStatus
- All generated stubs across Go, Java, Python, TypeScript (154 files total via `make codegen`)

### Session 4 (2026-04-20) — Side-Channel Proxy FGA Authorization
- Implemented FGA-based authorization for all proxy endpoints
- Created `ProxyAuthorizationService` with 5-minute cache
- Checkpoints authorized via session, artifacts via execution, LLM is auth-only

### Session 3 (2026-04-20) — Daytona Operational Gate Validation
- All 3 Phase 2 operational gates PASSED
- Decision: bake runner into `Dockerfile.sandbox.full` (sub-second cold start)

### Session 2 (2026-04-20) — LLM Proxy Wiring
- Wired all 6 LLM client construction paths through Side-Channel Proxy
- Centralized `llm_kwargs` into `LLMConfig.build_llm_kwargs()`
- Fixed Anthropic SDK auth header mismatch with custom BearerTokenResolver

### Session 1 (2026-04-20) — Phase 0 Proxy
- Implemented complete Side-Channel Proxy: LLM passthrough, checkpointer API, artifact presigned URLs, Redis removal
- Committed in both repos

## Next Steps

### Phase 0 Deploy (remaining ops tasks)
1. **Validate Bazel build** — confirm gRPC + Tomcat coexistence
2. **Deploy proxy to staging** — verify `/health` on port 8081
3. **DNS setup** — `proxy.stigmer.ai` DNS record
4. **Apply Gateway API resources** — kubectl apply the 4 YAML files
5. **Create Planton secrets group** — OpenAI and Anthropic API keys
6. **End-to-end test** — trigger execution, verify all calls route through proxy
7. **Commit stigmer-cloud HttpSecurityConfig.java change** — BearerTokenResolver still uncommitted

### Phase 1 Implementation (next coding work)
8. ~~**stigmer-cloud: AgentRunner aggregate + handlers**~~ — DONE (Session 6, commit fbafc288)
9. ~~**stigmer (Go): AgentRunner store + handlers**~~ — DONE (Session 7)
10. ~~**stigmer-cloud: Dispatch integration**~~ — DONE (Session 8)
11. **stigmer-cloud: RunnerLauncher abstraction** — KubernetesJobRunnerLauncher for Phase 1; DaytonaSandboxRunnerLauncher for Phase 2 **← NEXT**
12. **stigmer: Runner auth migration** — STIGMER_USER_JWT env var, simplified ChannelProvider, deprecate OBO interceptor
13. **stigmer: Runner heartbeat client** — Python side: send heartbeat RPC every 30s
14. **stigmer: Idle self-termination** — idle watchdog in worker.py

### Phase 2 Prep (can start in parallel)
15. **Build unified sandbox image** — add agent-runner to `Dockerfile.sandbox.full`
16. **Update release pipeline** — widen build context for sandbox image

## Context for Resume
- Both repos are on the `feat/secrets-vault-migration` branch
- The stigmer-cloud repo has additional uncommitted vault-migration files — separate project
- The AgentRunner proto is complete (Session 5), Java aggregate is complete (Session 6), Go controller is complete (Session 7), and dispatch integration is complete (Session 8). Next is RunnerLauncher abstraction (item 11) in stigmer-cloud.
- The dispatch plan file is at `~/.cursor/plans/dispatch_integration_plan_6433a2bb.plan.md`
- The T01 design doc is at `_projects/2026-04/20260420.01.agent-runner-as-resource/tasks/T01_0_plan.md`
- stigmer-cloud has 2 pre-existing Bazel strict dependency errors in `HttpSecurityConfig.java` and `LlmProxyController.java` from Phase 0 proxy work — unrelated to AgentRunner
- All previous session context preserved in earlier sections of this file

## Blockers
- None blocking. Item 11 (RunnerLauncher abstraction) can proceed immediately.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260420.01.agent-runner-as-resource/next-task.md`

## Quick Commands
- "Continue with item 11 — RunnerLauncher abstraction" - KubernetesJobRunnerLauncher + DaytonaSandboxRunnerLauncher
- "Continue with item 12 — Runner auth migration" - STIGMER_USER_JWT env var, simplified ChannelProvider
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
