# Next Task: 20260420.01.agent-runner-as-resource

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260420.01.agent-runner-as-resource

**Description**: Promote AgentRunner to a first-class API resource with orthogonal lifecycle/scope/placement axes; introduce a Stigmer Side-Channel Proxy that injects all platform secrets so runners carry only the user JWT; eliminate the can_impersonate machine-account model; unify per-execution sandbox and agent-runner into a single Daytona container; enable browser-launched local runners via stigmer:// URL scheme.
**Goal**: Eliminate the platform-wide can_impersonate superpower for agent execution by making every agent-runner authenticate as the triggering user and routing all infrastructure secrets through a Stigmer-hosted side-channel proxy that the runner never sees.
**Tech Stack**: Java/Spring Boot WebFlux (stigmer-service), Python (agent-runner), Protobuf, OpenBAO/Vault, Daytona, Temporal, Auth0, Tauri/Go (CLI/Desktop)
**Components**: apis/ai/stigmer/agentic/agentrunner/v1 (new proto resource); backend/services/stigmer-service (proxy endpoints, AgentRunner aggregate, dispatch logic, RunnerLauncher abstraction); backend/services/agent-runner (remove machine account, point clients at proxy, run inside Daytona); client-apps/cli and Stigmer Desktop (stigmer:// URL handler, register-as-AgentRunner flow); cloud frontend (AgentRunner UI for Persistent runners)

## Current State
- **Status**: Phase 0 code complete; Phase 1 proto definition complete; Phase 2 Daytona gates validated
- **Last Session**: 2026-04-20 — AgentRunner proto definition (Session 5)
- **Active Task**: Phase 1 implementation (Java/Go aggregate, handlers, Temporal integration)

## Session Progress (2026-04-20, Session 5 — AgentRunner Proto Definition)

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

## Previous Sessions (2026-04-20)

### Session 4 — Side-Channel Proxy FGA Authorization
- Implemented FGA-based authorization for all proxy endpoints
- Created `ProxyAuthorizationService` with 5-minute cache
- Checkpoints authorized via session, artifacts via execution, LLM is auth-only

### Session 3 — Daytona Operational Gate Validation
- All 3 Phase 2 operational gates PASSED
- Decision: bake runner into `Dockerfile.sandbox.full` (sub-second cold start)

### Session 2 — LLM Proxy Wiring
- Wired all 6 LLM client construction paths through Side-Channel Proxy
- Centralized `llm_kwargs` into `LLMConfig.build_llm_kwargs()`
- Fixed Anthropic SDK auth header mismatch with custom BearerTokenResolver

### Session 1 — Phase 0 Proxy
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
8. **stigmer-cloud: AgentRunner aggregate + handlers** — domain entity, MongoDB repository, create/update/delete/heartbeat handlers, FGA tuples
9. **stigmer (Go): AgentRunner store + handlers** — SQLite store, Go server handlers (dual-edition consistency)
10. **stigmer-cloud: Dispatch integration** — modify InvokeAgentExecutionWorkflow to resolve runner, read task queue from AgentRunner status, launch ephemeral runner if needed
11. **stigmer-cloud: RunnerLauncher abstraction** — KubernetesJobRunnerLauncher for Phase 1; DaytonaSandboxRunnerLauncher for Phase 2
12. **stigmer: Runner auth migration** — STIGMER_USER_JWT env var, simplified ChannelProvider, deprecate OBO interceptor
13. **stigmer: Runner heartbeat client** — Python side: send heartbeat RPC every 30s
14. **stigmer: Idle self-termination** — idle watchdog in worker.py

### Phase 2 Prep (can start in parallel)
15. **Build unified sandbox image** — add agent-runner to `Dockerfile.sandbox.full`
16. **Update release pipeline** — widen build context for sandbox image

## Context for Resume
- Both repos are on the `feat/secrets-vault-migration` branch
- The stigmer-cloud repo has additional uncommitted vault-migration files — separate project
- The AgentRunner proto is complete and stubs are generated. The proto is the contract; implementation builds on it.
- The plan file for this session is at `~/.cursor/plans/agentrunner_proto_definition_211dbc21.plan.md`
- The T01 design doc is at `_projects/2026-04/20260420.01.agent-runner-as-resource/tasks/T01_0_plan.md`
- All previous session context (Phase 0, LLM wiring, Daytona gates, FGA auth) preserved in earlier sections of this file

## Blockers
- None blocking. Phase 0 deploy steps are operational tasks. Phase 1 implementation is ready to start.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260420.01.agent-runner-as-resource/next-task.md`

## Quick Commands
- "Continue with Phase 1 implementation" - Start AgentRunner aggregate + handlers
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
