# Task T01: McpServer API Resource - Design & Implementation Plan

**Created**: 2026-01-26 03:51
**Status**: PENDING REVIEW
**Type**: Feature Development (Foundation)

⚠️ **This plan requires your review before execution**

## Executive Summary

Extract MCP server configuration from `AgentSpec` into a first-class `McpServer` API resource, enabling:
- **Reusability**: Define once, use across multiple agents
- **Multi-Scope Support**: Platform (marketplace), Organization (private), Identity Account (personal)
- **FGA Authorization**: Proper access control with scope-based permissions
- **Marketplace Discoverability**: Tags, descriptions, tool catalogs

---

## Current State Analysis

### What Exists Today

**Location**: `apis/ai/stigmer/agentic/agent/v1/spec.proto`

```protobuf
message AgentSpec {
  // MCP server definitions declaring required servers (not configured instances).
  repeated McpServerDefinition mcp_servers = 4;
  // ...
}
```

**Embedded Types**:
- `McpServerDefinition` - Main server definition with name, server_type oneof
- `StdioServer` - Subprocess-based servers (npx, python, node)
- `HttpServer` - HTTP + SSE servers (remote services)
- `DockerServer` - Containerized MCP servers
- Supporting types: `VolumeMount`, `PortMapping`, `McpToolSelection`

**Problems with Current Approach**:
1. No reusability - each agent must define MCP servers inline
2. No discoverability - can't browse available MCP servers
3. No shared configuration - duplicate definitions across agents
4. No authorization model - embedded in agent, inherits agent's permissions
5. No versioning or lifecycle management

---

## Proposed Architecture

### 1. New API Resource Structure

**Package**: `ai.stigmer.agentic.mcpserver.v1`

```
apis/ai/stigmer/agentic/mcpserver/v1/
├── api.proto          # McpServer resource definition
├── spec.proto         # McpServerSpec (configuration)
├── status.proto       # McpServerStatus (observed state)
├── io.proto           # Input/output messages
├── query.proto        # Query service (Get, List, Search)
├── command.proto      # Command service (Create, Update, Delete)
```

### 2. Proto Definitions

#### api.proto
```protobuf
syntax = "proto3";
package ai.stigmer.agentic.mcpserver.v1;

message McpServer {
  string api_version = 1;  // "agentic.stigmer.ai/v1"
  string kind = 2;         // "McpServer"
  
  // Supports all three scopes: platform, organization, identity_account
  ai.stigmer.commons.apiresource.ApiResourceMetadata metadata = 3;
  
  McpServerSpec spec = 4;
  McpServerStatus status = 5;
}
```

#### spec.proto
```protobuf
syntax = "proto3";
package ai.stigmer.agentic.mcpserver.v1;

message McpServerSpec {
  // Human-readable description for marketplace display
  string description = 1;
  
  // Icon URL for UI display
  string icon_url = 2;
  
  // Categorization tags for discoverability
  // Examples: ["code-analysis", "git", "infrastructure", "communication"]
  repeated string tags = 3;
  
  // Server type and transport configuration (choose one)
  oneof server_type {
    StdioServerConfig stdio = 4;
    HttpServerConfig http = 5;
    DockerServerConfig docker = 6;
  }
  
  // Default tools to enable (empty = all tools)
  repeated string default_enabled_tools = 7;
  
  // Environment variable schema - declares required env vars
  // This is the SCHEMA, not the values (values come from AgentInstance)
  repeated EnvVarSchema env_schema = 8;
}

message EnvVarSchema {
  string name = 1;              // e.g., "GITHUB_TOKEN"
  string description = 2;       // e.g., "GitHub personal access token"
  bool required = 3;            // Whether this env var is required
  string default_value = 4;     // Optional default value
  bool is_secret = 5;           // Whether this should be treated as a secret
}

// StdioServerConfig, HttpServerConfig, DockerServerConfig
// (Move existing definitions from agent/v1/spec.proto with refinements)
```

#### status.proto
```protobuf
syntax = "proto3";
package ai.stigmer.agentic.mcpserver.v1;

message McpServerStatus {
  // Validation state
  ValidationState validation_state = 1;
  
  // Discovered tools (populated when server is probed)
  repeated DiscoveredTool discovered_tools = 2;
  
  // Last health check timestamp and result
  google.protobuf.Timestamp last_health_check = 3;
  HealthState health_state = 4;
}

message DiscoveredTool {
  string name = 1;
  string description = 2;
  string input_schema_json = 3;  // JSON Schema for tool input
}

enum ValidationState {
  VALIDATION_STATE_UNSPECIFIED = 0;
  VALIDATION_STATE_VALID = 1;
  VALIDATION_STATE_INVALID = 2;
}

enum HealthState {
  HEALTH_STATE_UNSPECIFIED = 0;
  HEALTH_STATE_HEALTHY = 1;
  HEALTH_STATE_UNHEALTHY = 2;
  HEALTH_STATE_UNKNOWN = 3;
}
```

### 3. Agent Integration

**Update `AgentSpec`** to support both inline (deprecated) and referenced MCP servers:

```protobuf
message AgentSpec {
  // DEPRECATED: Use mcp_server_refs instead
  // Inline MCP server definitions (kept for backward compatibility)
  repeated McpServerDefinition mcp_servers = 4 [deprecated = true];
  
  // NEW: References to McpServer resources with optional overrides
  repeated McpServerUsage mcp_server_usages = 8;
}

// McpServerUsage allows referencing an McpServer with per-agent customization
message McpServerUsage {
  // Reference to McpServer resource
  ai.stigmer.commons.apiresource.ApiResourceReference mcp_server_ref = 1;
  
  // Override default enabled tools for this agent
  // Empty = use McpServer's default_enabled_tools
  repeated string enabled_tools_override = 2;
  
  // Alias for this MCP server within this agent
  // Useful when using multiple instances of same server type
  string alias = 3;
}
```

### 4. FGA Authorization Model

**File**: `stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga/model/mcp_server.fga`

```fga
model
  schema 1.1

type mcp_server
  relations
    # Mutually exclusive scopes (all three supported)
    define platform: [platform]
    define organization: [organization]
    define identity_account: [identity_account]
    
    # Operator access from any scope
    define operator: operator from platform or operator from organization or operator from identity_account
    
    # Ownership
    define owner: [identity_account] or admin from organization or operator
    
    # Viewers - scope-appropriate access
    # Platform-scoped: everyone can view (marketplace)
    # Org-scoped: org members can view
    # User-scoped: only owner can view
    define viewer: owner or member from organization
    
    # CRUD permissions
    define can_view: viewer or platform
    define can_edit: owner
    define can_delete: owner
    define can_use: viewer or platform
```

### 5. Scope Model

| Scope | Owner | Visibility | Use Case |
|-------|-------|------------|----------|
| **Platform** | Stigmer (platform operators) | Public (all users) | Generic MCP servers: GitHub, Slack, AWS, filesystem |
| **Organization** | Org admins | Org members | Private org-specific MCP servers, internal APIs |
| **Identity Account** | Individual user | Only owner | Personal dev tools, local integrations |

### 6. ApiResourceKind Enum Addition

**File**: `apis/ai/stigmer/commons/apiresource/enum.proto`

Add new kind:
```protobuf
enum ApiResourceKind {
  // ... existing kinds ...
  mcp_server = XX;  // Need to determine next available number
}
```

---

## Implementation Phases

### Phase 1: Proto Definitions (stigmer repo)

**Tasks**:
1. [ ] Create `apis/ai/stigmer/agentic/mcpserver/v1/` directory structure
2. [ ] Create `spec.proto` with McpServerSpec, server configs, EnvVarSchema
3. [ ] Create `status.proto` with McpServerStatus, DiscoveredTool
4. [ ] Create `api.proto` with McpServer resource
5. [ ] Create `io.proto` with input/output messages
6. [ ] Create `query.proto` with Get, List, Search services
7. [ ] Create `command.proto` with Create, Update, Delete services
8. [ ] Add `mcp_server` to ApiResourceKind enum
9. [ ] Add buf.validate rules for all fields
10. [ ] Run `make build-protos` to generate stubs (Go, Python, Java, TypeScript)

**Reference Files**:
- `apis/ai/stigmer/agentic/skill/v1/*.proto` (pattern to follow)
- `apis/ai/stigmer/agentic/agent/v1/spec.proto` (existing MCP definitions to extract)

### Phase 2: AgentSpec Migration (stigmer repo)

**Tasks**:
1. [ ] Add `McpServerUsage` message to `agent/v1/spec.proto`
2. [ ] Add `mcp_server_usages` field to `AgentSpec`
3. [ ] Mark `mcp_servers` field as deprecated
4. [ ] Update InlineSubAgentSpec to support McpServer references
5. [ ] Regenerate stubs

### Phase 3: FGA Model (stigmer-cloud repo)

**Tasks**:
1. [ ] Create `mcp_server.fga` model file
2. [ ] Test FGA model with sample tuples
3. [ ] Integrate with FGA sync pipeline

### Phase 4: Backend Handlers (stigmer-cloud repo)

**Tasks**:
1. [ ] Create `McpServerCreateHandler` (Java)
2. [ ] Create `McpServerGetHandler`
3. [ ] Create `McpServerUpdateHandler`
4. [ ] Create `McpServerDeleteHandler`
5. [ ] Create `McpServerListHandler`
6. [ ] Create `McpServerSearchHandler`
7. [ ] Implement IAM policy creation for all three scopes
8. [ ] Add validation logic

**Reference Files**:
- `backend/services/stigmer-service/src/main/java/ai/stigmer/agentic/skill/` (pattern to follow)

### Phase 5: Agent Runner Integration (stigmer-cloud repo)

**Tasks**:
1. [ ] Update agent runner to resolve McpServer references
2. [ ] Implement env var merging (schema from McpServer + values from AgentInstance)
3. [ ] Support both inline and referenced MCP servers (backward compatibility)
4. [ ] Add tool filtering based on enabled_tools_override

### Phase 6: CLI Commands (stigmer repo)

**Tasks**:
1. [ ] `stigmer mcpserver create` command
2. [ ] `stigmer mcpserver get` command
3. [ ] `stigmer mcpserver list` command
4. [ ] `stigmer mcpserver update` command
5. [ ] `stigmer mcpserver delete` command
6. [ ] Migration helper: extract inline to resource

---

## Open Questions (Require Decision)

### Q1: Versioning Model
**Options**:
- **A) Mutable**: McpServer can be updated in place (simpler)
- **B) Immutable + Tags**: Like Skill, content-addressable with version tags (safer)

**Recommendation**: Start with A (Mutable), consider B later if needed.

### Q2: Published vs Draft State
**Question**: Should platform MCP servers go through a review/publish workflow?

**Recommendation**: No for MVP. Add later if needed.

### Q3: McpServer vs McpServerInstance
**Question**: Should we split definition from deployment (like Agent/AgentInstance)?

**Recommendation**: No for MVP. The current design handles this via:
- McpServer defines the schema (what env vars needed)
- AgentInstance provides values (via Environment)

### Q4: Tool Discovery
**Question**: Should we actively probe MCP servers to discover tools?

**Recommendation**: Optional/lazy. Populate `discovered_tools` on-demand or via explicit refresh.

---

## Success Criteria

- [ ] McpServer proto definitions compile without errors
- [ ] All stubs generated (Go, Python, Java, TypeScript)
- [ ] FGA model passes validation
- [ ] Backend handlers implement full CRUD
- [ ] Agents can reference McpServer resources
- [ ] Existing inline MCP configs continue to work (backward compatibility)
- [ ] CLI commands functional

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing agents | Keep `mcp_servers` field, mark deprecated |
| Cross-repo coordination | Phase 1-2 in stigmer, then Phase 3-5 in stigmer-cloud |
| FGA complexity | Follow existing Skill FGA pattern closely |
| Migration burden | Provide CLI migration tool |

---

## Review Process

**What happens next**:
1. **You review this plan** - Consider the architecture, scope model, and phases
2. **Provide feedback** - Any concerns, alternative approaches, or missing requirements
3. **I'll revise the plan** - Create T01_2_revised_plan.md incorporating feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Implementation tracked in T01_3_execution.md

**Please consider**:
- Does the scope model (platform/org/user) make sense for your use cases?
- Is the `McpServerUsage` pattern (reference + overrides) the right approach?
- Are there any MCP server types or configurations we're missing?
- Should we support versioning from the start?
- Any concerns about the migration strategy?
