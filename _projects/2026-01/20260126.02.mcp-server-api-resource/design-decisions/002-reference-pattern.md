# Design Decision 002: Agent-to-McpServer Reference Pattern

**Date**: 2026-01-26
**Status**: PROPOSED (Pending Approval)
**Deciders**: Developer review required

## Context

When extracting MCP servers into separate resources, we need to decide how `AgentSpec` will reference them.

## Options Considered

### Option A: Simple Reference
```protobuf
repeated ApiResourceReference mcp_server_refs = 8;
```
- Pros: Simple, follows existing pattern (skill_refs)
- Cons: No per-agent customization

### Option B: Reference with Overrides (RECOMMENDED)
```protobuf
message McpServerUsage {
  ApiResourceReference mcp_server_ref = 1;
  repeated string enabled_tools_override = 2;
  string alias = 3;
}
repeated McpServerUsage mcp_server_usages = 8;
```
- Pros: Allows per-agent tool selection, aliasing
- Cons: Slightly more complex

### Option C: Full Configuration Override
```protobuf
message McpServerUsage {
  ApiResourceReference mcp_server_ref = 1;
  map<string, string> env_overrides = 2;
  repeated string enabled_tools_override = 3;
  string alias = 4;
}
```
- Pros: Maximum flexibility
- Cons: Blurs line between definition and instance

## Decision

**Option B: Reference with Overrides**

## Rationale

1. **Tool Selection Flexibility**: Different agents using the same MCP server may need different tools
   - A "code reviewer" agent might only need `github:create_pull_request_review`
   - A "project manager" agent might need `github:list_issues`, `github:create_issue`

2. **Aliasing**: When an agent uses multiple MCP servers of the same type, aliases help distinguish them
   - `mcp_server_ref: github-work` with `alias: "work"`
   - `mcp_server_ref: github-personal` with `alias: "personal"`

3. **No Env Overrides**: Environment variable values should come from `AgentInstance`, not `AgentSpec`
   - `AgentSpec` is a template (desired state)
   - `AgentInstance` provides runtime values (secrets, configuration)

## Implementation

```protobuf
// In agent/v1/spec.proto

message McpServerUsage {
  // Reference to McpServer resource
  ai.stigmer.commons.apiresource.ApiResourceReference mcp_server_ref = 1 [
    (buf.validate.field).required = true,
    (buf.validate.field).cel = {
      id: "mcp_server_ref.kind"
      message: "mcp_server_ref must reference resources with kind=mcp_server"
      expression: "this.kind == XX"  // XX = mcp_server enum value
    }
  ];
  
  // Override default enabled tools for this agent
  // Empty = use McpServer's default_enabled_tools
  repeated string enabled_tools_override = 2;
  
  // Alias for this MCP server within this agent
  // Useful when using multiple instances of same server type
  string alias = 3 [(buf.validate.field).string.pattern = "^[a-z0-9-_]*$"];
}

message AgentSpec {
  // ... existing fields ...
  
  // DEPRECATED: Use mcp_server_usages instead
  repeated McpServerDefinition mcp_servers = 4 [deprecated = true];
  
  // References to McpServer resources with optional overrides
  repeated McpServerUsage mcp_server_usages = 8;
}
```

## Migration Path

1. **Phase 1**: Add `mcp_server_usages` field, keep `mcp_servers`
2. **Phase 2**: Runtime resolves both, preferring usages
3. **Phase 3**: Deprecation warning when using inline `mcp_servers`
4. **Phase 4**: CLI tool to migrate inline → referenced

## Related Decisions

- 001-scope-model.md (determines what can be referenced)
- 003-env-var-handling.md (how env vars are provided at runtime)
