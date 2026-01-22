# Task T02: Option C - Apply Code Generation to Agent/Skill SDK

**Created**: 2026-01-22  
**Status**: 🚀 READY TO START  
**Estimated Time**: 3-4 hours

---

## Goal

Apply the proven code generation pattern from Workflow SDK to Agent and Skill SDK:
- Generate low-level config structs and proto conversion
- Keep high-level builder API manual (like Workflow)
- Add SDK annotation helpers for metadata
- Prove pattern works across all resource types

---

## Success Criteria

- ✅ Agent SDK compiles with generated code
- ✅ Skill SDK compiles with generated code
- ✅ All existing examples work unchanged
- ✅ SDK writes platform protos directly (Agent, Skill)
- ✅ SDK metadata stored in annotations (Kubernetes-style)
- ✅ Tests pass

---

## Architecture

### What We Generate (New)

**Agent SDK**:
```
sdk/go/agent/gen/
├── agent_config.go          # AgentSpec struct (generated)
├── agent_proto.go           # ToProto/FromProto (generated)
├── mcp_server_config.go     # McpServerDefinition structs (generated)
├── mcp_server_proto.go      # ToProto/FromProto (generated)
├── sub_agent_config.go      # SubAgent structs (generated)
└── sub_agent_proto.go       # ToProto/FromProto (generated)
```

**Skill SDK**:
```
sdk/go/skill/gen/
├── skill_config.go          # SkillSpec struct (generated)
└── skill_proto.go           # ToProto/FromProto (generated)
```

### What We Keep Manual (Existing)

**Agent SDK** (orchestration layer):
```
sdk/go/agent/
├── agent.go                 # Agent type, New(), builder methods
├── validation.go            # Validation logic
├── ref_helpers.go           # Reference helpers
└── annotations.go           # NEW: SDK metadata helpers
```

**Skill SDK** (orchestration layer):
```
sdk/go/skill/
├── skill.go                 # Skill type, New(), Platform(), Organization()
└── annotations.go           # NEW: SDK metadata helpers
```

**Supporting Packages** (keep as-is):
```
sdk/go/mcpserver/            # MCP server builders (Stdio, HTTP, Docker)
sdk/go/subagent/             # SubAgent builders (Inline, Reference)
sdk/go/environment/          # Environment variable builders
```

---

## Implementation Steps

### Step 1: Create Agent Schemas (30 min)

Generate JSON schemas from Agent protos:

**Agent proto files**:
- `apis/ai/stigmer/agentic/agent/v1/spec.proto`
  - `AgentSpec` - main spec
  - `McpServerDefinition` - server config
  - `SubAgent` - sub-agent config
  - `InlineSubAgentSpec` - inline sub-agent
  - `StdioServer`, `HttpServer`, `DockerServer` - server types
  - `VolumeMount`, `PortMapping` - Docker config
  - `McpToolSelection` - tool selection

**Action**:
```bash
# Use proto2schema tool to generate schemas
cd tools/codegen/proto2schema
go run main.go \
  -proto ../../../apis/ai/stigmer/agentic/agent/v1/spec.proto \
  -output ../schemas/agent/
```

**Expected Output**:
- `schemas/agent/agent_spec.json`
- `schemas/agent/mcp_server_definition.json`
- `schemas/agent/sub_agent.json`
- `schemas/agent/stdio_server.json`
- `schemas/agent/http_server.json`
- `schemas/agent/docker_server.json`
- + nested types

### Step 2: Create Skill Schemas (15 min)

Generate JSON schemas from Skill protos:

**Skill proto files**:
- `apis/ai/stigmer/agentic/skill/v1/spec.proto`
  - `SkillSpec` - main spec (super simple!)

**Action**:
```bash
cd tools/codegen/proto2schema
go run main.go \
  -proto ../../../apis/ai/stigmer/agentic/skill/v1/spec.proto \
  -output ../schemas/skill/
```

**Expected Output**:
- `schemas/skill/skill_spec.json`

### Step 3: Generate Agent Code (45 min)

Use code generator to create Agent SDK code:

**Action**:
```bash
cd tools/codegen/generator
go run main.go \
  -schema ../schemas/agent/agent_spec.json \
  -output ../../../sdk/go/agent/gen/
```

**Expected Generated Files**:
- `sdk/go/agent/gen/agent_config.go` - AgentSpec struct
- `sdk/go/agent/gen/agent_proto.go` - ToProto/FromProto
- `sdk/go/agent/gen/mcp_server_config.go` - MCP server configs
- `sdk/go/agent/gen/mcp_server_proto.go` - MCP server proto conversion
- `sdk/go/agent/gen/sub_agent_config.go` - SubAgent configs
- `sdk/go/agent/gen/sub_agent_proto.go` - SubAgent proto conversion

### Step 4: Generate Skill Code (30 min)

Use code generator to create Skill SDK code:

**Action**:
```bash
cd tools/codegen/generator
go run main.go \
  -schema ../schemas/skill/skill_spec.json \
  -output ../../../sdk/go/skill/gen/
```

**Expected Generated Files**:
- `sdk/go/skill/gen/skill_config.go` - SkillSpec struct
- `sdk/go/skill/gen/skill_proto.go` - ToProto/FromProto

### Step 5: Create SDK Annotation Helpers (30 min)

Create helpers to add SDK metadata to Agent/Skill annotations:

**New Files**:

`sdk/go/agent/annotations.go`:
```go
package agent

// SDK annotation keys following Kubernetes style
const (
    AnnotationSDKLanguage   = "stigmer.ai/sdk.language"
    AnnotationSDKVersion    = "stigmer.ai/sdk.version"
    AnnotationSDKGeneratedAt = "stigmer.ai/sdk.generated-at"
)

// WithSDKAnnotations adds SDK metadata to agent annotations
func WithSDKAnnotations() Option {
    return func(a *Agent) error {
        // Implementation adds SDK metadata to annotations map
        return nil
    }
}
```

`sdk/go/skill/annotations.go`:
```go
package skill

// SDK annotation keys
const (
    AnnotationSDKLanguage   = "stigmer.ai/sdk.language"
    AnnotationSDKVersion    = "stigmer.ai/sdk.version"
    AnnotationSDKGeneratedAt = "stigmer.ai/sdk.generated-at"
)

// WithSDKAnnotations adds SDK metadata to skill annotations
func WithSDKAnnotations() Option {
    return func(s *Skill) error {
        // Implementation adds SDK metadata to annotations map
        return nil
    }
}
```

### Step 6: Update Agent SDK to Use Generated Code (45 min)

Integrate generated code into existing Agent SDK:

**Changes to `sdk/go/agent/agent.go`**:
1. Import `sdk/go/agent/gen` package
2. Use generated `AgentSpec` for proto conversion
3. Keep existing builder API unchanged
4. Add ToProto() method using generated code

**Example Integration**:
```go
package agent

import (
    agentgen "github.com/stigmer/stigmer/sdk/go/agent/gen"
    agentpb "github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agent/v1"
)

// ToProto converts Agent to platform proto using generated code
func (a *Agent) ToProto() (*agentpb.Agent, error) {
    // Build AgentSpec using generated types
    spec := &agentgen.AgentSpec{
        Description: a.Description,
        IconURL: a.IconURL,
        Instructions: a.Instructions,
        // ... use generated ToProto methods
    }
    
    specProto, err := spec.ToProto()
    if err != nil {
        return nil, err
    }
    
    // Build complete Agent proto
    return &agentpb.Agent{
        Metadata: buildMetadata(a),  // Include SDK annotations
        Spec: specProto,
    }, nil
}

func buildMetadata(a *Agent) *apiresource.Metadata {
    return &apiresource.Metadata{
        Name: a.Name,
        Org: a.Org,
        Annotations: map[string]string{
            AnnotationSDKLanguage: "go",
            AnnotationSDKVersion: "0.1.0",
            // ...
        },
    }
}
```

### Step 7: Update Skill SDK to Use Generated Code (30 min)

Integrate generated code into existing Skill SDK:

**Changes to `sdk/go/skill/skill.go`**:
1. Import `sdk/go/skill/gen` package
2. Use generated `SkillSpec` for proto conversion
3. Keep existing builder API unchanged
4. Add ToProto() method using generated code

### Step 8: Update Examples (30 min)

Verify all existing examples work with generated code:

**Examples to test**:
- `examples/01_basic_agent.go` - Basic agent creation
- `examples/02_agent_with_skills.go` - Agent with skills
- `examples/03_agent_with_mcp_servers.go` - Agent with MCP servers
- `examples/04_agent_with_subagents.go` - Agent with sub-agents
- `examples/05_agent_with_environment_variables.go` - Agent with env vars

**Expected**: All examples compile and run without changes to user-facing API.

### Step 9: Run Tests (15 min)

Verify all tests pass:

```bash
cd sdk/go
make test
```

**Test Coverage**:
- Agent builder tests
- Skill builder tests
- Proto conversion tests
- Validation tests
- Integration tests

### Step 10: Update Documentation (30 min)

Update project documentation:

**Files to Update**:
- `_projects/2026-01/20260122.01.sdk-code-generators-go/README.md`
- `_projects/2026-01/20260122.01.sdk-code-generators-go/next-task.md`
- `sdk/go/README.md`

**New Checkpoint**:
- `checkpoints/04-option-c-agent-skill-complete.md`

---

## Validation Checklist

Before declaring Option C complete:

- [ ] Agent proto schemas generated successfully
- [ ] Skill proto schemas generated successfully
- [ ] Agent Go code generated successfully
- [ ] Skill Go code generated successfully
- [ ] SDK annotation helpers created
- [ ] Agent SDK integrated with generated code
- [ ] Skill SDK integrated with generated code
- [ ] All existing examples compile
- [ ] All existing examples run successfully
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Checkpoint created

---

## Key Design Decisions

### 1. Generated vs Manual Split

**Generated** (low-level foundation):
- Config structs (AgentSpec, SkillSpec, etc.)
- Proto conversion (ToProto/FromProto)
- Nested type configs (McpServerDefinition, etc.)

**Manual** (high-level ergonomics):
- Agent/Skill types (orchestration layer)
- Builder methods (New, WithName, etc.)
- Helper packages (mcpserver, subagent, environment)
- Validation logic
- SDK annotation helpers

**Rationale**: Same successful pattern as Workflow SDK. Generated code provides type-safe foundation, manual code provides developer-friendly API.

### 2. SDK Metadata in Annotations

**Decision**: Store SDK metadata in `metadata.annotations` map following Kubernetes conventions.

**Annotation Keys**:
- `stigmer.ai/sdk.language` = "go"
- `stigmer.ai/sdk.version` = "0.1.0"
- `stigmer.ai/sdk.generated-at` = "1706789123"

**Rationale**: 
- No manifest proto wrapper needed
- SDK writes platform protos directly
- Annotations are flexible and extensible
- CLI can read SDK metadata without special handling

### 3. Keep Helper Packages Manual

**Decision**: Do NOT generate code for mcpserver, subagent, environment packages.

**Rationale**:
- These provide ergonomic builder APIs
- They're stable and well-tested
- Complex logic (stdio vs http vs docker) benefits from manual implementation
- Users interact with these directly - need good API

---

## Timeline

Total: **3-4 hours**

- Step 1: Agent Schemas - 30 min
- Step 2: Skill Schemas - 15 min
- Step 3: Generate Agent Code - 45 min
- Step 4: Generate Skill Code - 30 min
- Step 5: Annotation Helpers - 30 min
- Step 6: Update Agent SDK - 45 min
- Step 7: Update Skill SDK - 30 min
- Step 8: Update Examples - 30 min
- Step 9: Run Tests - 15 min
- Step 10: Documentation - 30 min

**Buffer**: 30 min for unexpected issues

---

## Success Metrics

- ✅ Zero changes to user-facing Agent/Skill API
- ✅ All examples work without modification
- ✅ Generated code compiles successfully
- ✅ Tests pass
- ✅ Pattern proven across Workflow, Agent, and Skill

---

## Next After Option C

After completing Option C, we can:

1. **Option D**: Create comprehensive examples showing:
   - Agent/Workflow/Skill creation patterns
   - SDK annotation usage
   - Best practices and common patterns
   
2. **Production Release**: Ship the complete SDK with documentation

3. **Multi-Language SDKs**: Apply same schema to Python, TypeScript using Pulumi patterns

---

**Status**: Ready to implement! 🚀
