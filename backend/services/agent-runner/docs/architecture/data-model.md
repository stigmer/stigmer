# Agent Runner Architecture Notes

## Data Model Hierarchy

### Resource Relationships

```
Agent (template)
  ↓ (agent_id)
AgentInstance (configured deployment with environments)
  ↓ (agent_instance_id)
Session (conversation thread)
  ↓ (session_id)
AgentExecution (single message/response turn)
```

### Proto Field Mappings

#### Agent (Template Layer)
```protobuf
message AgentSpec {
  string instructions = 3;
  repeated ApiResourceReference skill_refs = 5;  // NOT skill_ids!
  repeated McpServerDefinition mcp_servers = 4;
  repeated SubAgent sub_agents = 6;
  EnvironmentSpec env_spec = 7;
}
```

**Key Point**: Skills are referenced via `ApiResourceReference` (scope + org + kind + slug), NOT IDs.

#### AgentInstance (Instance Layer)
```protobuf
message AgentInstanceSpec {
  string agent_id = 1;  // References Agent template
  string description = 2;
  repeated ApiResourceReference environment_refs = 3;  // Can reference multiple envs
}
```

**Key Point**: Instances reference a template Agent and can layer multiple Environments.

#### Session (Conversation Layer)
```protobuf
message SessionSpec {
  string agent_instance_id = 1;  // References AgentInstance (NOT agent_id!)
  string subject = 2;
  string thread_id = 3;  // LangGraph thread ID
  string sandbox_id = 4;  // Daytona sandbox ID
  map<string, string> metadata = 5;
}
```

**Key Point**: Sessions reference `agent_instance_id`, NOT `agent_id` directly!

#### AgentExecution (Turn Layer)
```protobuf
message AgentExecutionSpec {
  string session_id = 1;  // References Session (required)
  string agent_id = 2;  // Derived from session (for convenience)
  string message = 3;  // User input
  ExecutionConfig execution_config = 4;  // Optional overrides
  map<string, ExecutionValue> runtime_env = 5;  // Execution-scoped env vars
}
```

**Key Point**: Executions reference `session_id`, and `agent_id` is derived for convenience.

### ApiResourceReference Structure

```protobuf
message ApiResourceReference {
  ApiResourceOwnerScope scope = 1;
  string org = 2;
  ApiResourceKind kind = 3;
  string slug = 4;  // User-friendly name (NOT ID!)
}
```

**Important**: References use **slug** (human-readable name), not ID!

## Execution Flow

### Current Worker Implementation (INCORRECT)

```python
# ❌ WRONG: Trying to get agent directly from execution
execution → execution.spec.agent_id → agent

# ❌ WRONG: Trying to get skill_ids from agent_config
agent_config.get("skill_ids", [])
```

### Correct Worker Implementation (TODO)

```python
# ✅ CORRECT: Resolve the full chain
execution → session → agent_instance → agent → skill_refs

# Step 1: Get session
session = await session_client.get(execution.spec.session_id)

# Step 2: Get agent instance
agent_instance = await agent_instance_client.get(session.spec.agent_instance_id)

# Step 3: Get agent (template)
agent = await agent_client.get(agent_instance.spec.agent_id)

# Step 4: Resolve skill references
skill_refs = agent.spec.skill_refs  # repeated ApiResourceReference
skills = await skill_client.list_by_refs(skill_refs)  # Resolve by references

# Step 5: Merge environments
environment_refs = agent_instance.spec.environment_refs
environments = await environment_client.list_by_refs(environment_refs)
merged_env = merge_environments(environments)  # Later envs override earlier ones
```

## Environment Variable Merging

Environments are merged in order with later values overriding earlier ones:

```
Agent.env_spec (base)
  ← Environment[0] (first override)
  ← Environment[1] (second override)  
  ← Environment[n] (final override)
  ← runtime_env (execution-scoped, highest priority)
```

Example:
```python
# AgentInstance has: environment_refs = ["base-env", "aws-prod-env", "github-team-env"]
# Execution has: runtime_env = {"API_KEY": "temp-key-123"}

# Result:
final_env = {
  **agent.env_spec,           # Base from template
  **environments[0],           # base-env
  **environments[1],           # aws-prod-env (overrides base-env)
  **environments[2],           # github-team-env (overrides aws-prod-env)
  **execution.runtime_env,     # Highest priority (overrides everything)
}
```

## Client Implementations Needed

### Missing Clients
1. **AgentInstanceClient** - NEW, needs to be created
   ```python
   from grpc_client.agent_instance_client import AgentInstanceClient
   
   agent_instance_client = AgentInstanceClient(token_manager)
   agent_instance = await agent_instance_client.get(agent_instance_id)
   ```

2. **EnvironmentClient** - NEW, needs to be created
   ```python
   from grpc_client.environment_client import EnvironmentClient
   
   environment_client = EnvironmentClient(token_manager)
   environments = await environment_client.list_by_refs(environment_refs)
   ```

### Existing Clients (Need Updates)
1. **SkillClient** - Update to support `list_by_refs()`
   ```python
   # Current: list_by_ids(skill_ids: list[str])
   # Needed: list_by_refs(skill_refs: list[ApiResourceReference])
   ```

## Type Checking Integration

### Service-Level Makefile (CORRECT)
```makefile
# backend/services/agent-runner/Makefile
.PHONY: build
build:
	@echo "Running type checking..."
	poetry run mypy grpc_client/ worker/ --show-error-codes
	@echo "✅ Type checking passed"
```

**Called by CI/CD**: `tools/ci/build_and_push_service.sh` automatically runs `make build` if it exists.

### Root-Level Makefile (NO TYPE CHECKING)
```makefile
# Root Makefile
.PHONY: build-python
build-python:
	./bazelw build //backend/services/agent-runner/...
```

**Limitation**: Bazel build doesn't run mypy. Type checking only happens via service-level Makefile.

## TODO: Update Worker Implementation

1. ✅ Fix enum imports (ExecutionPhase, MessageType, ToolCallStatus)
2. ✅ Fix protobuf field names (tool_calls, markdown_content, instructions)
3. ✅ Enable mypy type checking for worker module
4. ✅ Create service-level Makefile with build target
5. ❌ **Create AgentInstanceClient** 
6. ❌ **Create EnvironmentClient**
7. ❌ **Update SkillClient to support ApiResourceReference**
8. ❌ **Update execute_graphton.py to resolve full chain**:
   - Execution → Session → AgentInstance → Agent → Skills
9. ❌ **Implement environment merging logic**

## References

- Agent proto: `apis/ai/stigmer/agentic/agent/v1/api.proto`
- AgentInstance proto: `apis/ai/stigmer/agentic/agentinstance/v1/api.proto`
- Session proto: `apis/ai/stigmer/agentic/session/v1/api.proto`
- AgentExecution proto: `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
- ApiResourceReference: `apis/ai/stigmer/commons/apiresource/io.proto`

---

**Status**: Architecture documented, type checking implemented, worker logic needs refactoring  
**Updated**: January 12, 2026
