---
name: Environment Placeholder Resolution
overview: "Implement Milestone 3: Create PlaceholderResolverService for ${VAR} substitution in MCP server configs, add validation for required environment variables, and integrate with the agent runner for runtime resolution."
todos:
  - id: placeholder-resolver-python
    content: Create PlaceholderResolverService in Python (agent-runner) with resolve(), resolve_map(), resolve_http_config() methods
    status: completed
  - id: placeholder-resolver-tests-python
    content: Create comprehensive unit tests for Python placeholder resolver
    status: completed
  - id: mcp-env-validator-java
    content: Create McpEnvironmentValidator service in Java to validate required MCP server env vars at execution creation
    status: completed
  - id: mcp-env-validator-tests-java
    content: Create unit tests for Java MCP environment validator
    status: completed
  - id: integrate-validation-agent-exec
    content: Integrate McpEnvironmentValidator into CreateExecutionContextStep for AgentExecution
    status: completed
  - id: integrate-validation-workflow-exec
    content: Integrate McpEnvironmentValidator into CreateExecutionContextStep for WorkflowExecution
    status: completed
  - id: integrate-resolver-agent-runner
    content: Integrate placeholder resolver into MCP server initialization in Python agent runner
    status: completed
isProject: false
---

# Milestone 3: Environment Resolution and Placeholder Substitution

## Context

The environment merging infrastructure is complete (Milestone 2). This milestone adds:

1. **Placeholder resolution** - substitute `${VAR}` in MCP server configurations
2. **Validation** - ensure required environment variables are present
3. **Runner integration** - resolve placeholders at MCP server startup

## Architecture Decision: Where Does Placeholder Resolution Happen?

Placeholder resolution must occur at **two points**:

1. **Validation (Java)** - At execution creation, validate all required vars exist
2. **Resolution (Python)** - At MCP server startup, resolve actual values
```
┌─────────────────────────────────────────────────────────────────────┐
│  EXECUTION CREATION (Java - stigmer-cloud)                          │
├─────────────────────────────────────────────────────────────────────┤
│  1. Merge environment (existing)                                    │
│  2. [NEW] Validate MCP server required vars are present             │
│  3. Store in ExecutionContext (encrypted)                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MCP SERVER STARTUP (Python - agent runner)                         │
├─────────────────────────────────────────────────────────────────────┤
│  1. Query ExecutionContext (decrypt)                                │
│  2. [NEW] Resolve ${PLACEHOLDERS} in HttpServerConfig.headers       │
│  3. [NEW] Resolve ${PLACEHOLDERS} in HttpServerConfig.query_params  │
│  4. Start MCP server with resolved config                           │
└─────────────────────────────────────────────────────────────────────┘
```


## Component 1: PlaceholderResolverService (Python)

**Location**: `stigmer/backend/services/agent-runner/pkg/mcp/placeholder_resolver.py`

This is the primary resolver - runs in the Python agent runner when starting MCP servers.

**Responsibilities**:

- Parse `${VAR_NAME}` patterns in strings
- Substitute with values from execution context environment
- Handle missing variables (raise clear errors)
- Support nested/complex placeholders like `Bearer ${TOKEN}`

**Key Methods**:

- `resolve(template: str, env: Dict[str, str]) -> str` - single string
- `resolve_map(template: Dict[str, str], env: Dict[str, str]) -> Dict[str, str]` - for headers/params
- `resolve_http_config(config: HttpServerConfig, env: Dict[str, str]) -> HttpServerConfig`

## Component 2: MCP Environment Validation (Java)

**Location**: `stigmer-cloud/.../executioncontext/service/McpEnvironmentValidator.java`

Validates at execution creation time that required MCP server environment variables are present.

**Integration Point**: Called from `CreateExecutionContextStep` for both agent and workflow executions.

**Flow**:

1. Load Agent/Workflow spec to get `mcp_servers` list
2. For each MCP server ref, load `McpServerSpec.env_spec`
3. Verify all required vars (no default value) exist in merged environment
4. Return validation errors with clear messages

**Key Methods**:

- `validateRequiredVariables(Agent agent, Map<String, ExecutionValue> mergedEnv) -> List<String> errors`

## Component 3: Integration Points

### 3a. Python Agent Runner Integration

**Location**: `stigmer/backend/services/agent-runner/pkg/mcp/` (existing MCP initialization code)

**Changes**:

- Before starting HTTP MCP server, resolve placeholders in:
  - `HttpServerConfig.headers`
  - `HttpServerConfig.query_params`
- Use `PlaceholderResolverService` with decrypted execution context values

### 3b. Java Validation Integration

**Location**: `stigmer-cloud/.../agentexecution/request/step/CreateExecutionContextStep.java`

**Changes**:

- After environment merge, before creating ExecutionContext
- Call `McpEnvironmentValidator.validate()`
- Return validation failure if required vars missing

## Files to Create

**stigmer (Python)**:

- `backend/services/agent-runner/pkg/mcp/placeholder_resolver.py` - Core resolver
- `backend/services/agent-runner/pkg/mcp/placeholder_resolver_test.py` - Unit tests

**stigmer-cloud (Java)**:

- `domain/agentic/executioncontext/service/McpEnvironmentValidator.java` - Validation service
- `test/.../McpEnvironmentValidatorTest.java` - Unit tests

## Files to Modify

**stigmer**:

- `backend/services/agent-runner/pkg/mcp/` - MCP server initialization to use resolver

**stigmer-cloud**:

- `domain/agentic/agentexecution/request/step/CreateExecutionContextStep.java` - Add validation call
- `domain/agentic/workflowexecution/request/step/CreateExecutionContextStep.java` - Add validation call

## Implementation Details

### Placeholder Syntax

Standard pattern: `${VAR_NAME}`

**Regex**: `\$\{([A-Za-z_][A-Za-z0-9_]*)\}`

**Examples**:

- `"Bearer ${GITHUB_TOKEN}"` → `"Bearer ghp_xxx..."`
- `"${API_KEY}"` → `"sk-xxx..."`
- `"https://api.example.com?region=${AWS_REGION}"` → `"https://api.example.com?region=us-east-1"`

### Error Handling

**Missing Variable**:

```
ValidationError: MCP server 'github-mcp' requires environment variable 'GITHUB_TOKEN' 
which is not provided. Add it to AgentInstance.environment_refs or AgentExecution.runtime_env.
```

**Invalid Placeholder**:

```
PlaceholderError: Invalid placeholder syntax '${invalid-name}' in header 'Authorization'. 
Variable names must match pattern [A-Za-z_][A-Za-z0-9_]*
```

## Test Strategy

### Unit Tests (Python)

- Basic substitution: `${VAR}` → value
- Multiple placeholders: `${A} and ${B}`
- Nested in string: `Bearer ${TOKEN}`
- Missing variable error
- Invalid placeholder syntax error
- Empty value handling

### Unit Tests (Java)

- Required var present → pass
- Required var missing → validation error
- Optional var (has default) missing → pass
- Multiple MCP servers validation
- Empty env_spec → pass

### Integration Tests

- End-to-end: Create execution with MCP server requiring env var
- Verify validation fails when var missing
- Verify placeholder resolution in agent runner

## Estimated Changes

- **New files**: 4 (2 Python, 2 Java)
- **Modified files**: ~4-6
- **Test files**: 2 new
- **Total LOC**: ~400-500