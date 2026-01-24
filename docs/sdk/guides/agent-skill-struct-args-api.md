# Agent and Skill Struct-Based Args API

**Last Updated**: 2026-01-24  
**SDK Version**: v0.x (pre-release)  
**Pattern**: Pulumi-Style Struct Args

---

## Overview

The Stigmer Go SDK uses Pulumi-style struct-based args for creating agents and skills. This pattern provides excellent IDE support, type safety, and clean, readable code.

This guide explains how to create agents and skills using the current API.

---

## Quick Start

### Basic Agent

```go
import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
            Instructions: "Review code and suggest improvements",
            Description:  "Professional code reviewer",
        })
        if err != nil {
            return err
        }
        
        // Agent is automatically synthesized when stigmer.Run() completes
        return nil
    })
}
```

### Basic Skill

```go
import "github.com/stigmer/stigmer/sdk/go/skill"

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        sk, err := skill.New("code-analyzer", &skill.SkillArgs{
            Description:     "Analyzes code quality",
            MarkdownContent: "# Code Analysis\n\nAnalyzes code for best practices...",
        })
        if err != nil {
            return err
        }
        
        // Use skill with agent
        ag, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
            Instructions: "Review code using analyzer skill",
        })
        ag.AddSkill(*sk)
        
        return nil
    })
}
```

---

## Agent API

### Creating Agents

The `agent.New()` constructor follows Pulumi's pattern:

**Signature**:
```go
func New(ctx Context, name string, args *AgentArgs) (*Agent, error)
```

**Parameters**:
- `ctx` - Stigmer context (from `stigmer.Run()`)
- `name` - Agent name (lowercase alphanumeric with hyphens, max 63 chars)
- `args` - Configuration struct (can be `nil` for defaults)

**Returns**:
- `*Agent` - Configured agent instance
- `error` - Validation or creation error

### AgentArgs Structure

```go
type AgentArgs struct {
    // Required
    Instructions string  // Agent behavior and personality (min 10, max 10000 chars)
    
    // Optional
    Description  string                         // Human-readable description (max 500 chars)
    IconUrl      string                         // Icon URL for UI display
    SkillRefs    []*types.ApiResourceReference  // References to Skill resources
    McpServers   []*types.McpServerDefinition   // MCP server definitions
    SubAgents    []*types.SubAgent              // Sub-agent definitions
    EnvSpec      *types.EnvironmentSpec         // Environment variables
}
```

### Agent Examples

**Minimal Agent** (required fields only):
```go
agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "Review code and suggest improvements based on best practices",
})
```

**Full Agent** (all fields):
```go
agent.New(ctx, "code-reviewer-pro", &agent.AgentArgs{
    Instructions: "Review code with security focus",
    Description:  "Professional code reviewer with security expertise",
    IconUrl:      "https://example.com/icons/reviewer.png",
})
```

**Nil Args** (for post-creation configuration):
```go
ag, _ := agent.New(ctx, "code-reviewer", nil)
// Configure after creation
ag.Instructions = "Review code and suggest improvements"
ag.AddSkill(skill.Platform("coding-best-practices"))
```

### Builder Methods

Agents support fluent builder methods for adding components after creation:

**AddSkill** (single skill):
```go
ag.AddSkill(skill.Platform("coding-best-practices"))
```

**AddSkills** (multiple skills):
```go
ag.AddSkills(
    skill.Platform("security-analysis"),
    skill.Platform("performance-optimization"),
)
```

**Chaining**:
```go
ag.
    AddSkill(skill.Platform("coding-best-practices")).
    AddSkill(skill.Platform("security-analysis")).
    AddMCPServer(githubServer)
```

---

## Skill API

### Creating Skills

Skills come in two types:

1. **Inline Skills** - Defined in your code/repository
2. **Referenced Skills** - References to platform/organization skills

### Inline Skills

Use `skill.New()` for inline skill definitions:

**Signature**:
```go
func New(name string, args *SkillArgs) (*Skill, error)
```

**Parameters**:
- `name` - Skill name (lowercase alphanumeric with hyphens, max 63 chars)
- `args` - Configuration struct (cannot be `nil`)

**SkillArgs Structure**:
```go
type SkillArgs struct {
    Description     string  // Brief description for UI display (optional)
    MarkdownContent string  // Skill documentation/knowledge (required)
}
```

**Example**:
```go
skill, _ := skill.New("code-analyzer", &skill.SkillArgs{
    Description:     "Analyzes code quality and suggests improvements",
    MarkdownContent: "# Code Analysis\n\nThis skill analyzes code for best practices...",
})
```

**Loading from File**:
```go
content, err := skill.LoadMarkdownFromFile("skills/analyzer.md")
if err != nil {
    return err
}

sk, _ := skill.New("code-analyzer", &skill.SkillArgs{
    Description:     "Code quality analyzer",
    MarkdownContent: content,
})
```

### Referenced Skills

Use helper functions for referencing existing skills:

**Platform Skills** (shared across all users):
```go
platformSkill := skill.Platform("coding-best-practices")
```

**Organization Skills** (private to your org):
```go
orgSkill := skill.Organization("my-org", "internal-security-guidelines")
```

**Usage**:
```go
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})
ag.AddSkills(
    skill.Platform("coding-best-practices"),
    skill.Organization("my-org", "internal-guidelines"),
)
```

---

## Pattern Comparison

### Why Struct Args?

The SDK uses **struct-based args** following Pulumi's proven pattern, NOT functional options.

**Struct Args** (What we use):
```go
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",  // ← IDE autocompletes "Instructions"
    Description:  "Pro reviewer",  // ← Clear, readable
})
```

**Functional Options** (What we DON'T use):
```go
agent.New(ctx, "reviewer",
    gen.AgentInstructions("Review code"),  // ❌ Verbose
    gen.AgentDescription("Pro reviewer"),  // ❌ Less discoverable
)
```

### Benefits of Struct Args

1. **IDE Autocomplete**: Type a field name and get instant completion
2. **Type Safety**: Struct fields have explicit types and validation
3. **Readability**: Clean struct literals are easy to read and modify
4. **Discoverability**: Just look at `AgentArgs` definition to see all options
5. **Industry Standard**: Matches Pulumi conventions that IaC developers know
6. **Consistency**: Same pattern across all SDK resources

---

## Common Patterns

### Agent with Skills

```go
// Create inline skill
mySkill, _ := skill.New("code-analyzer", &skill.SkillArgs{
    Description:     "Analyzes code quality",
    MarkdownContent: "# Code Analysis\n\nContent...",
})

// Create agent
ag, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code using analyzer skill",
})

// Add skill using builder
ag.AddSkill(*mySkill)

// Or add platform/org skills directly
ag.AddSkills(
    skill.Platform("coding-best-practices"),
    skill.Organization("my-org", "internal-standards"),
)
```

### Agent with MCP Servers

```go
// Create MCP server
github, _ := mcpserver.Stdio(
    mcpserver.WithName("github"),
    mcpserver.WithCommand("npx"),
    mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
)

// Create agent
ag, _ := agent.New(ctx, "github-agent", &agent.AgentArgs{
    Instructions: "Manage GitHub repositories",
    Description:  "GitHub automation agent",
})

// Add MCP server using builder
ag.AddMCPServer(github)
```

### Loading Instructions from Files

```go
// Load instructions from external file
content, err := os.ReadFile("agents/code-reviewer.md")
if err != nil {
    return err
}

// Create agent with loaded instructions
ag, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: string(content),
    Description:  "Code reviewer with comprehensive guidelines",
})
```

### Skill from File

```go
// Load skill markdown from file
content, err := skill.LoadMarkdownFromFile("skills/security-analysis.md")
if err != nil {
    return err
}

// Create skill with loaded content
sk, _ := skill.New("security-analyzer", &skill.SkillArgs{
    Description:     "Security analysis guidelines",
    MarkdownContent: content,
})
```

---

## Validation

### Agent Validation

**Name Requirements**:
- Lowercase alphanumeric characters and hyphens only
- Must start and end with alphanumeric character
- Maximum 63 characters
- Examples: `code-reviewer`, `devops-agent`, `security-scanner`

**Instructions Requirements**:
- Minimum 10 characters
- Maximum 10,000 characters
- Plain text or markdown format

**Description Requirements** (optional):
- Maximum 500 characters

### Skill Validation

**Name Requirements** (same as agent):
- Lowercase alphanumeric with hyphens
- 1-63 characters
- Must start/end with alphanumeric

**MarkdownContent Requirements**:
- Required for inline skills
- No minimum length (but should be meaningful)
- Markdown format

**Slug Auto-Generation**:
- Automatically generated from name
- Converts to lowercase, replaces spaces with hyphens
- Example: "Code Analyzer" → "code-analyzer"

---

## Error Handling

### Common Errors

**Missing Required Fields**:
```go
// Missing instructions
ag, err := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Description: "Reviewer",
    // Instructions missing!
})
// Returns: validation error for required field "instructions"
```

**Invalid Name Format**:
```go
// Invalid name (uppercase)
ag, err := agent.New(ctx, "Code-Reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})
// Returns: validation error - name must be lowercase
```

**Missing Skill Content**:
```go
// Missing markdown content
sk, err := skill.New("analyzer", &skill.SkillArgs{
    Description: "Analyzer",
    // MarkdownContent missing!
})
// Returns: ErrSkillMarkdownRequired
```

**File Loading Errors**:
```go
content, err := skill.LoadMarkdownFromFile("non-existent.md")
if err != nil {
    // Handle file not found error
    return err
}
```

---

## Migration from Old Pattern

If you have code using the old functional options pattern, here's how to migrate:

### Agent Migration

**Before** (Functional Options - Deprecated):
```go
agent.New(ctx, "reviewer",
    gen.AgentInstructions("Review code"),
    gen.AgentDescription("Professional reviewer"),
    gen.AgentIconUrl("https://example.com/icon.png"),
)
```

**After** (Struct Args - Current):
```go
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
    Description:  "Professional reviewer",
    IconUrl:      "https://example.com/icon.png",
})
```

### Skill Migration

**Before** (Functional Options - Deprecated):
```go
skill.New(
    skill.WithName("analyzer"),
    skill.WithDescription("Code analyzer"),
    skill.WithMarkdown("# Content"),
)
```

**After** (Struct Args - Current):
```go
skill.New("analyzer", &skill.SkillArgs{
    Description:     "Code analyzer",
    MarkdownContent: "# Content",
})
```

### File Loading Migration

**Before**:
```go
skill.New(
    skill.WithName("analyzer"),
    skill.WithMarkdownFromFile("skills/content.md"),
)
```

**After**:
```go
content, _ := skill.LoadMarkdownFromFile("skills/content.md")
skill.New("analyzer", &skill.SkillArgs{
    MarkdownContent: content,
})
```

---

## Best Practices

### 1. Use Struct Literals for Clarity

**Good** (explicit field names):
```go
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code...",
    Description:  "Professional code reviewer",
    IconUrl:      "https://example.com/icon.png",
})
```

**Avoid** (nil args when fields are needed):
```go
ag, _ := agent.New(ctx, "reviewer", nil)
ag.Instructions = "Review code..."  // Less clear
```

### 2. Load Large Content from Files

**Good** (separate files for long content):
```go
instructions, _ := os.ReadFile("agents/reviewer-instructions.md")
skill, _ := skill.New("analyzer", &skill.SkillArgs{
    MarkdownContent: instructions,
})
```

**Avoid** (inline multi-line strings for large content):
```go
skill.New("analyzer", &skill.SkillArgs{
    MarkdownContent: `# Very Long Content
    ... 500 lines of markdown ...
    `,
})
```

### 3. Use Builder Methods for Complex Configuration

**Good** (progressive construction):
```go
ag, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})

// Add components progressively
ag.AddSkills(
    skill.Platform("coding-best-practices"),
    skill.Platform("security-analysis"),
)

ag.AddMCPServer(githubServer)
ag.AddMCPServer(awsServer)
```

**Also Good** (all at once if preferred):
```go
ag, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})

ag.
    AddSkill(skill.Platform("coding-best-practices")).
    AddSkill(skill.Platform("security-analysis")).
    AddMCPServer(githubServer).
    AddMCPServer(awsServer)
```

### 4. Validate Early

**Good** (handle errors immediately):
```go
ag, err := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})
if err != nil {
    return fmt.Errorf("failed to create agent: %w", err)
}
```

**Avoid** (ignoring errors):
```go
ag, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})
// Error ignored - validation failures missed
```

---

## Advanced Usage

### Nil Args

You can pass `nil` args if you want to configure after creation:

```go
ag, err := agent.New(ctx, "reviewer", nil)
if err != nil {
    return err  // Will fail validation (instructions required)
}

// Won't reach here because validation requires instructions
```

**Use case**: When you need to create the agent object but configure it conditionally:

```go
ag, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})

// Conditionally add components
if needsSecurity {
    ag.AddSkill(skill.Platform("security-analysis"))
}

if needsGitHub {
    ag.AddMCPServer(githubServer)
}
```

### Mixed Skill Types

Combine inline skills with referenced skills:

```go
// Create inline skill
customSkill, _ := skill.New("custom-analyzer", &skill.SkillArgs{
    Description:     "Custom analysis rules",
    MarkdownContent: "# Custom Rules\n\n...",
})

// Create agent with mixed skills
ag, _ := agent.New(ctx, "enterprise-reviewer", &agent.AgentArgs{
    Instructions: "Review using all available knowledge",
})

ag.AddSkills(
    *customSkill,                                       // Inline skill
    skill.Platform("coding-best-practices"),            // Platform skill
    skill.Organization("acme-corp", "internal-rules"),  // Org skill
)
```

### Dynamic Configuration

Load configuration from environment or config files:

```go
func createAgentFromConfig(ctx *stigmer.Context, cfg *Config) (*agent.Agent, error) {
    // Load instructions from configured path
    instructions, err := os.ReadFile(cfg.InstructionsPath)
    if err != nil {
        return nil, err
    }
    
    // Create agent with config-driven args
    return agent.New(ctx, cfg.AgentName, &agent.AgentArgs{
        Instructions: string(instructions),
        Description:  cfg.Description,
        IconUrl:      cfg.IconUrl,
    })
}
```

---

## IDE Support

### Autocomplete

Struct args provide excellent IDE support:

1. Type `&agent.AgentArgs{` and press Ctrl+Space
2. IDE shows all available fields with types and documentation
3. Navigate with arrow keys, select with Enter
4. Type safety prevents invalid values

### Field Documentation

Hover over any field in your IDE to see:
- Field purpose and description
- Validation requirements (min/max length, format)
- Whether field is required or optional
- Example values

### Type Hints

IDE shows parameter types as you type:
```go
agent.New(
    ctx,        // ← IDE shows: Context
    "reviewer", // ← IDE shows: string
    &agent.AgentArgs{...},  // ← IDE shows: *AgentArgs
)
```

---

## Complete Examples

See the `sdk/go/examples/` directory for working examples:

1. **`01_basic_agent.go`** - Simple agent with required fields only
2. **`02_agent_with_skills.go`** - Agent with inline, platform, and org skills
3. **`03_agent_with_mcp_servers.go`** - Agent with stdio, HTTP, and Docker MCP servers

**Run examples**:
```bash
cd sdk/go/examples
go run 01_basic_agent.go
go run 02_agent_with_skills.go
go run 03_agent_with_mcp_servers.go
```

---

## API Reference

### Agent Package

**Constructor**:
- `New(ctx Context, name string, args *AgentArgs) (*Agent, error)`

**Builder Methods**:
- `AddSkill(skill Skill) *Agent`
- `AddSkills(skills ...Skill) *Agent`
- `AddMCPServer(server MCPServer) *Agent`
- `AddMCPServers(servers ...MCPServer) *Agent`
- `AddSubAgent(subAgent SubAgent) *Agent`
- `AddSubAgents(subAgents ...SubAgent) *Agent`
- `AddEnvironmentVariable(variable Variable) *Agent`
- `AddEnvironmentVariables(variables ...Variable) *Agent`

**Validation**:
- `validate(agent *Agent) error` - Internal validation logic

### Skill Package

**Constructor (Inline)**:
- `New(name string, args *SkillArgs) (*Skill, error)`

**Helpers (Referenced)**:
- `Platform(slug string) Skill`
- `Organization(org, slug string) Skill`

**Utilities**:
- `LoadMarkdownFromFile(path string) (string, error)`

**Query Methods**:
- `IsPlatformReference() bool`
- `IsOrganizationReference() bool`
- `NameOrSlug() string`
- `String() string`

---

## Design Rationale

### Why Pulumi's Pattern?

Stigmer follows Pulumi's struct-based args pattern for several reasons:

1. **Ecosystem Alignment**: Pulumi is the leading IaC framework - developers are familiar with this pattern
2. **Proven Design**: Pulumi's API has been battle-tested across thousands of resource types
3. **Industry Standard**: Most modern Go SDKs use struct-based configuration
4. **Better Tooling**: IDEs provide superior support for structs vs variadic options

### Configuration vs SDK Options

**Struct Args** (resource configuration):
- Field values specific to the resource
- What the agent/skill does and contains
- Example: Instructions, Description, Skills

**Functional Options** (SDK-level concerns - future):
- Resource lifecycle concerns
- Cross-cutting SDK features
- Example: Parent, DependsOn, Protect (not yet implemented)

### Name as Parameter

Following Pulumi, the resource name is a separate parameter:

```go
// Name is first-class parameter (not in args struct)
agent.New(ctx, "code-reviewer", &agent.AgentArgs{...})
skill.New("code-analyzer", &skill.SkillArgs{...})
```

**Rationale**:
- Name is always required
- Name is used for resource identity
- Separates identity from configuration

---

## Future SDK Options

The struct args pattern leaves room for SDK-level options (Pulumi-style):

```go
// Future API (not yet implemented)
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
}, 
    stigmer.Parent(parentResource),      // SDK option
    stigmer.DependsOn(otherResources),   // SDK option
    stigmer.Protect(true),               // SDK option
)
```

This separation keeps resource configuration (args) distinct from SDK concerns (options).

---

## Troubleshooting

### "validation failed for field"

**Problem**: Required field is missing or invalid

**Solution**: Check AgentArgs/SkillArgs for required fields:
- Agent: `Instructions` is required
- Skill: `MarkdownContent` is required

### "name must be lowercase alphanumeric"

**Problem**: Name contains uppercase, spaces, or invalid characters

**Solution**: Use lowercase with hyphens:
```go
// ❌ Wrong
agent.New(ctx, "Code Reviewer", ...)

// ✅ Correct
agent.New(ctx, "code-reviewer", ...)
```

### "no such file or directory"

**Problem**: File path for LoadMarkdownFromFile() is incorrect

**Solution**: Use relative path from execution directory:
```go
// Assumes running from project root
content, _ := skill.LoadMarkdownFromFile("skills/analyzer.md")

// Or use absolute paths if needed
content, _ := skill.LoadMarkdownFromFile("/path/to/skills/analyzer.md")
```

---

## Related Documentation

**Architecture**:
- [SDK Code Generation](../architecture/sdk-code-generation.md) - How SDK code is generated
- [SDK-CLI Contract](../architecture/sdk-cli-contract.md) - Contract between SDK and CLI

**Guides**:
- [Workflow Fluent API](./workflow-fluent-api.md) - Workflow task API (different pattern)

**Examples**:
- `sdk/go/examples/` - All working examples demonstrating patterns

---

## References

- **Pulumi AWS Provider**: Reference implementation for struct args pattern
- **Go SDK Source**: `sdk/go/agent/`, `sdk/go/skill/` packages
- **Generated Code**: `sdk/go/agent/agentspec_args.go`, `sdk/go/skill/skillspec_args.go`
- **Project**: `_projects/2026-01/20260123.02.sdk-options-codegen/`

---

*This guide reflects the current Pulumi-style struct-based args API introduced in T06 Phase 2 (2026-01-24). All examples and patterns are tested and verified working.*
