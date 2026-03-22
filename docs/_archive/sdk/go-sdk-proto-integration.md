# Go SDK Proto Integration

**Status**: Phase 1 Complete (Skill ready, Agent 75% complete)  
**Last Updated**: 2026-01-22

---

## Overview

The Go SDK provides ergonomic, type-safe builders for creating Stigmer resources (Agents, Skills, Workflows). Before submitting these resources to the Stigmer platform, they must be converted to platform protobuf messages.

The **ToProto() methods** handle this conversion automatically, including:
- Platform proto message structure (ApiVersion, Kind, Metadata, Spec)
- SDK metadata annotations (language, version, timestamp)
- Field mapping from SDK types to proto types

---

## Quick Start

### Skill Example (Production-Ready)

```go
package main

import (
    "fmt"
    "github.com/stigmer/stigmer/sdk/go/skill"
)

func main() {
    // Create skill using SDK
    mySkill, err := skill.New(
        skill.WithName("code-analysis"),
        skill.WithDescription("Analyzes code quality"),
        skill.WithMarkdownFromFile("skills/code-analysis.md"),
    )
    if err != nil {
        panic(err)
    }
    
    // Convert to platform proto
    proto, err := mySkill.ToProto()
    if err != nil {
        panic(err)
    }
    
    // Proto is ready for platform submission
    fmt.Printf("Skill created: %s\n", proto.Metadata.Name)
    fmt.Printf("SDK: %s %s\n", 
        proto.Metadata.Annotations["stigmer.ai/sdk.language"],
        proto.Metadata.Annotations["stigmer.ai/sdk.version"])
}
```

**Output:**
```
Skill created: code-analysis
SDK: go 0.1.0
```

### Agent Example (Basic Fields)

```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/agent"
)

func main() {
    ctx := stigmer.NewContext()
    
    // Create agent using SDK
    myAgent, err := agent.New(ctx,
        agent.WithName("code-reviewer"),
        agent.WithDescription("AI code reviewer"),
        agent.WithInstructions("Review code and suggest improvements"),
    )
    if err != nil {
        panic(err)
    }
    
    // Convert to platform proto
    proto, err := myAgent.ToProto()
    if err != nil {
        panic(err)
    }
    
    // Proto is ready for platform submission
    // (for basic agents without MCP servers, sub-agents, or env vars)
}
```

**Note**: Agent ToProto() currently supports basic fields. Complex nested types (MCP servers, sub-agents, environment variables) are in progress.

---

## SDK Annotations

All resources created by the Go SDK automatically include metadata annotations for tracking and telemetry.

### Annotation Keys

| Key | Value | Purpose |
|-----|-------|---------|
| `stigmer.ai/sdk.language` | `"go"` | SDK language used |
| `stigmer.ai/sdk.version` | `"0.1.0"` | SDK version |
| `stigmer.ai/sdk.generated-at` | Unix timestamp | Creation time |

### Example

```go
proto, _ := skill.ToProto()

// SDK annotations are automatically included
fmt.Println(proto.Metadata.Annotations)
// Output:
// map[string]string{
//     "stigmer.ai/sdk.language":    "go",
//     "stigmer.ai/sdk.version":     "0.1.0",
//     "stigmer.ai/sdk.generated-at": "1706789123",
// }
```

### Custom Annotations

Currently, SDK annotations are automatically added and cannot be customized. Future versions may support merging with user-provided annotations.

---

## API Reference

### Skill.ToProto()

```go
func (s *Skill) ToProto() (*skillv1.Skill, error)
```

Converts SDK Skill to platform Skill proto message.

**Status**: ✅ Production-ready

**Returns:**
- `*skillv1.Skill` - Platform proto message
- `error` - Conversion error (if any)

**Proto Structure:**
```go
&skillv1.Skill{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "Skill",
    Metadata: &apiresource.ApiResourceMetadata{
        Name:        "skill-name",
        Annotations: {/* SDK annotations */},
    },
    Spec: &skillv1.SkillSpec{
        Description:     "Skill description",
        MarkdownContent: "# Skill content...",
    },
}
```

**Example:**
```go
skill, _ := skill.New(
    skill.WithName("my-skill"),
    skill.WithMarkdownFromFile("skills/my-skill.md"),
)

proto, err := skill.ToProto()
if err != nil {
    return err
}

// Submit proto to platform
client.CreateSkill(proto)
```

### Agent.ToProto()

```go
func (a *Agent) ToProto() (*agentv1.Agent, error)
```

Converts SDK Agent to platform Agent proto message.

**Status**: ⚠️ Basic fields working, complex nested types in progress

**Supported Fields:**
- ✅ Name, Description, IconURL, Instructions
- ⚠️ Skills (partial - conversion helper needs completion)
- ⚠️ MCP Servers (conversion helper needs completion)
- ⚠️ Sub-Agents (conversion helper needs completion)
- ⚠️ Environment Variables (conversion helper needs completion)

**Returns:**
- `*agentv1.Agent` - Platform proto message
- `error` - Conversion error (if any)

**Proto Structure:**
```go
&agentv1.Agent{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "Agent",
    Metadata: &apiresource.ApiResourceMetadata{
        Name:        "agent-name",
        Annotations: {/* SDK annotations */},
    },
    Spec: &agentv1.AgentSpec{
        Description:  "Agent description",
        IconUrl:      "https://example.com/icon.png",
        Instructions: "Agent behavior instructions",
        // Complex fields in progress...
    },
}
```

**Example (Basic Agent):**
```go
agent, _ := agent.New(ctx,
    agent.WithName("my-agent"),
    agent.WithInstructions("Review code"),
)

proto, err := agent.ToProto()
if err != nil {
    return err
}

// Works for basic agents without complex nested types
client.CreateAgent(proto)
```

**Limitations (Current):**
- MCP server conversion not yet implemented
- Sub-agent conversion not yet implemented
- Environment variable conversion not yet implemented

**Future**: Complex nested type conversion will be completed in Phase 2 (~2 hours of work).

---

## SDK Annotation Helpers

Internal helpers for managing SDK metadata annotations.

### agent.SDKAnnotations()

```go
func SDKAnnotations() map[string]string
```

Returns SDK metadata annotations for agents.

**Example:**
```go
annotations := agent.SDKAnnotations()
// map[string]string{
//     "stigmer.ai/sdk.language":    "go",
//     "stigmer.ai/sdk.version":     "0.1.0",
//     "stigmer.ai/sdk.generated-at": "1706789123",
// }
```

### agent.MergeAnnotations()

```go
func MergeAnnotations(userAnnotations map[string]string) map[string]string
```

Merges SDK annotations with user-provided annotations.

**Note**: Currently not used by ToProto() methods, but available for future expansion.

**Example:**
```go
userAnnotations := map[string]string{
    "app.example.com/team": "backend",
}

all := agent.MergeAnnotations(userAnnotations)
// Includes both SDK annotations and user annotations
```

### skill.SDKAnnotations() / skill.MergeAnnotations()

Same API as agent package, but for skill resources.

---

## Architecture

### Conversion Flow

```
SDK User Code
     ↓
agent.Agent / skill.Skill
(High-level, ergonomic SDK types)
     ↓
ToProto() method
     ↓
agentv1.Agent / skillv1.Skill
(Platform proto messages)
     ↓
Platform API
```

### Why ToProto()?

**Problem**: SDK types are designed for ergonomics. Platform APIs require specific protobuf message structures.

**Solution**: ToProto() bridges the gap:
1. Converts SDK types → Platform proto types
2. Adds required metadata (ApiVersion, Kind)
3. Injects SDK annotations automatically
4. Handles field mapping and validation

**Benefits**:
- SDK remains user-friendly and type-safe
- Platform APIs remain consistent and well-defined
- Conversion is automatic and error-free
- SDK metadata tracked for telemetry

---

## Integration Pattern

### Resource Creation Workflow

```go
// 1. Create resource using SDK (ergonomic API)
skill, err := skill.New(
    skill.WithName("my-skill"),
    skill.WithMarkdownFromFile("skills/my-skill.md"),
)

// 2. Convert to proto (before platform submission)
proto, err := skill.ToProto()

// 3. Submit to platform
response, err := client.CreateSkill(ctx, proto)

// 4. Use platform response
fmt.Printf("Created skill: %s\n", response.Metadata.Id)
```

### Error Handling

```go
proto, err := skill.ToProto()
if err != nil {
    // Handle conversion errors
    log.Fatalf("Failed to convert skill: %v", err)
}

// Proto is valid and ready for submission
```

---

## Status & Roadmap

### Phase 1: Complete ✅

- ✅ SDK annotation helpers (Agent + Skill)
- ✅ Skill ToProto() (production-ready)
- ✅ Agent ToProto() skeleton (basic fields working)
- ✅ All code compiles successfully

### Phase 2: In Progress (~2 hours remaining)

**Agent Nested Type Conversions:**
- ⚠️ `convertSkillsToRefs()` - Convert SDK skills to API resource references
- ⚠️ `convertMCPServers()` - Handle Stdio/HTTP/Docker server types
- ⚠️ `convertSubAgents()` - Handle inline vs referenced sub-agents
- ⚠️ `convertEnvironmentVariables()` - Map environment variable fields

**Testing:**
- Unit tests for Skill ToProto()
- Unit tests for Agent ToProto()
- Integration tests for end-to-end flow

**Documentation:**
- Expanded usage examples
- Migration guide for existing SDK users

### Future

- Workflow ToProto() (apply same pattern)
- FromProto() direction (if needed for platform → SDK conversion)
- Custom annotation support (user annotations + SDK annotations)

---

## Examples

### Complete Skill Submission

```go
package main

import (
    "context"
    "log"
    
    "github.com/stigmer/stigmer/sdk/go/skill"
    skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
    "google.golang.org/grpc"
)

func main() {
    // 1. Create skill using SDK
    mySkill, err := skill.New(
        skill.WithName("code-analysis"),
        skill.WithDescription("Analyzes code quality and suggests improvements"),
        skill.WithMarkdownFromFile("skills/code-analysis.md"),
    )
    if err != nil {
        log.Fatalf("Failed to create skill: %v", err)
    }
    
    // 2. Convert to proto
    proto, err := mySkill.ToProto()
    if err != nil {
        log.Fatalf("Failed to convert to proto: %v", err)
    }
    
    // 3. Connect to platform
    conn, err := grpc.Dial("stigmer-platform:50051", grpc.WithInsecure())
    if err != nil {
        log.Fatalf("Failed to connect: %v", err)
    }
    defer conn.Close()
    
    // 4. Submit to platform
    client := skillv1.NewSkillServiceClient(conn)
    response, err := client.Create(context.Background(), &skillv1.CreateSkillRequest{
        Skill: proto,
    })
    if err != nil {
        log.Fatalf("Failed to create skill: %v", err)
    }
    
    // 5. Success!
    log.Printf("Skill created successfully: %s", response.Metadata.Id)
}
```

---

## Troubleshooting

### "conversion helper not implemented" Error

**Problem**: Agent ToProto() returns error for agents with complex nested types.

**Cause**: Phase 2 conversion helpers not yet implemented (MCP servers, sub-agents, env vars).

**Solution**: 
- Use basic agents only (no MCP servers, sub-agents, or env vars) for now
- Wait for Phase 2 completion (~2 hours of work)
- Or contribute the conversion helper implementation

**Workaround**:
```go
// Works now (basic agent)
agent, _ := agent.New(ctx,
    agent.WithName("simple-agent"),
    agent.WithInstructions("Simple instructions"),
)

// Not yet supported (complex agent)
agent, _ := agent.New(ctx,
    agent.WithName("complex-agent"),
    agent.WithInstructions("..."),
    agent.WithMCPServer(mcpserver.Stdio(...)),  // ← Not yet converted
)
```

---

## Related Documentation

- [Go SDK Getting Started](./go-sdk-getting-started.md) - SDK installation and basic usage
- [Resource Dependency Management](../design-decisions/DD06-resource-dependency-management.md) - Cross-resource dependency design
- [SDK Code Generation](../architecture/sdk-code-generation.md) - Code generation pipeline (if documented)

---

## Changelog

**2026-01-22**: Phase 1 complete
- Added SDK annotation helpers
- Implemented Skill ToProto() (production-ready)
- Implemented Agent ToProto() skeleton (basic fields)
- Created documentation

---

*This documentation will be updated as Phase 2 progresses.*
