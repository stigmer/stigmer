# Coding Guideline 006: Test File Pattern for Struct-Based Args

**Created**: 2026-01-24
**Context**: Discovered during agent test file updates (Conversation 6)
**Status**: ACTIVE

## Problem

When updating test files from functional options to struct-based args, must understand the architecture to write correct tests.

## Key Understanding

### AgentArgs Contains Proto Types (Not SDK Types)

The generated `AgentArgs` struct contains proto types, not SDK types:

```go
// AgentArgs - GENERATED from proto schema
type AgentArgs struct {
    Description  string                           // ✅ Simple field
    IconUrl      string                           // ✅ Simple field  
    Instructions string                           // ✅ Simple field
    McpServers   []*types.McpServerDefinition    // ⚠️ Proto type!
    SkillRefs    []*types.ApiResourceReference   // ⚠️ Proto type!
    SubAgents    []*types.SubAgent               // ⚠️ Proto type!
    EnvSpec      *types.EnvironmentSpec          // ⚠️ Proto type!
}
```

### Agent Struct Contains SDK Types

The `Agent` struct contains SDK types for actual use:

```go
// Agent - SDK struct for runtime use
type Agent struct {
    Name         string
    Instructions string
    Description  string
    IconURL      string
    Skills       []skill.Skill              // ✅ SDK type
    MCPServers   []mcpserver.MCPServer      // ✅ SDK type
    SubAgents    []subagent.SubAgent        // ✅ SDK type
    EnvironmentVariables []environment.Variable // ✅ SDK type
}
```

### New() Creates Empty Agent + Builder Methods Populate

The `New()` function creates an agent with simple fields and EMPTY complex field slices:

```go
func New(ctx Context, name string, args *AgentArgs) (*Agent, error) {
    a := &Agent{
        Name:         name,
        Instructions: args.Instructions,  // Simple field from args
        Description:  args.Description,   // Simple field from args
        IconURL:      args.IconUrl,       // Simple field from args
    }
    
    // Initialize EMPTY slices (not from args!)
    a.Skills = []skill.Skill{}
    a.MCPServers = []mcpserver.MCPServer{}
    a.SubAgents = []subagent.SubAgent{}
    a.EnvironmentVariables = []environment.Variable{}
    
    return a, nil
}
```

**Then use builder methods to populate**:
```go
agent.AddSkill(skill.Platform("coding"))
agent.AddMCPServer(server)
```

## Correct Test Pattern

### Pattern 1: Agent with Simple Fields Only

```go
func TestAgentCreation(t *testing.T) {
    agent, err := New(nil, "test-agent", &AgentArgs{
        Instructions: "Test instructions for agent",
        Description:  "Test description",
        IconUrl:      "https://example.com/icon.png",
    })
    
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    
    // Verify fields
    if agent.Name != "test-agent" {
        t.Errorf("Name = %v, want test-agent", agent.Name)
    }
}
```

### Pattern 2: Agent with Skills

```go
func TestAgentWithSkills(t *testing.T) {
    // Step 1: Create agent with basic args
    agent, err := New(nil, "test-agent", &AgentArgs{
        Instructions: "Test instructions for agent",
    })
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    
    // Step 2: Add skills using builder methods
    agent.AddSkill(skill.Platform("coding-best-practices"))
    agent.AddSkill(skill.Organization("my-org", "docs"))
    
    // Verify
    if len(agent.Skills) != 2 {
        t.Errorf("Skills count = %d, want 2", len(agent.Skills))
    }
}
```

### Pattern 3: Agent with Environment Variables

```go
func TestAgentWithEnvVars(t *testing.T) {
    // Create environment variables (still uses functional options)
    githubToken, _ := environment.New(
        environment.WithName("GITHUB_TOKEN"),
        environment.WithSecret(true),
    )
    
    awsRegion, _ := environment.New(
        environment.WithName("AWS_REGION"),
        environment.WithDefaultValue("us-east-1"),
    )
    
    // Create agent
    agent, err := New(nil, "cloud-deployer", &AgentArgs{
        Instructions: "Deploy to cloud",
    })
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    
    // Add environment variables using builder method
    agent.AddEnvironmentVariables(githubToken, awsRegion)
    
    // Verify
    if len(agent.EnvironmentVariables) != 2 {
        t.Errorf("EnvironmentVariables count = %d, want 2", len(agent.EnvironmentVariables))
    }
}
```

### Pattern 4: Agent with Sub-Agents

```go
func TestAgentWithSubAgents(t *testing.T) {
    // Create sub-agent (still uses functional options)
    helper, _ := subagent.Inline(
        subagent.WithName("helper"),
        subagent.WithInstructions("Helper instructions"),
    )
    
    // Create agent
    agent, err := New(nil, "main-agent", &AgentArgs{
        Instructions: "Main agent instructions",
    })
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    
    // Add sub-agent using builder method
    agent.AddSubAgent(helper)
    
    // Verify
    if len(agent.SubAgents) != 1 {
        t.Errorf("SubAgents count = %d, want 1", len(agent.SubAgents))
    }
}
```

### Pattern 5: Complex Agent with All Features

```go
func TestComplexAgent(t *testing.T) {
    // Create dependencies
    github, _ := mcpserver.Stdio(
        mcpserver.WithName("github"),
        mcpserver.WithCommand("npx"),
    )
    
    helper, _ := subagent.Inline(
        subagent.WithName("helper"),
        subagent.WithInstructions("Helper instructions"),
    )
    
    apiKey, _ := environment.New(
        environment.WithName("API_KEY"),
        environment.WithSecret(true),
    )
    
    // Create agent with simple fields
    agent, err := New(nil, "complex-agent", &AgentArgs{
        Instructions: "Complex agent instructions",
        Description:  "Complex agent for testing",
        IconUrl:      "https://example.com/icon.png",
    })
    if err != nil {
        t.Fatalf("New() error = %v", err)
    }
    
    // Add complex fields using builder methods (can chain)
    agent.
        AddSkill(skill.Platform("coding")).
        AddSkill(skill.Platform("security")).
        AddMCPServer(github).
        AddSubAgent(helper).
        AddEnvironmentVariable(apiKey)
    
    // Verify all were added
    if len(agent.Skills) != 2 { t.Error("Expected 2 skills") }
    if len(agent.MCPServers) != 1 { t.Error("Expected 1 MCP server") }
    if len(agent.SubAgents) != 1 { t.Error("Expected 1 sub-agent") }
    if len(agent.EnvironmentVariables) != 1 { t.Error("Expected 1 env var") }
}
```

## Common Mistakes to Avoid

### ❌ DON'T: Try to Pass SDK Types in AgentArgs

```go
// ❌ WRONG - Skills field doesn't exist in AgentArgs
agent, err := New(nil, "test", &AgentArgs{
    Instructions: "Test",
    Skills:       []skill.Skill{skill.Platform("coding")}, // ❌ Field doesn't exist!
})
```

### ❌ DON'T: Try to Pass Proto Types Manually

```go
// ❌ WRONG - Manually creating proto types
agent, err := New(nil, "test", &AgentArgs{
    Instructions: "Test",
    SkillRefs:    []*types.ApiResourceReference{...}, // ❌ Too low-level!
})
```

### ❌ DON'T: Use Pointer for Simple Fields

```go
// ❌ WRONG - Instructions is string, not *string
instructions := "Test instructions"
agent, err := New(nil, "test", &AgentArgs{
    Instructions: &instructions, // ❌ Type mismatch!
})
```

### ❌ DON'T: Forget Context Parameter

```go
// ❌ WRONG - Missing Context parameter
agent, err := New("test-agent", &AgentArgs{  // ❌ Missing nil context!
    Instructions: "Test",
})
```

## ✅ Correct Patterns

### ✅ DO: Use Plain Strings for Simple Fields

```go
// ✅ CORRECT - Plain strings
agent, err := New(nil, "test-agent", &AgentArgs{
    Instructions: "Test instructions",
    Description:  "Test description",
    IconUrl:      "https://example.com/icon.png",
})
```

### ✅ DO: Use Builder Methods for Complex Fields

```go
// ✅ CORRECT - Builder methods after creation
agent, err := New(nil, "test-agent", &AgentArgs{
    Instructions: "Test instructions",
})
agent.AddSkill(skill.Platform("coding"))
agent.AddEnvironmentVariable(envVar)
```

### ✅ DO: Pass nil for Context in Tests

```go
// ✅ CORRECT - nil context for tests
agent, err := New(nil, "test-agent", &AgentArgs{
    Instructions: "Test instructions",
})
```

### ✅ DO: Chain Builder Methods

```go
// ✅ CORRECT - Chaining for conciseness
agent, err := New(nil, "test", &AgentArgs{
    Instructions: "Test",
})
agent.
    AddSkill(skill.Platform("coding")).
    AddSkill(skill.Platform("security")).
    AddMCPServer(github).
    AddSubAgent(helper)
```

## File Loading Pattern

### ✅ DO: Use LoadInstructionsFromFile() Helper

```go
func TestLoadFromFile(t *testing.T) {
    // Load from file using helper
    instructions, err := LoadInstructionsFromFile("instructions.md")
    if err != nil {
        t.Fatalf("LoadInstructionsFromFile() error = %v", err)
    }
    
    // Use loaded content (plain string, not pointer)
    agent, err := New(nil, "test-agent", &AgentArgs{
        Instructions: instructions,  // ✅ Plain string
    })
    
    // Verify
    if agent.Instructions != expectedContent {
        t.Errorf("Instructions mismatch")
    }
}
```

## Summary

**Architecture Pattern**:
1. `AgentArgs` = Simple proto-aligned fields (strings, primitives)
2. `New()` = Creates agent from args, initializes empty complex field slices
3. Builder methods = Populate complex fields with SDK types
4. Tests = Create with args, add complex fields with builders

**Why This Matters for Tests**:
- Tests demonstrate correct usage pattern
- Cannot shortcut with direct struct initialization
- Must follow the same two-step pattern users will use
- Builder methods are part of the public API

**Next Session Goal**:
- Fix remaining 6 test files
- Get all agent tests compiling and passing
- Move on to workflow examples with confidence

---

*This pattern applies to ALL tests for struct-based args components (Agent, Skill, Workflow tasks)*
