# Agent Instance Migration

**Date**: January 12, 2026

## Summary

Updated the agent-runner service to use the correct data model with **AgentInstance** as the deployment layer. This involves resolving the full chain from execution through session to agent instance to agent, and using **ApiResourceReference** instead of IDs for skills and environments.

## Architecture Changes

### Before (INCORRECT)

```
Execution → agent_id → Agent → skill_ids (from JSON config)
```

**Problems:**
- ❌ No AgentInstance layer - can't configure environments per deployment
- ❌ Skills referenced by IDs instead of ApiResourceReference
- ❌ Agent had non-existent `config` field
- ❌ No environment merging support

### After (CORRECT)

```
Execution → Session → AgentInstance → Agent → skill_refs (ApiResourceReference)
                         ↓
                   environment_refs (ApiResourceReference)
```

**Benefits:**
- ✅ AgentInstance provides deployment layer with environment configuration
- ✅ Skills referenced via ApiResourceReference (scope + org + kind + slug)
- ✅ Multiple environments can be layered with proper override semantics
- ✅ Follows correct proto contracts

## New Clients Created

### 1. AgentInstanceClient

**File**: `grpc_client/agent_instance_client.py`

```python
agent_instance_client = AgentInstanceClient(token_manager)
agent_instance = await agent_instance_client.get(agent_instance_id)
```

**Purpose**: Fetches AgentInstance by ID to resolve agent_id and environment_refs.

### 2. EnvironmentClient

**File**: `grpc_client/environment_client.py`

```python
environment_client = EnvironmentClient(token_manager)

# Single environment by reference
environment = await environment_client.get_by_reference(ref)

# Multiple environments (preserves order for merging)
environments = await environment_client.list_by_refs(refs)
```

**Purpose**: Fetches Environment resources by ApiResourceReference for layered configuration.

## Updated Clients

### SkillClient

**Added methods:**

```python
# Fetch single skill by ApiResourceReference
skill = await skill_client.get_by_reference(ref)

# Fetch multiple skills by ApiResourceReference
skills = await skill_client.list_by_refs(refs)
```

**Purpose**: Support fetching skills via ApiResourceReference instead of IDs.

## Execution Flow Changes

### Updated Resolution Chain

**File**: `worker/activities/execute_graphton.py`

```python
# Step 1: Resolve full chain
session = await session_client.get(execution.spec.session_id)
agent_instance = await agent_instance_client.get(session.spec.agent_instance_id)
agent = await agent_client.get(agent_instance.spec.agent_id)

# Step 2: Model configuration
model_name = (
    execution.spec.execution_config.model_name 
    if execution.spec.execution_config
    else "claude-sonnet-4.5"
)

# Step 3: Fetch skills via ApiResourceReference
skill_refs = agent.spec.skill_refs  # repeated ApiResourceReference
skills = await skill_client.list_by_refs(list(skill_refs))

# Step 4: Merge environments (order matters!)
environment_refs = agent_instance.spec.environment_refs
environments = await environment_client.list_by_refs(list(environment_refs))

# Merge strategy:
# 1. Start with agent.spec.env_spec.data (base from template)
# 2. Layer each environment in order (later overrides earlier)
# 3. Apply execution.spec.runtime_env (highest priority)
```

### Environment Merging Logic

Environments are merged with explicit override semantics:

```python
final_env = {
    **agent.env_spec.data,           # Base from agent template
    **environments[0].spec.data,     # First environment ref
    **environments[1].spec.data,     # Second environment ref (overrides first)
    **environments[n].spec.data,     # Last environment ref (overrides all previous)
    **execution.runtime_env,         # Execution-scoped (highest priority)
}
```

**Example:**
```
AgentInstance.environment_refs = ["base-env", "aws-prod", "github-team"]
Execution.runtime_env = {"API_KEY": "temp-key-123"}

Result:
  base-env values
  ← overridden by aws-prod values
  ← overridden by github-team values  
  ← overridden by runtime_env values (highest priority)
```

## Proto Field Corrections

### ApiResourceReference Structure

```protobuf
message ApiResourceReference {
  ApiResourceOwnerScope scope = 1;  // platform/organization/identity_account
  string org = 2;                    // org ID (required if scope=organization)
  ApiResourceKind kind = 3;          // resource type enum
  string slug = 4;                   // human-readable name (NOT ID!)
}
```

**Key Point**: References use **slug** (user-friendly name), not ID.

### Agent Template

```protobuf
message AgentSpec {
  string instructions = 3;                              // Agent behavior
  repeated ApiResourceReference skill_refs = 5;         // NOT skill_ids!
  repeated McpServerDefinition mcp_servers = 4;         // MCP server defs
  repeated SubAgent sub_agents = 6;                     // Sub-agents
  EnvironmentSpec env_spec = 7;                         // Base env vars
}
```

**Changed**: `skill_refs` uses ApiResourceReference, not string IDs.

### Agent Instance (Deployment Layer)

```protobuf
message AgentInstanceSpec {
  string agent_id = 1;                                  // References Agent template
  string description = 2;                               // Instance description
  repeated ApiResourceReference environment_refs = 3;   // Layered environments
}
```

**New Layer**: Provides deployment-specific configuration with environment layering.

### Session

```protobuf
message SessionSpec {
  string agent_instance_id = 1;  // References AgentInstance (NOT agent_id!)
  string subject = 2;
  string thread_id = 3;          // LangGraph thread ID
  string sandbox_id = 4;         // Daytona sandbox ID
}
```

**Changed**: Now references `agent_instance_id` instead of `agent_id`.

### Execution

```protobuf
message AgentExecutionSpec {
  string session_id = 1;                           // References Session (required)
  string agent_id = 2;                             // Derived from session (convenience)
  string message = 3;                              // User input
  ExecutionConfig execution_config = 4;            // Optional overrides (e.g., model)
  map<string, ExecutionValue> runtime_env = 5;     // Execution-scoped env vars
}
```

**Note**: `agent_id` is derived for convenience but the actual resolution goes through session → agent_instance.

### Environment

```protobuf
message EnvironmentSpec {
  string description = 1;
  map<string, EnvironmentValue> data = 2;  // NOT vars!
}

message EnvironmentValue {
  string value = 1;        // The actual value
  bool is_secret = 2;      // Whether to encrypt/redact
  string description = 3;  // Optional documentation
}
```

**Field Name**: `data` (not `vars`), and values are `EnvironmentValue` objects.

## Files Changed

### New Files
1. **`grpc_client/agent_instance_client.py`** - Client for AgentInstance queries
2. **`grpc_client/environment_client.py`** - Client for Environment queries
3. **`ARCHITECTURE_NOTES.md`** - Architecture documentation
4. **`AGENT_INSTANCE_MIGRATION.md`** - This file

### Modified Files
5. **`grpc_client/skill_client.py`** - Added `get_by_reference()` and `list_by_refs()`
6. **`worker/activities/execute_graphton.py`** - Updated to resolve full chain and merge environments

## Type Checking

All changes pass mypy type checking:

```bash
$ cd backend/services/agent-runner
$ make build
✅ Type checking passed
Success: no issues found in 24 source files
```

## Testing Checklist

### Unit Tests Needed
- [ ] Test AgentInstanceClient.get()
- [ ] Test EnvironmentClient.get_by_reference()
- [ ] Test EnvironmentClient.list_by_refs() order preservation
- [ ] Test SkillClient.get_by_reference()
- [ ] Test SkillClient.list_by_refs()
- [ ] Test environment merging logic with multiple layers
- [ ] Test runtime_env override behavior

### Integration Tests Needed
- [ ] End-to-end execution with AgentInstance
- [ ] Skill resolution via ApiResourceReference
- [ ] Environment layering with 3+ environments
- [ ] Runtime env vars overriding environment values
- [ ] Error handling for missing references
- [ ] Permission denied scenarios

## Migration Notes

### Breaking Changes

**Session Creation**: Sessions must now be created with `agent_instance_id` instead of `agent_id`.

```python
# ❌ OLD (will fail)
session = Session(
    spec=SessionSpec(agent_id="agent-123")
)

# ✅ NEW (correct)
session = Session(
    spec=SessionSpec(agent_instance_id="agent-instance-456")
)
```

### Backward Compatibility

**None** - This is a breaking change requiring:
1. Update all session creation code to use agent_instance_id
2. Update all skill references to use ApiResourceReference
3. Create AgentInstance resources for existing agents

## Benefits

### Developer Experience
- ✅ **Clearer separation of concerns**: Template (Agent) vs Deployment (AgentInstance)
- ✅ **Flexible configuration**: Multiple environments can be layered
- ✅ **Runtime overrides**: Execution-scoped env vars for B2B integrations
- ✅ **Type safety**: Full mypy coverage catches errors at build time

### System Quality
- ✅ **Reference integrity**: ApiResourceReference includes scope, org, kind, slug
- ✅ **Audit trail**: References capture who created what and when
- ✅ **Permission model**: FGA authorization on references
- ✅ **Environment isolation**: Same agent template → multiple production instances

### Operational Benefits
- ✅ **Multi-tenancy**: Different instances for different orgs
- ✅ **Environment promotion**: Dev → Staging → Prod environments
- ✅ **Secret management**: Secrets encrypted at rest via EnvironmentValue.is_secret
- ✅ **Configuration drift prevention**: Environments are versioned resources

## Next Steps

1. ✅ **Type checking** - DONE
2. ✅ **Create new clients** - DONE
3. ✅ **Update execution flow** - DONE
4. ✅ **Environment merging** - DONE
5. ❌ **Write unit tests** - TODO
6. ❌ **Write integration tests** - TODO
7. ❌ **Update session creation code** - TODO (backend Java service)
8. ❌ **Create AgentInstance resources** - TODO (migration script or manual)

---

**Status**: ✅ Implementation Complete, Tests Pending  
**Updated**: January 12, 2026  
**Impact**: High - Enables proper multi-tenancy and environment management
