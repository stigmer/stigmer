# Proto Mapping Strategy

This document describes how the **Stigmer CLI** converts Go SDK types to protobuf messages.

## Architecture

The SDK follows a **proto-agnostic architecture**:

```
User Repository (Pure Go)
    ↓ uses
Go SDK (No Proto Dependencies)
    ↓ reads
Stigmer CLI
    ↓ converts
Proto Messages
    ↓ sends
Stigmer Platform
```

**Key Points:**
- ✅ SDK has no proto dependencies
- ✅ SDK provides pure Go API
- ✅ CLI handles all proto conversion
- ✅ Users never see proto types

This document is **for CLI developers** who need to implement the conversion layer.

## Core Mapping: Agent

### SDK Type: `agent.Agent`

```go
// sdk/go/agent/agent.go
type Agent struct {
    Name                 string
    Instructions         string
    Description          string
    IconURL              string
    Org                  string
    Skills               []skill.Skill
    MCPServers           []mcpserver.MCPServer
    SubAgents            []subagent.SubAgent
    EnvironmentVariables []environment.EnvironmentVariable
}
```

**Note:** SDK has no proto imports! ✅

### Proto Type: `ai.stigmer.agentic.agent.v1.AgentSpec`

```protobuf
message AgentSpec {
  string description = 1;
  string icon_url = 2;
  string instructions = 3;
  repeated McpServerDefinition mcp_servers = 4;
  repeated ai.stigmer.commons.apiresource.ApiResourceReference skill_refs = 5;
  repeated SubAgent sub_agents = 6;
  ai.stigmer.agentic.environment.v1.EnvironmentSpec env_spec = 7;
}
```

### Field Mapping

| Go Field | Proto Field | Notes |
|----------|-------------|-------|
| `Name` | (Metadata) | Stored in ApiResource metadata, not spec |
| `Instructions` | `instructions` | Direct mapping |
| `Description` | `description` | Direct mapping |
| `IconURL` | `icon_url` | Direct mapping |
| `Org` | (Metadata) | Stored in ApiResource metadata |
| `Skills` | `skill_refs` | Converted to ApiResourceReference list |
| `MCPServers` | `mcp_servers` | Converted to McpServerDefinition list |
| `SubAgents` | `sub_agents` | Converted to SubAgent list |
| `EnvironmentVariables` | `env_spec` | Converted to EnvironmentSpec |

## Skills Mapping

### SDK Type: `skill.Skill`

```go
// sdk/go/skill/skill.go
type Skill struct {
    // Discriminator
    IsInline bool
    
    // Inline skill fields
    Name            string
    Description     string
    MarkdownContent string
    
    // Referenced skill fields (platform/org)
    Slug string
    Org  string
}
```

**CLI Behavior:**
1. For inline skills (`IsInline == true`):
   - Create skill on platform first
   - Get the created skill's reference
   - Use reference in agent spec
2. For platform skills (`IsInline == false`, `Org == ""`):
   - Convert to ApiResourceReference with platform scope
3. For organization skills (`IsInline == false`, `Org != ""`):
   - Convert to ApiResourceReference with organization scope

### Proto Type: `ai.stigmer.commons.apiresource.ApiResourceReference`

```protobuf
message ApiResourceReference {
  ApiResourceKind kind = 1;  // enum value 43 for skill
  string id = 2;
  string org = 3;
}
```

### SDK Factory Functions

```go
// Platform skill reference
skill.Platform("coding-standards")
// → Skill{IsInline: false, Slug: "coding-standards", Org: ""}

// Organization skill reference
skill.Organization("my-org", "internal-docs")
// → Skill{IsInline: false, Slug: "internal-docs", Org: "my-org"}

// Inline skill creation
skill.New(
    skill.WithName("my-skill"),
    skill.WithMarkdownFromFile("skills/my-skill.md"),
)
// → Skill{IsInline: true, Name: "my-skill", MarkdownContent: "..."}
```

## MCP Server Mapping

### Go Interface: `mcpserver.MCPServer`

Three implementations:
- `StdioServer` → `McpServerDefinition.stdio`
- `HTTPServer` → `McpServerDefinition.http`
- `DockerServer` → `McpServerDefinition.docker`

### Proto Type: `ai.stigmer.agentic.agent.v1.McpServerDefinition`

```protobuf
message McpServerDefinition {
  string name = 1;
  oneof server_type {
    StdioServer stdio = 2;
    HttpServer http = 3;
    DockerServer docker = 4;
  }
  repeated string enabled_tools = 5;
}
```

### Stdio Server Mapping

| Go Field | Proto Field | Type |
|----------|-------------|------|
| `Name` | `name` | string |
| `Command` | `stdio.command` | string |
| `Args` | `stdio.args` | []string |
| `EnvPlaceholders` | `stdio.env_placeholders` | map[string]string |
| `WorkingDir` | `stdio.working_dir` | string |
| `EnabledTools` | `enabled_tools` | []string |

### HTTP Server Mapping

| Go Field | Proto Field | Type |
|----------|-------------|------|
| `Name` | `name` | string |
| `URL` | `http.url` | string |
| `Headers` | `http.headers` | map[string]string |
| `QueryParams` | `http.query_params` | map[string]string |
| `TimeoutSeconds` | `http.timeout_seconds` | int32 |
| `EnabledTools` | `enabled_tools` | []string |

### Docker Server Mapping

| Go Field | Proto Field | Type |
|----------|-------------|------|
| `Name` | `name` | string |
| `Image` | `docker.image` | string |
| `Args` | `docker.args` | []string |
| `EnvPlaceholders` | `docker.env_placeholders` | map[string]string |
| `VolumeMounts` | `docker.volume_mounts` | []DockerVolumeMount |
| `PortMappings` | `docker.port_mappings` | []DockerPortMapping |
| `Network` | `docker.network` | string |
| `ContainerName` | `docker.container_name` | string |
| `EnabledTools` | `enabled_tools` | []string |

## Sub-Agent Mapping

### Go Interface: `subagent.SubAgent`

Two implementations:
- `InlineSubAgent` → `SubAgent.inline_spec`
- `ReferencedSubAgent` → `SubAgent.agent_instance_refs`

### Proto Type: `ai.stigmer.agentic.agent.v1.SubAgent`

```protobuf
message SubAgent {
  oneof agent_reference {
    InlineSubAgentSpec inline_spec = 1;
    ai.stigmer.commons.apiresource.ApiResourceReference agent_instance_refs = 2;
  }
}
```

### Inline Sub-Agent Mapping

| Go Field | Proto Field | Type |
|----------|-------------|------|
| `Name` | `inline_spec.name` | string |
| `Description` | `inline_spec.description` | string |
| `Instructions` | `inline_spec.instructions` | string |
| `MCPServers` | `inline_spec.mcp_servers` | []string (names) |
| `MCPToolSelections` | `inline_spec.mcp_tool_selections` | map[string]McpToolSelection |
| `Skills` | `inline_spec.skill_refs` | []ApiResourceReference |

### Referenced Sub-Agent Mapping

| Go Field | Proto Field | Notes |
|----------|-------------|-------|
| `AgentInstanceID` | `agent_instance_refs.id` | Reference to existing AgentInstance |

## Environment Variables Mapping

### Go Type: `environment.EnvironmentVariable`

```go
type EnvironmentVariable struct {
    Name         string
    Description  string
    IsSecret     bool
    DefaultValue string
}
```

### Proto Type: `ai.stigmer.agentic.environment.v1.EnvironmentSpec`

```protobuf
message EnvironmentSpec {
  repeated EnvironmentVariable env_vars = 1;
}

message EnvironmentVariable {
  string name = 1;
  string description = 2;
  bool is_secret = 3;
  string default_value = 4;
}
```

### Field Mapping

All fields map directly:
- `Name` → `name`
- `Description` → `description`
- `IsSecret` → `is_secret`
- `DefaultValue` → `default_value`

Multiple `EnvironmentVariable` instances are collected into a single `EnvironmentSpec` at the Agent level.

## Import Paths

### SDK Imports (User Code)

Users only import SDK packages:

```go
import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/skill"
    "github.com/stigmer/stigmer/sdk/go/mcpserver"
    "github.com/stigmer/stigmer/sdk/go/subagent"
    "github.com/stigmer/stigmer/sdk/go/environment"
)

// No proto imports! ✅
```

### CLI Imports (CLI Code Only)

CLI imports both SDK and proto:

```go
// CLI converter code
import (
    // SDK imports
    sdkagent "github.com/stigmer/stigmer/sdk/go/agent"
    sdkskill "github.com/stigmer/stigmer/sdk/go/skill"
    
    // Proto imports (CLI only!)
    agentv1 "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    skillv1 "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
    environmentv1 "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
    apiresource "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)
```

### Generated Proto Stubs Location

```
apis/stubs/go/github.com/leftbin/stigmer/apis/stubs/go/
├── ai/
│   └── stigmer/
│       ├── agentic/
│       │   ├── agent/v1/
│       │   ├── skill/v1/
│       │   └── environment/v1/
│       └── commons/
│           └── apiresource/
```

## CLI Conversion Implementation

### Conversion Flow (CLI Responsibility)

```go
// cli/internal/converter/agent.go

import (
    agentv1 "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    sdkagent "github.com/stigmer/stigmer/sdk/go/agent"
)

func AgentToProto(sdk *sdkagent.Agent) *agentv1.AgentSpec {
    return &agentv1.AgentSpec{
        Description:  sdk.Description,
        IconUrl:      sdk.IconURL,
        Instructions: sdk.Instructions,
        McpServers:   convertMCPServers(sdk.MCPServers),
        SkillRefs:    convertSkills(sdk.Skills, sdk.Org),
        SubAgents:    convertSubAgents(sdk.SubAgents, sdk.Org),
        EnvSpec:      convertEnvironmentVariables(sdk.EnvironmentVariables),
    }
}
```

### Inline Resource Handling (CLI Responsibility)

```go
// cli/internal/converter/skill.go

func convertSkills(skills []skill.Skill, agentOrg string) []*apiresource.ApiResourceReference {
    refs := make([]*apiresource.ApiResourceReference, 0)
    
    for _, skill := range skills {
        if skill.IsInline {
            // CLI creates inline skill on platform first
            skillProto := &skillv1.Skill{
                Metadata: &apiresource.ApiResourceMetadata{
                    Name: skill.Name,
                    Org:  agentOrg,
                },
                Spec: &skillv1.SkillSpec{
                    Description:     skill.Description,
                    MarkdownContent: skill.MarkdownContent,
                },
            }
            
            // Create on platform
            created, _ := platformClient.CreateSkill(skillProto)
            
            // Use the created skill's reference
            refs = append(refs, &apiresource.ApiResourceReference{
                Scope: apiresource.ApiResourceOwnerScope_organization,
                Org:   agentOrg,
                Kind:  43, // skill kind
                Slug:  skill.Name,
            })
        } else {
            // Reference existing skill
            scope := apiresource.ApiResourceOwnerScope_platform
            if skill.Org != "" {
                scope = apiresource.ApiResourceOwnerScope_organization
            }
            
            refs = append(refs, &apiresource.ApiResourceReference{
                Scope: scope,
                Org:   skill.Org,
                Kind:  43,
                Slug:  skill.Slug,
            })
        }
    }
    
    return refs
}
```

**Key CLI Responsibilities:**
1. ✅ Detect inline resources
2. ✅ Create inline resources on platform
3. ✅ Collect references for inline resources
4. ✅ Convert SDK objects to proto
5. ✅ Deploy to platform

## Validation Strategy

### Three-Layer Validation

**Layer 1: SDK Validation (User-Facing)**

Validation happens at construction time in the Go SDK:
- Name format (lowercase, alphanumeric, hyphens, max 63 chars)
- Instructions length (min 10, max 10000)
- Description length (max 500)
- URL format validation
- Required fields

**Layer 2: CLI Validation (Pre-Deployment)**

CLI validates before calling platform:
- File existence checks (instructions, skills)
- Circular dependency detection (sub-agents)
- Resource name uniqueness
- Proto conversion errors

**Layer 3: Proto/Platform Validation (Final Gate)**

Protobuf validation annotations (buf.validate) and platform business logic:
- Field presence checks
- String length constraints
- Enum value constraints
- Custom CEL expressions
- Authorization checks

### Benefits

1. **SDK Layer**: Immediate feedback during development
2. **CLI Layer**: Catch deployment issues before API calls
3. **Proto Layer**: Enforce platform-wide constraints

This provides excellent developer experience while ensuring platform integrity.

## Type Safety

### Go Benefits

- Compile-time type checking
- IDE autocomplete
- Clear API contracts

### Proto Benefits

- Cross-language compatibility
- Wire format efficiency
- Schema evolution support

## Error Handling

### Validation Errors

```go
type ValidationError struct {
    Field   string
    Value   string
    Rule    string
    Message string
    Err     error
}
```

### Conversion Errors

```go
type ConversionError struct {
    Type    string
    Field   string
    Message string
    Err     error
}
```

## Testing Strategy

### SDK Tests (No Proto)

SDK tests focus on domain logic without proto:

```go
// sdk/go/agent/agent_test.go

func TestAgent_AddSkill(t *testing.T) {
    agent, _ := agent.New(agent.WithName("test"))
    skill := skill.Platform("test-skill")
    
    agent.AddSkill(skill)
    
    assert.Equal(t, 1, len(agent.Skills))
    assert.Equal(t, "test-skill", agent.Skills[0].Slug)
}

// No proto imports! ✅
```

### CLI Converter Tests (With Proto)

CLI tests focus on conversion logic:

```go
// cli/internal/converter/agent_test.go

func TestAgentToProto(t *testing.T) {
    sdkAgent, _ := agent.New(
        agent.WithName("test"),
        agent.WithInstructions("Test instructions"),
    )
    
    proto := converter.AgentToProto(sdkAgent)
    
    assert.Equal(t, "Test instructions", proto.GetInstructions())
}
```

### Integration Tests

End-to-end tests:
1. Create SDK agent with all features
2. Convert to proto via CLI converter
3. Verify all fields preserved
4. Verify inline resources created
5. Test platform deployment (with mock or real API)

### Golden Tests

Store expected proto outputs as golden files:
- Parse proto text format
- Compare with actual conversion output
- Catch unintended conversion changes
