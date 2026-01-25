# Task T01: McpServer API Resource - Design & Implementation Plan

**Created**: 2026-01-26 03:51
**Last Updated**: 2026-01-26
**Status**: APPROVED
**Type**: Feature Development (Foundation)

---

## Executive Summary

Extract MCP server configuration from `AgentSpec` into a first-class `McpServer` API resource, enabling:
- **Reusability**: Define once, use across multiple agents
- **Multi-Scope Support**: Platform (marketplace), Organization (private), Identity Account (personal)
- **FGA Authorization**: Proper access control with scope-based permissions
- **Marketplace Discoverability**: Tags, descriptions, tool catalogs

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         McpServer Resource                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ metadata: {scope: platform|org|identity_account, name: ...}  │   │
│  │ spec: {                                                      │   │
│  │   description, icon_url, tags,                               │   │
│  │   server_type: {stdio|http|docker},                          │   │
│  │   default_enabled_tools,                                     │   │
│  │   env_spec: EnvironmentSpec  ← REUSES EXISTING               │   │
│  │ }                                                            │   │
│  │ status: {validation_state}  ← SIMPLIFIED (no tool discovery) │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ referenced by
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Agent (with McpServerUsage)                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ mcp_server_usages: [                                         │   │
│  │   { mcp_server_ref: {...}, enabled_tools_override: [...] }   │   │
│  │ ]                                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ instantiated as
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              AgentInstance (provides actual secrets)                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ environment_ref: {...}  ← Contains actual GITHUB_TOKEN etc   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ at runtime
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Agent Runner (discovers tools here)                 │
│  1. Resolve McpServer from reference                                │
│  2. Get secrets from AgentInstance's environment                    │
│  3. Start MCP server with actual credentials                        │
│  4. Call tools/list to discover available tools  ← RUNTIME ONLY     │
│  5. Filter by enabled_tools                                         │
└─────────────────────────────────────────────────────────────────────┘
```

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

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Environment handling | Reuse `EnvironmentSpec` | Consistency with Agent/Workflow patterns |
| Tool discovery | Runtime only (in agent-runner) | Requires valid credentials to probe MCP servers |
| Health checks | Not in resource status | Happens at runtime in agent-runner |
| Versioning | Mutable (start simple) | Add immutability later if needed |
| Published/Draft | No | Not needed for MVP |
| McpServer vs McpServerInstance | No split | AgentInstance provides actual values |
| Primary interface | CLI commands (`apply -f`) | Infrastructure-level resource, Kubernetes-style |
| SDK integration | Reference only | SDK doesn't create MCP servers |

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
├── command.proto      # Command service (Create, Update, Delete, Apply)
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

import "ai/stigmer/agentic/environment/v1/spec.proto";
import "buf/validate/validate.proto";

// McpServerSpec defines the configuration template for an MCP server.
// This is a reusable definition - actual secrets come from AgentInstance's environment.
message McpServerSpec {
  // Human-readable description for marketplace display.
  string description = 1;
  
  // Icon URL for UI display.
  string icon_url = 2;
  
  // Categorization tags for discoverability.
  // Examples: ["code-analysis", "git", "infrastructure", "communication"]
  repeated string tags = 3;
  
  // Server type and transport configuration (choose one).
  oneof server_type {
    StdioServerConfig stdio = 4;
    HttpServerConfig http = 5;
    DockerServerConfig docker = 6;
  }
  
  // Default tools to enable (empty = all tools).
  repeated string default_enabled_tools = 7;
  
  // Environment specification - declares required env vars.
  // Uses shared EnvironmentSpec for consistency with Agent/Workflow patterns.
  // Values can be empty (schema only) - actual values provided by AgentInstance.
  ai.stigmer.agentic.environment.v1.EnvironmentSpec env_spec = 8;
}

// StdioServerConfig, HttpServerConfig, DockerServerConfig
// (Move existing definitions from agent/v1/spec.proto with refinements)
```

#### status.proto (Simplified - No Tool Discovery)
```protobuf
syntax = "proto3";
package ai.stigmer.agentic.mcpserver.v1;

// McpServerStatus represents the observed state of an MCP server definition.
// Note: Tool discovery happens at RUNTIME (in agent-runner), not here.
// This status tracks only the validity of the definition itself.
message McpServerStatus {
  // Validation state of the MCP server definition.
  ValidationState validation_state = 1;
  
  // Human-readable validation message (populated if invalid).
  string validation_message = 2;
}

enum ValidationState {
  VALIDATION_STATE_UNSPECIFIED = 0;
  VALIDATION_STATE_VALID = 1;
  VALIDATION_STATE_INVALID = 2;
}
```

**What's NOT in status (by design):**
- ~~`discovered_tools`~~ - Requires runtime credentials, happens in agent-runner
- ~~`last_health_check`~~ - Requires runtime credentials, happens in agent-runner
- ~~`health_state`~~ - Requires runtime credentials, happens in agent-runner

### 3. Agent Integration

**Update `AgentSpec`** to support both inline (deprecated) and referenced MCP servers:

```protobuf
message AgentSpec {
  // DEPRECATED: Use mcp_server_usages instead
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

## CLI Design: `stigmer mcpserver` Commands

### Design Principles

1. **`apply -f`** - Kubernetes-style idempotent create/update
2. **YAML-first** - All config in file, flags for overrides only
3. **Safe defaults** - `identity_account` scope unless explicit
4. **Consistent** - Same patterns as kubectl

### Command Structure

```bash
# Primary command - idempotent create/update (Kubernetes-style)
stigmer mcpserver apply -f <file.yaml>

# Read operations
stigmer mcpserver get <name>
stigmer mcpserver list

# Delete
stigmer mcpserver delete <name>

# Helper to generate template
stigmer mcpserver init --type <stdio|http|docker>
```

### YAML Configuration Format

```yaml
# github-mcp.yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  scope: platform          # platform | organization | identity_account
  # org: my-org            # required if scope=organization
spec:
  description: "GitHub MCP server for repository operations"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"
  tags:
    - git
    - vcs
    - code-analysis
  
  stdio:                   # or http: or docker:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
  
  default_enabled_tools: [] # empty = all tools
  
  env_spec:
    data:
      GITHUB_TOKEN:
        is_secret: true
        description: "GitHub personal access token with repo scope"
```

### Scope Handling Strategy

| Source | Behavior |
|--------|----------|
| YAML `metadata.scope` | Primary - always use if specified |
| Context (like kubectl) | Fallback - if YAML doesn't specify |
| Default | `identity_account` (safest default) |

**Why default to `identity_account`:**
- Safest: only affects the user, not org or platform
- Most common use case: personal MCP servers for development
- Explicit opt-in for broader scope (org/platform)

### Complete Command Reference

#### `stigmer mcpserver apply`
```bash
# Apply from YAML file (all metadata in file)
stigmer mcpserver apply -f github-mcp.yaml

# Dry run (validate without applying)
stigmer mcpserver apply -f github-mcp.yaml --dry-run

# Override scope (useful for promoting resources)
stigmer mcpserver apply -f github-mcp.yaml --scope platform
```

**Behavior:**
- Creates if doesn't exist
- Updates if exists (idempotent)
- Name and scope from YAML (or flags override)

#### `stigmer mcpserver get`
```bash
# Get by name (uses scope from context or default)
stigmer mcpserver get github

# Get with explicit scope
stigmer mcpserver get github --scope platform
stigmer mcpserver get internal-api --scope organization --org my-org

# Output formats
stigmer mcpserver get github -o yaml
stigmer mcpserver get github -o json
```

#### `stigmer mcpserver list`
```bash
# List all accessible (platform + org + personal)
stigmer mcpserver list

# Filter by scope
stigmer mcpserver list --scope platform           # marketplace
stigmer mcpserver list --scope organization --org my-org
stigmer mcpserver list --scope identity_account   # personal

# Filter by tags
stigmer mcpserver list --tag git --tag vcs
```

#### `stigmer mcpserver delete`
```bash
# Delete (requires explicit scope for safety)
stigmer mcpserver delete github --scope identity_account

# Force delete (skip confirmation)
stigmer mcpserver delete github --scope identity_account --force
```

#### `stigmer mcpserver init`
```bash
# Generate template YAML (to stdout or file)
stigmer mcpserver init --type stdio > my-mcp.yaml
stigmer mcpserver init --type http > my-http-mcp.yaml
stigmer mcpserver init --type docker > my-docker-mcp.yaml

# With name pre-filled
stigmer mcpserver init --type stdio --name github > github-mcp.yaml
```

### Example Workflows

**1. Create personal MCP server (most common)**
```bash
# Generate template
stigmer mcpserver init --type stdio --name github > github-mcp.yaml

# Edit the YAML (add description, env vars, etc.)
# ...

# Apply (creates in identity_account scope by default)
stigmer mcpserver apply -f github-mcp.yaml
```

**2. Create org-shared MCP server**
```yaml
# internal-mcp.yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: internal-api
  scope: organization
  org: my-org
spec:
  description: "Internal company API"
  http:
    url: "https://internal.company.com/mcp"
```
```bash
stigmer mcpserver apply -f internal-mcp.yaml
```

**3. Platform team publishes marketplace MCP server**
```yaml
# marketplace/github-mcp.yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  scope: platform
spec:
  description: "Official GitHub MCP server"
  # ...
```
```bash
stigmer mcpserver apply -f marketplace/github-mcp.yaml
```

### Output Examples

**Apply success:**
```
Applying MCP server from: github-mcp.yaml

  Name:  github
  Scope: identity_account

✓ MCP server applied successfully

  Status: created (new resource)
  # or: Status: updated (existing resource)

Next steps:
  - Reference this MCP server in your agent definition
  - View details: stigmer mcpserver get github
```

**List output:**
```
NAME          SCOPE              TYPE    TAGS              
github        platform           stdio   git, vcs          
slack         platform           stdio   communication     
internal-api  organization/my-org http   internal          
local-dev     identity_account   docker  development       
```

---

## Implementation Phases

### Phase 1: Proto Definitions (stigmer repo)

**Tasks**:
1. [ ] Create `apis/ai/stigmer/agentic/mcpserver/v1/` directory structure
2. [ ] Create `spec.proto` with McpServerSpec, server configs (move from `agent/v1/spec.proto`)
3. [ ] Create `status.proto` with simplified McpServerStatus (validation only)
4. [ ] Create `api.proto` with McpServer resource
5. [ ] Create `io.proto` with input/output messages
6. [ ] Create `query.proto` with Get, List, Search services
7. [ ] Create `command.proto` with Create, Update, Delete, Apply services
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
1. [ ] Create `McpServerApplyHandler` (Java) - handles create/update
2. [ ] Create `McpServerGetHandler`
3. [ ] Create `McpServerDeleteHandler`
4. [ ] Create `McpServerListHandler`
5. [ ] Create `McpServerSearchHandler`
6. [ ] Implement IAM policy creation for all three scopes
7. [ ] Add validation logic

**Reference Files**:
- `backend/services/stigmer-service/src/main/java/ai/stigmer/agentic/skill/` (pattern to follow)

### Phase 5: Agent Runner Integration (stigmer-cloud repo)

**Tasks**:
1. [ ] Update agent runner to resolve McpServer references
2. [ ] Implement env var merging (schema from McpServer + values from AgentInstance)
3. [ ] Support both inline and referenced MCP servers (backward compatibility)
4. [ ] Add tool filtering based on enabled_tools_override
5. [ ] Tool discovery happens here at runtime (with actual credentials)

### Phase 6: CLI Commands (stigmer repo) - **Primary Interface**

**Tasks**:
1. [ ] `stigmer mcpserver apply` command (Kubernetes-style)
2. [ ] `stigmer mcpserver get` command
3. [ ] `stigmer mcpserver list` command
4. [ ] `stigmer mcpserver delete` command
5. [ ] `stigmer mcpserver init` command (template generator)
6. [ ] YAML parsing and validation

---

## What's NOT in Scope for MVP

1. **Tool discovery at resource level** - Happens at runtime only (requires credentials)
2. **Health monitoring** - Future enhancement
3. **Versioning/immutability** - Start mutable, add later if needed
4. **Published/Draft workflow** - Not needed initially
5. **McpServer vs McpServerInstance split** - Single resource is sufficient
6. **SDK creation methods** - CLI is the interface for MCP server management

---

## Success Criteria

- [ ] McpServer proto definitions compile without errors
- [ ] All stubs generated (Go, Python, Java, TypeScript)
- [ ] FGA model passes validation
- [ ] Backend handlers implement Apply, Get, Delete, List
- [ ] Agents can reference McpServer resources
- [ ] Existing inline MCP configs continue to work (backward compatibility)
- [ ] CLI commands functional (`apply -f`, `get`, `list`, `delete`, `init`)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing agents | Keep `mcp_servers` field, mark deprecated |
| Cross-repo coordination | Phase 1-2 in stigmer, then Phase 3-5 in stigmer-cloud |
| FGA complexity | Follow existing Skill FGA pattern closely |
| Migration burden | Provide CLI `init` command for easy onboarding |

---

## Appendix: Design Rationale

### Why EnvironmentSpec instead of new EnvVarSchema?

The original plan proposed a new `EnvVarSchema` message. However, `EnvironmentSpec` already exists and is used consistently:
- `AgentSpec.env_spec`
- Workflow environment handling
- The `EnvironmentValue` message explicitly states: *"Value can be empty when defining environment variables in specs. Actual values are typically provided at runtime."*

Using `EnvironmentSpec` maintains consistency across the platform.

### Why no tool discovery in McpServerStatus?

Tool discovery requires actually connecting to the MCP server and calling `tools/list`. This requires:
1. Valid credentials (e.g., `GITHUB_TOKEN`)
2. Network connectivity to the server
3. The server to be running

The McpServer resource is a **template/definition** - it declares what env vars are needed, not their values. Actual secrets come from `AgentInstance.environment_ref` at runtime.

Therefore, tool discovery belongs in the **agent-runner** (runtime layer), not the **McpServer** (resource layer).

### Why CLI-first, not SDK?

MCP servers are **infrastructure-level resources** that should be:
- Created once (via CLI or UI)
- Referenced many times (from Agents)

This is similar to how you don't create Kubernetes ConfigMaps in application code - you create them via `kubectl` and reference them. The SDK's job is to help developers build agents that **use** MCP servers, not create them.
