# Migration Guide

This guide helps you migrate from the proto-coupled SDK design to the new proto-agnostic architecture.

---

## What Changed?

### Proto-Agnostic Architecture

**Before (Proto-Coupled):**
```
SDK exports ToProto() methods → User calls ToProto() → Platform
```

**After (Proto-Agnostic):**
```
SDK provides pure Go API → CLI converts to proto → Platform
```

**Key Changes:**
- ✅ SDK has no proto dependencies
- ✅ No `ToProto()` methods in SDK
- ✅ CLI handles all proto conversion
- ✅ Users write pure Go code

### New Features

1. **File-Based Content** - Load instructions and skills from files
2. **Inline Skills** - Define skills directly in your repository
3. **Builder Methods** - Add components after agent creation
4. **Proto-Agnostic** - No proto types in user code

---

## Migration Steps

### Step 1: Remove ToProto() Calls

**Before:**
```go
agent, _ := agent.New(
    agent.WithName("my-agent"),
    agent.WithInstructions("Do something"),
)

// ❌ No longer available
proto := agent.ToProto()
client.CreateAgent(proto)
```

**After:**
```go
agent, _ := agent.New(
    agent.WithName("my-agent"),
    agent.WithInstructions("Do something"),
)

// ✅ No proto conversion needed
// Just define the agent - CLI handles deployment
```

**Deploy with CLI:**
```bash
# CLI converts to proto and deploys
stigmer deploy agent.go
```

### Step 2: Move Instructions to Files

**Before:**
```go
agent.New(
    agent.WithName("code-reviewer"),
    agent.WithInstructions(`
You are a code reviewer.

Please review code for:
1. Code quality
2. Security issues
3. Best practices
... 50 more lines ...
    `),
)
```

**After:**
```go
// instructions/code-reviewer.md contains the instructions
agent.New(
    agent.WithName("code-reviewer"),
    agent.WithInstructionsFromFile("instructions/code-reviewer.md"),
)
```

**Benefits:**
- ✅ Cleaner code
- ✅ Easier to edit (use markdown editor)
- ✅ Version controlled separately
- ✅ Reusable across agents

### Step 3: Use Inline Skills

**Before:**
```go
// Can only reference platform skills
agent.New(
    agent.WithName("reviewer"),
    agent.WithSkill(skill.Platform("coding-standards")),
)
```

**After:**
```go
// Option 1: Reference platform skills (same as before)
agent.New(
    agent.WithName("reviewer"),
    agent.WithSkill(skill.Platform("coding-standards")),
)

// Option 2: Create inline skills in repository
securitySkill, _ := skill.New(
    skill.WithName("security-guidelines"),
    skill.WithDescription("Security review guidelines"),
    skill.WithMarkdownFromFile("skills/security.md"),
)

agent.New(
    agent.WithName("reviewer"),
    agent.WithSkill(*securitySkill), // Inline skill
    agent.WithSkill(skill.Platform("coding-standards")), // Platform skill
)
```

**Benefits:**
- ✅ Define skills in your repository
- ✅ Version controlled with agent code
- ✅ Easy to share across agents
- ✅ No need to pre-create on platform

### Step 4: Use Builder Methods

**Before:**
```go
// Must configure everything at creation
skill1 := skill.Platform("skill-1")
skill2 := skill.Platform("skill-2")
server1, _ := mcpserver.Stdio(...)
server2, _ := mcpserver.Stdio(...)

agent, _ := agent.New(
    agent.WithName("my-agent"),
    agent.WithInstructions("..."),
    agent.WithSkill(skill1),
    agent.WithSkill(skill2),
    agent.WithMCPServer(server1),
    agent.WithMCPServer(server2),
)
```

**After:**
```go
// Create agent first
agent, _ := agent.New(
    agent.WithName("my-agent"),
    agent.WithInstructionsFromFile("instructions/agent.md"),
)

// Add components incrementally
agent.
    AddSkill(skill.Platform("skill-1")).
    AddSkill(skill.Platform("skill-2"))

server1, _ := mcpserver.Stdio(...)
agent.AddMCPServer(server1)

server2, _ := mcpserver.Stdio(...)
agent.AddMCPServer(server2)
```

**Benefits:**
- ✅ More flexible configuration
- ✅ Easier to build agents conditionally
- ✅ Cleaner code organization
- ✅ Method chaining support

### Step 5: Update Tests

**Before:**
```go
func TestAgent_ToProto(t *testing.T) {
    agent, _ := agent.New(
        agent.WithName("test"),
        agent.WithInstructions("Test instructions"),
    )
    
    // ❌ ToProto() no longer exists
    proto := agent.ToProto()
    assert.Equal(t, "Test instructions", proto.GetInstructions())
}
```

**After:**
```go
func TestAgent_Construction(t *testing.T) {
    agent, _ := agent.New(
        agent.WithName("test"),
        agent.WithInstructions("Test instructions"),
    )
    
    // ✅ Test SDK objects directly
    assert.Equal(t, "test", agent.Name)
    assert.Equal(t, "Test instructions", agent.Instructions)
}
```

**Proto conversion tests move to CLI:**
```go
// cli/internal/converter/agent_test.go

func TestAgentToProto(t *testing.T) {
    sdkAgent, _ := agent.New(
        agent.WithName("test"),
        agent.WithInstructions("Test instructions"),
    )
    
    // CLI converter handles proto conversion
    proto := converter.AgentToProto(sdkAgent)
    assert.Equal(t, "Test instructions", proto.GetInstructions())
}
```

---

## Feature Comparison

### Agent Creation

| Feature | Before | After |
|---------|--------|-------|
| **Basic Agent** | `agent.New(...)` | ✅ Same |
| **Instructions** | Inline string | ✅ File-based with `WithInstructionsFromFile()` |
| **Proto Conversion** | `agent.ToProto()` | ❌ Removed (CLI handles it) |
| **Builder Methods** | ❌ Not available | ✅ `AddSkill()`, `AddMCPServer()`, etc. |

### Skills

| Feature | Before | After |
|---------|--------|-------|
| **Platform Skills** | `skill.Platform(slug)` | ✅ Same |
| **Org Skills** | `skill.Organization(org, slug)` | ✅ Same |
| **Inline Skills** | ❌ Not available | ✅ `skill.New()` with file content |
| **Proto Conversion** | `skill.ToProto()` | ❌ Removed (CLI handles it) |

### MCP Servers

| Feature | Before | After |
|---------|--------|-------|
| **Stdio Servers** | `mcpserver.Stdio(...)` | ✅ Same |
| **HTTP Servers** | `mcpserver.HTTP(...)` | ✅ Same |
| **Docker Servers** | `mcpserver.Docker(...)` | ✅ Same |
| **Proto Conversion** | `server.ToProto()` | ❌ Removed (CLI handles it) |

### Sub-Agents

| Feature | Before | After |
|---------|--------|-------|
| **Inline Sub-Agents** | `subagent.Inline(...)` | ✅ Same |
| **Referenced Sub-Agents** | `subagent.Reference(id)` | ✅ Same |
| **Instructions from File** | ❌ Not available | ✅ `subagent.WithInstructionsFromFile()` |
| **Proto Conversion** | `subagent.ToProto()` | ❌ Removed (CLI handles it) |

### Environment Variables

| Feature | Before | After |
|---------|--------|-------|
| **Basic Variables** | `environment.New(...)` | ✅ Same |
| **Secrets** | `environment.WithSecret(true)` | ✅ Same |
| **Defaults** | `environment.WithDefaultValue(...)` | ✅ Same |
| **Proto Conversion** | `env.ToProto()` | ❌ Removed (CLI handles it) |

---

## Common Migration Patterns

### Pattern 1: Simple Agent

**Before:**
```go
package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/skill"
)

func main() {
    myAgent, _ := agent.New(
        agent.WithName("code-reviewer"),
        agent.WithInstructions("Review code for quality and best practices"),
        agent.WithSkill(skill.Platform("coding-standards")),
    )
    
    proto := myAgent.ToProto()
    // Deploy proto to platform...
}
```

**After:**
```go
package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/skill"
)

func main() {
    myAgent, _ := agent.New(
        agent.WithName("code-reviewer"),
        agent.WithInstructionsFromFile("instructions/reviewer.md"),
    )
    
    myAgent.AddSkill(skill.Platform("coding-standards"))
    
    // No proto conversion needed
    // Deploy with: stigmer deploy agent.go
}
```

### Pattern 2: Agent with Inline Skills

**Before:**
```go
// Not possible - could only reference platform skills
```

**After:**
```go
package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/skill"
)

func main() {
    // Create inline skill
    securitySkill, _ := skill.New(
        skill.WithName("security-guidelines"),
        skill.WithDescription("Custom security guidelines"),
        skill.WithMarkdownFromFile("skills/security.md"),
    )
    
    // Create agent
    myAgent, _ := agent.New(
        agent.WithName("security-reviewer"),
        agent.WithInstructionsFromFile("instructions/reviewer.md"),
    )
    
    // Add inline and platform skills
    myAgent.
        AddSkill(*securitySkill).
        AddSkill(skill.Platform("coding-standards"))
    
    // Deploy with: stigmer deploy agent.go
}
```

### Pattern 3: Complex Agent with Everything

**Before:**
```go
package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/skill"
    "github.com/leftbin/stigmer-sdk/go/mcpserver"
    "github.com/leftbin/stigmer-sdk/go/environment"
    "github.com/leftbin/stigmer-sdk/go/subagent"
)

func main() {
    skill1 := skill.Platform("skill-1")
    server1, _ := mcpserver.Stdio(...)
    env1, _ := environment.New(...)
    sub1, _ := subagent.Inline(...)
    
    myAgent, _ := agent.New(
        agent.WithName("complex-agent"),
        agent.WithInstructions("...very long instructions..."),
        agent.WithSkill(skill1),
        agent.WithMCPServer(server1),
        agent.WithEnvironmentVariable(env1),
        agent.WithSubAgent(sub1),
    )
    
    proto := myAgent.ToProto()
    // Deploy...
}
```

**After:**
```go
package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/skill"
    "github.com/leftbin/stigmer-sdk/go/mcpserver"
    "github.com/leftbin/stigmer-sdk/go/environment"
    "github.com/leftbin/stigmer-sdk/go/subagent"
)

func main() {
    // Create inline skill
    customSkill, _ := skill.New(
        skill.WithName("custom-skill"),
        skill.WithDescription("Custom knowledge"),
        skill.WithMarkdownFromFile("skills/custom.md"),
    )
    
    // Create MCP server
    server, _ := mcpserver.Stdio(
        mcpserver.WithName("github"),
        mcpserver.WithCommand("npx"),
        mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
        mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
    )
    
    // Create environment variable
    token, _ := environment.New(
        environment.WithName("GITHUB_TOKEN"),
        environment.WithSecret(true),
        environment.WithDescription("GitHub API token"),
    )
    
    // Create sub-agent with instructions from file
    specialist, _ := subagent.Inline(
        subagent.WithName("security-specialist"),
        subagent.WithInstructionsFromFile("instructions/security-specialist.md"),
    )
    
    // Create main agent
    myAgent, _ := agent.New(
        agent.WithName("complex-agent"),
        agent.WithInstructionsFromFile("instructions/complex-agent.md"),
        agent.WithDescription("Complex agent with all features"),
    )
    
    // Build agent incrementally
    myAgent.
        AddSkill(*customSkill).
        AddSkill(skill.Platform("coding-standards")).
        AddMCPServer(server).
        AddEnvironmentVariable(token).
        AddSubAgent(specialist)
    
    // No proto conversion needed
    // Deploy with: stigmer deploy agent.go
}
```

---

## Repository Structure

### Recommended Structure

```
my-agent-repo/
├── agent.go                  # Main agent definition
├── instructions/             # Agent instructions
│   ├── main-agent.md
│   ├── security-specialist.md
│   └── testing-specialist.md
├── skills/                   # Inline skills
│   ├── security-guidelines.md
│   ├── testing-standards.md
│   └── code-review-checklist.md
├── .env.example              # Environment variable template
├── go.mod
└── README.md
```

### File Organization

**instructions/**
- Agent instructions (what the agent should do)
- Sub-agent instructions
- Behavior definitions

**skills/**
- Knowledge base content
- Guidelines and standards
- Reference documentation

**Benefits:**
- ✅ Clear separation of concerns
- ✅ Easy to navigate and maintain
- ✅ Reusable content across agents
- ✅ Version controlled

---

## CLI Usage

### Deploying Agents

**Before:**
```go
// In user code
proto := agent.ToProto()
client.CreateAgent(proto)
```

**After:**
```bash
# CLI handles everything
stigmer deploy agent.go
```

**CLI Behavior:**
1. Loads your Go code
2. Detects inline resources (skills, sub-agents)
3. Creates inline resources on platform
4. Converts SDK objects to proto
5. Deploys agent to platform

### CLI Commands (Planned)

```bash
# Deploy agent
stigmer deploy agent.go

# Validate agent (check for errors)
stigmer validate agent.go

# Preview proto conversion
stigmer preview agent.go

# List deployed agents
stigmer list agents

# Delete agent
stigmer delete agent my-agent
```

---

## Breaking Changes

### Removed APIs

| API | Replacement |
|-----|-------------|
| `agent.ToProto()` | CLI handles proto conversion |
| `skill.ToProto()` | CLI handles proto conversion |
| `mcpserver.ToProto()` | CLI handles proto conversion |
| `subagent.ToProto()` | CLI handles proto conversion |
| `environment.ToProto()` | CLI handles proto conversion |

### Changed Patterns

| Old Pattern | New Pattern |
|-------------|-------------|
| Inline instructions | File-based with `WithInstructionsFromFile()` |
| Platform skills only | Inline skills with `skill.New()` |
| Constructor-only config | Builder methods after creation |
| Proto-coupled testing | Pure Go testing |

---

## Benefits of New Architecture

### 1. Cleaner Code

**Before:**
```go
agent, _ := agent.New(
    agent.WithName("reviewer"),
    agent.WithInstructions(`
Very long instructions that clutter the code...
... many lines ...
... hard to maintain ...
    `),
)
proto := agent.ToProto() // Proto coupling
```

**After:**
```go
agent, _ := agent.New(
    agent.WithName("reviewer"),
    agent.WithInstructionsFromFile("instructions/reviewer.md"),
)
// No proto coupling - pure Go!
```

### 2. Better Organization

**Before:**
- Instructions mixed with code
- Skills must be pre-created on platform
- Hard to version control instructions

**After:**
- Instructions in markdown files
- Skills defined in repository
- Everything version controlled

### 3. Independent Evolution

**Before:**
- SDK changes require proto changes
- Proto changes break SDK
- Tight coupling

**After:**
- SDK evolves independently
- Proto changes don't affect SDK
- Loose coupling via CLI

### 4. Easier Testing

**Before:**
```go
// Test proto conversion
proto := agent.ToProto()
assert.Equal(t, "value", proto.GetField())
```

**After:**
```go
// Test SDK objects directly
assert.Equal(t, "value", agent.Field)
```

---

## Troubleshooting

### Error: "ToProto() method not found"

**Cause:** Code expects old proto-coupled SDK

**Solution:** Remove `ToProto()` calls and use CLI for deployment

```go
// ❌ Old code
proto := agent.ToProto()

// ✅ New code
// Just define agent, CLI handles proto conversion
```

### Error: "Cannot import proto packages"

**Cause:** User code trying to import proto stubs

**Solution:** Remove proto imports, use pure SDK types

```go
// ❌ Old imports
import agentv1 "github.com/leftbin/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"

// ✅ New imports
import "github.com/leftbin/stigmer-sdk/go/agent"
```

### Error: "Instructions file not found"

**Cause:** File path incorrect or file doesn't exist

**Solution:** Check file path and ensure file exists

```bash
# Verify file exists
ls instructions/agent.md

# Check path in code
agent.WithInstructionsFromFile("instructions/agent.md")
```

### Question: "How do I deploy agents now?"

**Answer:** Use the Stigmer CLI

```bash
# CLI handles all proto conversion and deployment
stigmer deploy agent.go
```

---

## Timeline for Migration

### Immediate (Now)

- ✅ SDK is proto-agnostic
- ✅ File-based content loading available
- ✅ Inline skills available
- ✅ Builder methods available

### Short-Term (CLI Development)

- ⏳ CLI proto conversion implementation
- ⏳ CLI deployment commands
- ⏳ CLI validation and preview

### Long-Term

- 📋 Enhanced CLI features
- 📋 Local testing support
- 📋 Advanced deployment options

---

## FAQ

### Q: Do I need to migrate immediately?

**A:** If you're starting new agents, use the new patterns. Existing agents can migrate gradually.

### Q: Can I still use inline instructions?

**A:** Yes! `WithInstructions()` still works. But `WithInstructionsFromFile()` is recommended for maintainability.

### Q: What about proto conversion?

**A:** The CLI handles all proto conversion. You don't need to think about proto anymore.

### Q: How do inline skills work?

**A:** Define skills in your repository with `skill.New()`. The CLI creates them on the platform when you deploy.

### Q: Can I mix inline and platform skills?

**A:** Yes! Use both in the same agent:
```go
myAgent.
    AddSkill(*inlineSkill).           // Inline
    AddSkill(skill.Platform("slug"))  // Platform
```

### Q: What if I need proto for testing?

**A:** Test SDK objects directly in SDK tests. Proto conversion tests belong in CLI tests.

### Q: How do I preview proto conversion?

**A:** Use `stigmer preview agent.go` (planned CLI feature) to see the proto output.

---

## Getting Help

### Resources

- **Documentation**: [docs.stigmer.ai](https://docs.stigmer.ai)
- **Examples**: `sdk/go/examples/`
- **Architecture**: `sdk/go/_rules/implement-stigmer-sdk-features/docs/proto-agnostic-architecture.md`

### GitHub Issues

Report migration issues at: [github.com/leftbin/stigmer/issues](https://github.com/leftbin/stigmer/issues)

---

## Summary

**Key Takeaways:**

1. ✅ SDK is now proto-agnostic (no proto dependencies)
2. ✅ Load instructions and skills from files
3. ✅ Create inline skills in your repository
4. ✅ Use builder methods for flexible configuration
5. ✅ CLI handles all proto conversion and deployment
6. ✅ Tests are simpler (test Go objects, not proto)

**Next Steps:**

1. Review [Example 06](examples/06_agent_with_instructions_from_files.go) for recommended patterns
2. Move long instructions to markdown files
3. Define skills in your repository
4. Remove any `ToProto()` calls
5. Deploy with `stigmer deploy agent.go`

**Remember:** The SDK is now a pure Go library. Think Pulumi-like infrastructure-as-code, not proto messages!

---

*Last Updated: 2026-01-13 (Proto-Agnostic Redesign)*
