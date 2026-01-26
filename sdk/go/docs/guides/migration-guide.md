# Migration Guide - Struct Args API

This guide helps you migrate from the old functional options pattern to the new struct-args API (Pulumi-aligned pattern).

---

## What Changed?

### Struct-Args Pattern (Pulumi-Aligned)

**Before (Functional Options):**
```go
// Old pattern - functional options
agent, err := agent.New(ctx,
    agent.WithName("my-agent"),
    agent.WithInstructions("..."),
)
mcpServer, err := mcpserver.Stdio(
    mcpserver.WithName("github"),
    mcpserver.WithCommand("npx"),
)
```

**After (Struct Args):**
```go
// New pattern - struct-based args
agent, err := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
})
mcpServer, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
    Command: "npx",
})
```

**Key Changes:**
- ✅ Struct-based args instead of functional options
- ✅ Name is a positional parameter, not an option
- ✅ Context (ctx) is always first parameter
- ✅ Better IDE autocomplete and type safety
- ✅ Consistent with Pulumi, Terraform, AWS SDK patterns

### Skill References (Not Inline Creation)

**Before:**
```go
// Old - create skills inline
skill, err := skill.New("my-skill", &skill.SkillArgs{
    MarkdownContent: "...",
})
agent.AddSkill(skill)
```

**After:**
```go
// New - reference existing skills
import "github.com/stigmer/stigmer/sdk/go/skillref"

agent.AddSkillRef(skillref.Platform("my-skill"))
```

**Key Changes:**
- ✅ Skills are managed separately (via CLI or UI)
- ✅ SDK references skills, doesn't create them
- ✅ New `skillref` package for references
- ✅ Methods renamed: `AddSkill()` → `AddSkillRef()`

---

## Migration Steps

### Step 1: Update Agent Creation

**Before:**
```go
agent, err := agent.New(ctx,
    agent.WithName("my-agent"),
    agent.WithInstructions("Do something important"),
    agent.WithDescription("My agent"),
)
```

**After:**
```go
agent, err := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "Do something important",
    Description:  "My agent",
})
```

**Changes:**
- ✅ Name is now a positional parameter (second, after ctx)
- ✅ Instructions, Description, IconUrl are fields in AgentArgs struct
- ✅ No more `With*()` functions for these fields

### Step 2: Update MCP Server Creation

**Before:**
```go
server, err := mcpserver.Stdio(
    mcpserver.WithName("github"),
    mcpserver.WithCommand("npx"),
    mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
    mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
)
```

**After:**
```go
server, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
    Command: "npx",
    Args:    []string{"-y", "@modelcontextprotocol/server-github"},
    EnvPlaceholders: map[string]string{
        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
    },
})
```

**Changes:**
- ✅ Add ctx as first parameter
- ✅ Name is now a positional parameter (second, after ctx)
- ✅ Args is a slice, not variadic With functions
- ✅ EnvPlaceholders is a map, not multiple WithEnvPlaceholder() calls

### Step 3: Update Environment Variables

**Before:**
```go
apiKey, err := environment.New(
    environment.WithName("API_KEY"),
    environment.WithSecret(true),
    environment.WithDescription("API key"),
)
```

**After:**
```go
apiKey, err := environment.New(ctx, "API_KEY", &environment.VariableArgs{
    IsSecret:    true,
    Description: "API key",
})
```

**Changes:**
- ✅ Add ctx as first parameter
- ✅ Name is now a positional parameter (second, after ctx)
- ✅ `WithSecret()` → `IsSecret` field
- ✅ `WithDefaultValue()` → `DefaultValue` field

### Step 4: Replace Skill Creation with Skill References

**Before:**
```go
import "github.com/stigmer/stigmer/sdk/go/skill"

// Create inline skill
mySkill, err := skill.New("my-skill", &skill.SkillArgs{
    MarkdownContent: "# My Skill\n...",
    Description:     "My skill",
})

// Add to agent
agent.AddSkill(mySkill)
```

**After:**
```go
import "github.com/stigmer/stigmer/sdk/go/skillref"

// Reference existing skill
agent.AddSkillRef(skillref.Platform("my-skill"))
// Or for org skills:
agent.AddSkillRef(skillref.Organization("my-org", "my-skill"))
```

**Changes:**
- ✅ Import `skillref` instead of `skill`
- ✅ Skills are referenced, not created inline
- ✅ Use `AddSkillRef()` instead of `AddSkill()`
- ✅ Skills must be created separately via CLI or UI

### Step 5: Update Sub-Agent Creation

**Before:**
```go
sub, err := subagent.Inline(
    subagent.WithName("analyzer"),
    subagent.WithInstructions("Analyze code"),
)
```

**After:**
```go
sub, err := subagent.New(ctx, "analyzer", &subagent.SubAgentArgs{
    Instructions: "Analyze code",
})
```

**Changes:**
- ✅ `subagent.Inline()` → `subagent.New()` (sub-agents are always inline now)
- ✅ Add ctx as first parameter
- ✅ Name is now a positional parameter
- ✅ `WithInstructions()` → `Instructions` field

### Step 6: Move Instructions to Files

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
// Old functional options pattern
agent, _ := agent.New(ctx,
    agent.WithName("reviewer"),
    agent.WithInstructions("Review code"),
)
agent.AddSkill(skill.Platform("coding-standards"))
```

**After:**
```go
// New struct-args pattern
agent, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})
agent.AddSkillRef(skillref.Platform("coding-standards"))
```

**Benefits:**
- ✅ Cleaner, more readable code
- ✅ Better IDE autocomplete
- ✅ Consistent with modern Go patterns (Pulumi, Terraform, AWS SDK)
- ✅ Skills are centrally managed, not duplicated in repos

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

**Before (Functional Options):**
```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/skill"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        myAgent, _ := agent.New(ctx,
            agent.WithName("code-reviewer"),
            agent.WithInstructions("Review code for quality and best practices"),
        )
        myAgent.AddSkill(skill.Platform("coding-standards"))
        return nil
    })
}
```

**After (Struct Args):**
```go
package main

import (
    "os"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/skillref"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        instructions, _ := os.ReadFile("instructions/reviewer.md")
        
        myAgent, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
            Instructions: string(instructions),
        })
        myAgent.AddSkillRef(skillref.Platform("coding-standards"))
        return nil
    })
}
```

### Pattern 2: Agent with Multiple Skill References

**Before (Functional Options):**
```go
myAgent, _ := agent.New(ctx,
    agent.WithName("security-reviewer"),
    agent.WithInstructions("Review code for security"),
)
myAgent.AddSkill(skill.Platform("security-guidelines"))
myAgent.AddSkill(skill.Platform("coding-standards"))
```

**After (Struct Args):**
```go
myAgent, _ := agent.New(ctx, "security-reviewer", &agent.AgentArgs{
    Instructions: "Review code for security",
})
myAgent.AddSkillRefs(
    skillref.Platform("security-guidelines"),
    skillref.Platform("coding-standards"),
    skillref.Organization("my-org", "internal-standards"),
)
```

### Pattern 3: Complex Agent with Everything

**Before (Functional Options):**
```go
stigmer.Run(func(ctx *stigmer.Context) error {
    server, _ := mcpserver.Stdio(
        mcpserver.WithName("github"),
        mcpserver.WithCommand("npx"),
        mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
    )
    
    env, _ := environment.New(
        environment.WithName("GITHUB_TOKEN"),
        environment.WithSecret(true),
    )
    
    sub, _ := subagent.Inline(
        subagent.WithName("analyzer"),
        subagent.WithInstructions("Analyze code"),
    )
    
    myAgent, _ := agent.New(ctx,
        agent.WithName("complex-agent"),
        agent.WithInstructions("..."),
    )
    myAgent.AddMCPServer(server)
    myAgent.AddEnvironmentVariable(env)
    myAgent.AddSubAgent(sub)
    
    return nil
})
```

**After (Struct Args):**
```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Load instructions from file
    instructions, _ := os.ReadFile("instructions/complex-agent.md")
    
    // Create MCP server with struct-args
    server, _ := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
        Command: "npx",
        Args:    []string{"-y", "@modelcontextprotocol/server-github"},
        EnvPlaceholders: map[string]string{
            "GITHUB_TOKEN": "${GITHUB_TOKEN}",
        },
    })
    
    // Create environment variable with struct-args
    env, _ := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
        IsSecret:    true,
        Description: "GitHub API token",
    })
    
    // Create sub-agent with struct-args
    sub, _ := subagent.New(ctx, "analyzer", &subagent.SubAgentArgs{
        Instructions: "Analyze code quality",
        Description:  "Code analyzer sub-agent",
    })
    
    // Create main agent with struct-args
    myAgent, _ := agent.New(ctx, "complex-agent", &agent.AgentArgs{
        Instructions: string(instructions),
        Description:  "Complex agent with all features",
    })
    
    // Build agent incrementally
    myAgent.
        AddSkillRef(skillref.Platform("coding-standards")).
        AddMCPServer(server).
        AddEnvironmentVariable(env).
        AddSubAgent(sub)
    
    return nil
})
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
