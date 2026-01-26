# Design Decision 003: Environment Variable Schema vs Values

**Date**: 2026-01-26
**Status**: PROPOSED (Pending Approval)
**Deciders**: Developer review required

## Context

MCP servers require environment variables for authentication and configuration (e.g., `GITHUB_TOKEN`, `AWS_ACCESS_KEY_ID`). We need to decide how to handle these when MCP servers become separate resources.

## The Problem

Currently in `AgentSpec`:
```protobuf
message StdioServer {
  map<string, string> env_placeholders = 3;
  // e.g., {"GITHUB_TOKEN": "${GITHUB_TOKEN}"}
}
```

This mixes schema (what env vars are needed) with values (placeholders for runtime injection).

## Decision

**Separate Schema from Values**:
- `McpServer.spec.env_schema` defines WHAT env vars are needed (schema)
- `AgentInstance.config` provides ACTUAL values at runtime

## Implementation

### McpServer (Schema Definition)
```protobuf
message McpServerSpec {
  // Environment variable schema - declares required env vars
  repeated EnvVarSchema env_schema = 8;
}

message EnvVarSchema {
  // Environment variable name (e.g., "GITHUB_TOKEN")
  string name = 1 [(buf.validate.field).required = true];
  
  // Human-readable description for documentation/UI
  string description = 2;
  
  // Whether this env var is required
  bool required = 3;
  
  // Optional default value (for non-sensitive vars)
  string default_value = 4;
  
  // Whether this is a secret (affects UI, logging, storage)
  bool is_secret = 5;
  
  // Validation pattern (optional regex)
  string validation_pattern = 6;
}
```

### AgentInstance (Value Provision)
Existing `EnvironmentSpec` already handles this:
```protobuf
message AgentInstance {
  // Environment configuration with actual values
  ai.stigmer.agentic.environment.v1.EnvironmentSpec env_config = X;
}
```

### Runtime Resolution
At agent runtime:
1. Resolve all `McpServerUsage` references
2. Collect `env_schema` from each McpServer
3. Validate that `AgentInstance.env_config` provides all required values
4. Inject values into MCP server process

## Rationale

1. **Security**: Secrets stay in `AgentInstance`, not in `McpServer` definition
2. **Reusability**: Same `McpServer` can be used with different credentials
3. **Validation**: Schema allows validation before runtime
4. **Documentation**: Schema provides self-documenting API

## Example Flow

```
McpServer "github-mcp" (platform scope):
  env_schema:
    - name: "GITHUB_TOKEN", required: true, is_secret: true
    - name: "GITHUB_ENTERPRISE_URL", required: false, default: ""

Agent "code-reviewer":
  mcp_server_usages:
    - mcp_server_ref: {kind: mcp_server, name: "github-mcp", scope: platform}

AgentInstance "code-reviewer-acme":
  agent_ref: {kind: agent, name: "code-reviewer"}
  env_config:
    secrets:
      - name: "GITHUB_TOKEN", secret_ref: "acme-github-pat"
```

## Consequences

### Positive
- Clear separation of concerns
- Better security model (secrets in instances)
- Self-documenting MCP server requirements
- Enables validation before runtime

### Negative
- Need to define schema for existing MCP servers
- Migration requires extracting schema from placeholders

## Migration Strategy

For existing inline MCP servers:
1. Parse `env_placeholders` to extract variable names
2. Generate `env_schema` (default: required=true, is_secret=true)
3. User can refine schema (add descriptions, mark optional vars)

## Related Decisions

- 001-scope-model.md (determines where secrets can be stored)
- 002-reference-pattern.md (how agents reference MCP servers)
