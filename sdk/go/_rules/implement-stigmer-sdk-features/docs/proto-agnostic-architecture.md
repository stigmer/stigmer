# Proto-Agnostic SDK Architecture

**Last Updated**: 2026-01-13

## Overview

The Stigmer Go SDK follows a **proto-agnostic architecture** where the SDK never knows about protobuf definitions. All proto conversion is handled by the CLI.

This document explains the architecture, benefits, and implementation patterns.

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│ User Repository (Pulumi-like)           │
│                                         │
│ - agent.go (uses SDK)                  │
│ - instructions/*.md                    │
│ - skills/*.md                          │
│ - .env.example                         │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│ SDK (Proto-Agnostic)                    │
│                                         │
│ - Pure Go library                      │
│ - No proto dependencies                │
│ - User-friendly structs                │
│ - Domain logic only                    │
└─────────────────────────────────────────┘
              ↓ reads
┌─────────────────────────────────────────┐
│ CLI (stigmer-cli)                       │
│                                         │
│ - Parses Go modules                    │
│ - Creates inline resources             │
│ - Converts to proto                    │
│ - Deploys to platform                  │
└─────────────────────────────────────────┘
              ↓ communicates via proto
┌─────────────────────────────────────────┐
│ Platform (Stigmer API)                  │
└─────────────────────────────────────────┘
```

---

## Key Principles

### 1. SDK is Proto-Ignorant

**What this means:**
- SDK packages never import proto stubs
- No `ToProto()` methods in SDK code
- No proto types in SDK public API
- SDK only defines Go structs and interfaces

**Example:**

```go
// sdk/go/agent/agent.go

package agent

import (
    "os"  // ✅ Standard library only
    "github.com/leftbin/stigmer-sdk/go/skill"  // ✅ Other SDK packages
)

// NO proto imports! ✅
// import agentv1 "github.com/leftbin/stigmer/apis/stubs/go/..."  ❌

type Agent struct {
    Name         string
    Instructions string
    Skills       []skill.Skill
    MCPServers   []mcpserver.MCPServer
}

// No ToProto() method! ✅
```

### 2. CLI Handles Proto Conversion

**What this means:**
- CLI imports proto stubs
- CLI reads SDK objects via Go's reflection or parsing
- CLI converts SDK objects to proto messages
- CLI communicates with platform

**Example (CLI pseudocode):**

```go
// cli/cmd/deploy.go

package cmd

import (
    agentv1 "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    sdkagent "github.com/leftbin/stigmer-sdk/go/agent"
)

func deployAgent(sdkAgent *sdkagent.Agent) error {
    // CLI converts SDK → Proto
    protoAgent := &agentv1.AgentSpec{
        Description:  sdkAgent.Description,
        Instructions: sdkAgent.Instructions,
        SkillRefs:    convertSkills(sdkAgent.Skills),  // CLI does conversion
    }
    
    // CLI deploys to platform
    return platformClient.CreateAgent(protoAgent)
}
```

### 3. Users Never See Proto

**What this means:**
- Users write pure Go code
- No proto complexity exposed
- CLI command is simple: `stigmer deploy agent.go`
- Proto is an implementation detail

**User Experience:**

```go
// users/my-agent-repo/agent.go

package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/skill"
)

func main() {
    // Pure Go - no proto!
    myAgent, _ := agent.New(
        agent.WithName("code-reviewer"),
        agent.WithInstructionsFromFile("instructions/reviewer.md"),
    )
    
    myAgent.AddSkill(skill.Platform("security-analysis"))
    
    // No proto conversion, no platform calls
    // Just define the agent
}
```

```bash
# Deploy (CLI handles everything)
$ stigmer deploy agent.go
Creating inline skills...
Converting to proto...
Deploying to platform...
✅ Agent deployed successfully!
```

---

## Benefits

### 1. Independent Evolution

**SDK can evolve without proto changes:**
- Add new SDK features without touching proto
- Change SDK API without breaking proto contract
- Proto changes don't force SDK changes

**Example:**
```go
// Add new SDK feature (no proto change needed)
func WithIconURLFromFile(path string) Option {
    // Load icon, encode as data URL, set icon_url
    // Proto still uses string icon_url field
}
```

### 2. Cleaner API Surface

**SDK has no proto clutter:**
- No proto types in public API
- No Get methods confusion
- No proto null handling
- Pure Go idioms

**Comparison:**

```go
// ❌ Proto-coupled SDK (confusing)
type Agent struct {
    proto *agentv1.AgentSpec  // Exposes proto
}

func (a *Agent) GetInstructions() string {
    return a.proto.GetInstructions()  // Proto getter
}

// ✅ Proto-agnostic SDK (clean)
type Agent struct {
    Instructions string  // Pure Go
}
```

### 3. Better Separation of Concerns

**Clear boundaries:**
- SDK = Domain logic (what agents are)
- CLI = Serialization logic (how to send to platform)
- Platform = Business logic (how to run agents)

**Testability:**
- SDK tests don't need proto
- CLI tests focus on conversion
- Platform tests use proto

### 4. Easier to Learn

**Users learn Go, not proto:**
- Standard Go patterns
- Familiar APIs
- No proto quirks
- Better IDE support

---

## Implementation Patterns

### Pattern 1: File-Based Content

**Problem**: Long text (instructions, skills) doesn't belong in code

**Solution**: Load from files

```go
// SDK provides file loaders
func WithInstructionsFromFile(path string) Option {
    return func(a *Agent) error {
        content, err := os.ReadFile(path)
        if err != nil {
            return fmt.Errorf("failed to read instructions: %w", err)
        }
        a.Instructions = string(content)
        return nil
    }
}

// Usage
agent.New(
    agent.WithName("reviewer"),
    agent.WithInstructionsFromFile("instructions/reviewer.md"),
)
```

**CLI Behavior**: Reads `agent.Instructions` field (already string from file)

### Pattern 2: Inline Resources

**Problem**: Users want to define resources (skills) in repository

**Solution**: Inline + referenced pattern

```go
// SDK supports both
type Skill struct {
    IsInline bool  // Discriminator
    
    // Inline fields
    Name            string
    MarkdownContent string
    
    // Reference fields
    Slug string
    Org  string
}

// Inline skill
skill, _ := skill.New(
    skill.WithName("my-skill"),
    skill.WithMarkdownFromFile("skills/my-skill.md"),
)

// Referenced skill
platformSkill := skill.Platform("existing-skill")
```

**CLI Behavior**:
1. Detect inline skills (`IsInline == true`)
2. Create them on platform → get reference
3. Convert all skills to `ApiResourceReference`
4. Use references in agent creation

### Pattern 3: Builder Methods

**Problem**: Constructor-only configuration is inflexible

**Solution**: Post-creation builder methods

```go
// SDK provides builder methods
func (a *Agent) AddSkill(s skill.Skill) *Agent {
    a.Skills = append(a.Skills, s)
    return a  // Enable chaining
}

// Usage
agent, _ := agent.New(agent.WithName("reviewer"))
agent.
    AddSkill(skill1).
    AddSkill(skill2).
    AddMCPServer(server)
```

**CLI Behavior**: Reads final state of `agent.Skills`, etc.

---

## CLI Implementation Guidance

### Step 1: Parse User Code

**Options:**
- Go's `go/parser` and `go/ast` packages
- Load as Go plugin
- Execute as subprocess
- Code generation

**Recommended**: Load as library and inspect structs

```go
// CLI can import user code
import usercode "github.com/user/my-agents"

func main() {
    // Get agent from user code
    agent := usercode.GetAgent()  // Returns sdk/go/agent.Agent
    
    // Convert to proto
    protoAgent := convertToProto(agent)
    
    // Deploy
    deployToAPI(protoAgent)
}
```

### Step 2: Convert to Proto

**Converter pattern:**

```go
func convertToProto(sdkAgent *sdkagent.Agent) *agentv1.AgentSpec {
    spec := &agentv1.AgentSpec{
        Description:  sdkAgent.Description,
        IconUrl:      sdkAgent.IconURL,
        Instructions: sdkAgent.Instructions,
    }
    
    // Convert nested objects
    for _, skill := range sdkAgent.Skills {
        if skill.IsInline {
            // Create skill on platform first
            ref := createSkillOnPlatform(skill)
            spec.SkillRefs = append(spec.SkillRefs, ref)
        } else {
            // Use existing reference
            spec.SkillRefs = append(spec.SkillRefs, skillToRef(skill))
        }
    }
    
    return spec
}
```

### Step 3: Handle Inline Resources

**Lifecycle management:**

```go
func deployAgent(sdkAgent *sdkagent.Agent) error {
    // 1. Create inline resources first
    inlineSkills := filterInlineSkills(sdkAgent.Skills)
    skillRefs := make([]*apiresource.ApiResourceReference, 0)
    
    for _, skill := range inlineSkills {
        // Create skill on platform
        skillProto := &skillv1.Skill{
            Metadata: &apiresource.ApiResourceMetadata{
                Name: skill.Name,
                Org:  sdkAgent.Org,
            },
            Spec: &skillv1.SkillSpec{
                MarkdownContent: skill.MarkdownContent,
            },
        }
        
        createdSkill, err := platformClient.CreateSkill(skillProto)
        if err != nil {
            return err
        }
        
        // Get reference
        skillRefs = append(skillRefs, &apiresource.ApiResourceReference{
            Scope: apiresource.ApiResourceOwnerScope_organization,
            Org:   sdkAgent.Org,
            Kind:  43,  // skill
            Slug:  skill.Name,
        })
    }
    
    // 2. Add referenced skills
    for _, skill := range filterReferencedSkills(sdkAgent.Skills) {
        skillRefs = append(skillRefs, skillToRef(skill))
    }
    
    // 3. Create agent with all skill references
    agentProto := convertToProto(sdkAgent)
    agentProto.SkillRefs = skillRefs
    
    return platformClient.CreateAgent(agentProto)
}
```

---

## Migration from Proto-Coupled SDK

If you have existing SDK code with `ToProto()` methods:

### Step 1: Identify Proto Dependencies

```bash
# Find proto imports
grep -r "apis/stubs/go" sdk/go/

# Find ToProto methods
grep -r "ToProto" sdk/go/
```

### Step 2: Remove Proto Imports

```go
// Remove these
import (
    agentv1 "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    apiresource "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// Keep these
import (
    "os"
    "fmt"
)
```

### Step 3: Remove ToProto() Methods

```go
// Remove entire methods
func (a *Agent) ToProto() *agentv1.AgentSpec { ... }
func (s Skill) ToProto() *apiresource.ApiResourceReference { ... }
```

### Step 4: Update Tests

```go
// Before
proto := agent.ToProto()
assert.Equal(t, "test", proto.GetDescription())

// After (test SDK objects directly)
assert.Equal(t, "test", agent.Description)

// Proto conversion tests move to CLI package
```

### Step 5: Create CLI Converter

```go
// cli/internal/converter/agent.go
package converter

import (
    agentv1 "github.com/leftbin/stigmer/apis/stubs/go/..."
    sdkagent "github.com/leftbin/stigmer-sdk/go/agent"
)

func AgentToProto(sdk *sdkagent.Agent) *agentv1.AgentSpec {
    // All proto conversion logic here
}
```

---

## Testing Strategy

### SDK Tests (No Proto)

```go
// sdk/go/agent/agent_test.go

func TestAgent_AddSkill(t *testing.T) {
    agent, _ := agent.New(agent.WithName("test"))
    skill := skill.Platform("test-skill")
    
    agent.AddSkill(skill)
    
    assert.Equal(t, 1, len(agent.Skills))
    assert.Equal(t, "test-skill", agent.Skills[0].Slug)
}

// No proto, no conversion, just domain logic
```

### CLI Converter Tests (With Proto)

```go
// cli/internal/converter/agent_test.go

func TestAgentToProto(t *testing.T) {
    sdkAgent, _ := agent.New(agent.WithName("test"))
    sdkAgent.AddSkill(skill.Platform("test-skill"))
    
    proto := AgentToProto(sdkAgent)
    
    assert.Equal(t, "test", proto.GetDescription())
    assert.Equal(t, 1, len(proto.SkillRefs))
}

// Test conversion logic in CLI
```

---

## Troubleshooting

### Problem: "Cannot find ToProto() method"

**Cause**: Code expects proto-coupled SDK

**Solution**: Move proto conversion to CLI

```go
// ❌ Old code
proto := agent.ToProto()

// ✅ New code (in CLI)
proto := converter.AgentToProto(agent)
```

### Problem: "How does CLI know about SDK objects?"

**Solution**: CLI imports SDK as library

```go
// cli/go.mod
require github.com/leftbin/stigmer-sdk/go v0.1.0

// cli/cmd/deploy.go
import sdkagent "github.com/leftbin/stigmer-sdk/go/agent"

func deploy(agentPath string) error {
    // Load user's agent code
    agent := loadAgent(agentPath)  // Returns *sdkagent.Agent
    
    // Convert and deploy
    proto := converter.AgentToProto(agent)
    return api.CreateAgent(proto)
}
```

### Problem: "How to handle inline resources?"

**Solution**: CLI detects and creates them first

```go
func deployAgent(agent *sdkagent.Agent) error {
    // Detect inline skills
    for _, skill := range agent.Skills {
        if skill.IsInline {
            // Create on platform
            ref := createSkill(skill)
            // Store reference for agent creation
        }
    }
    
    // Create agent with references
    createAgent(agent)
}
```

---

## Summary

**Proto-Agnostic Architecture Benefits:**
- ✅ SDK evolves independently
- ✅ Cleaner API surface
- ✅ Better separation of concerns
- ✅ Easier to learn and use
- ✅ Better testability

**Key Principle**: SDK defines intent, CLI handles execution

**Remember**: If you're tempted to add proto imports to SDK, stop and move that logic to CLI instead!

---

## References

- **Learning Log**: `docs/learning-log.md` - Real-world learnings from implementation
- **Main Rule**: `implement-go-sdk-features.mdc` - SDK implementation patterns
- **Python SDK**: Similar architecture in `sdk/python/`

---

**Last Updated**: 2026-01-13 (after proto-agnostic redesign)
