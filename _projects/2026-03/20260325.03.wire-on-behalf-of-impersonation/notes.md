# Notes: 20260325.03.wire-on-behalf-of-impersonation

**Created**: 2026-03-25

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-03-25 — Pre-Work Analysis

### Prerequisite Project

This project depends on the infrastructure built in `20260325.02.sp.on-behalf-of-grpc-channel` (complete). That project created:
- `OnBehalfOfMetadata.java` — shared `x-on-behalf-of` gRPC metadata key
- `OnBehalfOfClientInterceptor.java` — client interceptor attaching the header
- `ImpersonatedChannelFactory.java` — factory wrapping `inProcessChannelAsSystem` with impersonation
- `OnBehalfOfAuthorizationGuard.java` — FGA check for `can_impersonate` permission
- `platform.fga` — `can_impersonate: operator` permission
- Server-side identity override in `GrpcRequestContextBuilderInterceptor.java`

Machine account is already bootstrapped as `platform:stigmer#operator` via `U20250102_InsertBootstrapIdentityAccounts` migration, so it has `can_impersonate`.

### Key File Paths (stigmer-cloud)

**Downstream gRPC repos (already have createOnBehalfOf):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/agentic/executioncontext/ExecutionContextGrpcRepo.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/agentic/agentinstance/AgentInstanceGrpcRepo.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/tenancy/organization/OrganizationGrpcRepo.java`

**Downstream gRPC repos (need createOnBehalfOf added):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/agentic/workflowinstance/WorkflowInstanceGrpcRepo.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/agentic/workflowinstance/WorkflowInstanceGrpcRepoImpl.java`

**Domain handlers that call createAsSystem (need conversion):**
- `domain/agentic/agentexecution/request/step/CreateExecutionContextStep.java` — line ~179
- `domain/agentic/workflowexecution/request/step/CreateExecutionContextStep.java` — line ~162
- `domain/agentic/agentexecution/request/handler/AgentExecutionCreateHandler.java` — line ~381
- `domain/agentic/session/request/handler/SessionCreateHandler.java` — line ~137
- `domain/agentic/agent/request/handler/AgentCreateHandler.java` — line ~129
- `domain/agentic/workflowexecution/request/handler/WorkflowExecutionCreateHandler.java` — line ~225
- `domain/agentic/workflow/request/handler/WorkflowCreateHandler.java` — line ~217

**FGA models:**
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent_execution.fga`
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/session.fga`
- `backend/services/stigmer-service/src/main/resources/fga/model/platform.fga`

**Impersonation infra:**
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/grpc/ImpersonatedChannelFactory.java`
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/grpc/OnBehalfOfClientInterceptor.java`
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/grpc/OnBehalfOfMetadata.java`

### Key File Paths (stigmer — agent-runner, Python)

**gRPC clients that need x-on-behalf-of:**
- `backend/services/agent-runner/grpc_client/auth/client_interceptor.py` — `AuthClientInterceptor`, attaches `Bearer` API key
- `backend/services/agent-runner/grpc_client/execution_context_client.py` — `getByExecutionId`
- `backend/services/agent-runner/grpc_client/agent_execution_client.py` — `get`, `updateStatus`
- `backend/services/agent-runner/grpc_client/agent_client.py` — `get`
- `backend/services/agent-runner/grpc_client/agent_instance_client.py` — `get`
- `backend/services/agent-runner/grpc_client/session_client.py` — `get`, `update`
- `backend/services/agent-runner/grpc_client/environment_client.py` — `getByReference`
- `backend/services/agent-runner/grpc_client/skill_client.py` — `get`, `getByReference`, `getArtifact`
- `backend/services/agent-runner/grpc_client/mcp_server_client.py` — `get`, `getByReference`
- `backend/services/agent-runner/grpc_client/channel.py` — `ChannelProvider`, `create_channel`

**Activity entry points:**
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — main consumer of all clients
- `backend/services/agent-runner/worker/activities/generate_session_subject.py`
- `backend/services/agent-runner/worker/sandbox_manager.py`

### Key File Paths (stigmer — workflow-runner, Go)

**gRPC clients that need x-on-behalf-of:**
- `backend/services/workflow-runner/pkg/grpc_client/execution_context_client.go` — `GetByExecutionId`
- `backend/services/workflow-runner/pkg/grpc_client/workflow_client.go` — `Get`
- `backend/services/workflow-runner/pkg/grpc_client/workflow_instance_client.go` — `Get`
- `backend/services/workflow-runner/pkg/grpc_client/workflow_execution_client.go` — `UpdateStatus`
- `backend/services/workflow-runner/pkg/interceptors/progress_interceptor.go` — `UpdateStatus`
- `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_agent_activities.go` — `GetByReference`, `Create` AgentExecution

**Activity entry points:**
- `backend/services/workflow-runner/worker/activities/execute_workflow_activity.go`

**Config:**
- `backend/services/workflow-runner/pkg/config/stigmer_config.go` — `STIGMER_BACKEND_ENDPOINT`, `STIGMER_API_KEY`

### Why x-on-behalf-of Works for External Runners

The server-side interceptor (`GrpcRequestContextBuilderInterceptor`) handles `x-on-behalf-of` regardless of channel type (in-process or external). The flow:
1. Runner authenticates via `Authorization: Bearer <STIGMER_API_KEY>` (machine account)
2. Runner attaches `x-on-behalf-of: <identityAccountId>` header
3. Server interceptor authenticates machine account, sees OBO header
4. FGA check: machine account `can_impersonate` on `platform:stigmer` — passes (it's an operator)
5. Identity override: effective caller becomes the target user
6. All downstream FGA checks run as the user

### FGA Model Analysis

**agent_execution.fga** — `owner: owner from session or operator from session` is redundant because `session.owner` already includes `operator` (via `[identity_account] or operator`). Can simplify to `owner: owner from session`.

**execution_context** — no FGA type exists. Holds decrypted secrets. Needs FGA type as child of execution with inherited permissions.

### createOnBehalfOf Pattern (copy this)

```java
// In GrpcRepoImpl:
private final ImpersonatedChannelFactory channelFactory;

public T createOnBehalfOf(T resource, String identityAccountId) {
    var stub = CommandControllerGrpc.newBlockingStub(
            channelFactory.forIdentity(identityAccountId));
    return stub.create(resource);
}
```

### Caller Identity Threading Pattern

All domain handlers have `context.getCaller().getIdentityAccountId()` available via `CreateContextV2`. The steps need this threaded in — either pass the full context or extract the ID.

---

