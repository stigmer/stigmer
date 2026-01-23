# Stigmer Go SDK - Usage Guide

**Version**: 0.1.0  
**Status**: Production Ready ✅

A comprehensive guide to building AI agents and workflows with the Stigmer Go SDK.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Workflow SDK](#workflow-sdk)
- [Agent SDK](#agent-sdk)
- [Skill SDK](#skill-sdk)
- [Advanced Features](#advanced-features)
- [Helper Functions](#helper-functions)
- [Best Practices](#best-practices)
- [Examples](#examples)

---

## Installation

```bash
go get github.com/stigmer/stigmer/sdk/go
```

**Requirements**:
- Go 1.21 or higher
- Stigmer CLI (for deployment)

---

## Quick Start

### Your First Agent

```go
package main

import (
    "log"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/skill"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Create a skill
        codingSkill, _ := skill.New(
            skill.WithName("coding-guidelines"),
            skill.WithMarkdownFromFile("skills/coding.md"),
        )
        
        // Create an agent
        codeReviewer, _ := agent.New(ctx,
            agent.WithName("code-reviewer"),
            agent.WithInstructionsFromFile("instructions/reviewer.md"),
            agent.WithSkills(codingSkill),
        )
        
        log.Printf("✅ Created agent: %s", codeReviewer.Name)
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

### Your First Workflow

```go
package main

import (
    "log"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Create workflow
        wf, _ := workflow.New(ctx,
            workflow.WithNamespace("data-processing"),
            workflow.WithName("api-fetch"),
            workflow.WithVersion("1.0.0"),
        )
        
        // Fetch data from API
        fetchTask := wf.HttpGet("fetch", "https://api.example.com/data",
            workflow.Header("Content-Type", "application/json"),
            workflow.Timeout(30),
        )
        
        // Process the response
        wf.SetVars("process",
            "title", fetchTask.Field("title"),
            "body", fetchTask.Field("body"),
        )
        
        log.Printf("✅ Created workflow with %d tasks", len(wf.Tasks))
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

---

## Core Concepts

### The Context

`stigmer.Context` is the central coordination point for your resources:

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Context manages:
    // - Resource registration (agents, workflows, skills)
    // - Dependency tracking
    // - Configuration values
    // - Automatic synthesis
    
    return nil
})
```

**Key Features**:
- Automatic resource registration
- Dependency graph tracking
- Configuration management
- Thread-safe operations
- Auto-synthesis on completion

### Resource Registration

Resources register themselves automatically:

```go
// Agent registers with context
agent, _ := agent.New(ctx, agent.WithName("my-agent"))
// → Registered as "agent:my-agent"

// Workflow registers with context
wf, _ := workflow.New(ctx, workflow.WithName("my-workflow"))
// → Registered as "workflow:my-workflow"

// Skills register when used inline
skill, _ := skill.New(skill.WithName("my-skill"))
// → Registered as "skill:my-skill" when added to agent
```

### Dependency Tracking

The SDK tracks dependencies automatically:

```go
// Create skill
skill, _ := skill.New(skill.WithName("coding"))

// Create agent with skill (dependency tracked automatically)
agent, _ := agent.New(ctx,
    agent.WithName("reviewer"),
    agent.WithSkills(skill),
)
// → Dependency: "agent:reviewer" → "skill:coding"

// Inspect dependency graph
deps := ctx.Dependencies()
// deps["agent:reviewer"] = ["skill:coding"]
```

**Why This Matters**:
- Resources are created in correct order
- Circular dependencies are detected
- Platform can manage resource lifecycle

---

## Workflow SDK

Build powerful workflow orchestrations with type-safe, fluent APIs.

### Creating a Workflow

```go
wf, err := workflow.New(ctx,
    workflow.WithNamespace("data-processing"),
    workflow.WithName("daily-sync"),
    workflow.WithVersion("1.0.0"),
    workflow.WithDescription("Daily data synchronization"),
)
```

**Required Options**:
- `WithNamespace()` - Organizational namespace
- `WithName()` - Workflow identifier
- `WithVersion()` - Semantic version

**Optional Options**:
- `WithDescription()` - Human-readable description
- `WithTags()` - Metadata tags

### HTTP Tasks

Clean, intuitive HTTP builders:

#### GET Request

```go
fetchTask := wf.HttpGet("fetch", "https://api.example.com/users",
    workflow.Header("Authorization", "Bearer ${API_TOKEN}"),
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

#### POST Request

```go
createTask := wf.HttpPost("create", "https://api.example.com/users",
    workflow.Body(map[string]interface{}{
        "name": "John Doe",
        "email": "john@example.com",
    }),
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

#### PUT Request

```go
updateTask := wf.HttpPut("update", "https://api.example.com/users/123",
    workflow.Body(userData),
    workflow.Header("Content-Type", "application/json"),
)
```

#### DELETE Request

```go
deleteTask := wf.HttpDelete("delete", "https://api.example.com/users/123",
    workflow.Header("Authorization", "Bearer ${API_TOKEN}"),
)
```

**Available Options**:
- `Header(key, value)` - Add HTTP headers
- `Body(data)` - Set request body (map or struct)
- `Timeout(seconds)` - Request timeout
- `Query(key, value)` - Add query parameters

### SET Tasks (Variable Assignment)

```go
// Single variable
wf.Set("status", "value", "success")

// Multiple variables (recommended)
wf.SetVars("process",
    "userId", fetchTask.Field("id"),
    "userName", fetchTask.Field("name"),
    "timestamp", workflow.Now(),
)
```

### Task Field References

Reference task outputs to create dependencies:

```go
// Task produces outputs
fetchTask := wf.HttpGet("fetch", endpoint)

// Other tasks reference fields (creates implicit dependency)
processTask := wf.SetVars("process",
    "title", fetchTask.Field("title"),      // From fetchTask
    "body", fetchTask.Field("body"),        // From fetchTask
    "status", "complete",                    // Static value
)
```

**Key Points**:
- `task.Field("name")` creates a typed reference
- Dependencies are tracked automatically
- No manual dependency wiring needed
- Compile-time type safety

### Agent Call Tasks

Call AI agents from workflows:

```go
// Call agent by reference
reviewTask := wf.AgentCall("review", codeReviewAgent,
    workflow.AgentInput("code", fetchTask.Field("content")),
    workflow.AgentModel("gpt-4"),
    workflow.AgentTemperature(0.7),
    workflow.AgentTimeout(300),
)

// Call agent by slug
reviewTask := wf.AgentCallBySlug("review", "code-reviewer",
    workflow.AgentInput("pr_number", "123"),
)
```

**Options**:
- `AgentInput(key, value)` - Pass input to agent
- `AgentModel(name)` - Override LLM model
- `AgentTemperature(value)` - Set creativity (0.0-1.0)
- `AgentMaxTokens(count)` - Limit response length
- `AgentTimeout(seconds)` - Execution timeout

### WAIT Tasks

Pause workflow execution:

```go
// Wait for duration
wf.Wait("pause", workflow.WaitDuration("30s"))

// Wait until timestamp
wf.Wait("schedule", workflow.WaitUntil("2024-12-31T23:59:59Z"))
```

### LISTEN Tasks

Wait for external events:

```go
listenTask := wf.Listen("wait-for-approval",
    workflow.SignalName("approval-signal"),
    workflow.ListenTimeout(3600),  // 1 hour timeout
)
```

### RAISE Tasks

Emit events from workflow:

```go
wf.Raise("notify",
    workflow.SignalName("workflow-complete"),
    workflow.SignalPayload(map[string]interface{}{
        "status": "success",
        "duration": "45s",
    }),
)
```

---

## Advanced Features

### Conditional Logic (Switch)

Branch execution based on conditions:

```go
// Create switch task
switchTask := wf.Switch("check-status",
    // Condition cases
    workflow.SwitchCase(
        workflow.ConditionEquals("status", "success"),
        workflow.Then(
            wf.HttpPost("notify-success", successWebhook),
        ),
    ),
    workflow.SwitchCase(
        workflow.ConditionEquals("status", "error"),
        workflow.Then(
            wf.HttpPost("notify-error", errorWebhook),
        ),
    ),
    // Default case
    workflow.SwitchDefault(
        wf.Set("unknown", "message", "Unknown status"),
    ),
)
```

**Condition Helpers**:
- `ConditionEquals(key, value)` - Equality check
- `ConditionNotEquals(key, value)` - Inequality check
- `ConditionGreaterThan(key, value)` - Greater than
- `ConditionLessThan(key, value)` - Less than
- `ConditionContains(key, substring)` - String contains
- `ConditionStartsWith(key, prefix)` - String starts with
- `ConditionEndsWith(key, suffix)` - String ends with
- `ConditionMatchesRegex(key, pattern)` - Regex match

### Loops (ForEach)

Iterate over collections:

```go
// Fetch list of items
fetchTask := wf.HttpGet("fetch-users", usersEndpoint)

// Process each item
forEachTask := wf.ForEach("process-users",
    workflow.ForEachOver(fetchTask.Field("users")),
    workflow.ForEachItem("user"),
    workflow.ForEachDo(
        wf.HttpPost("process", processEndpoint,
            workflow.Body(map[string]interface{}{
                "userId": workflow.LoopVar("user.id"),
                "name": workflow.LoopVar("user.name"),
            }),
        ),
    ),
)
```

**Options**:
- `ForEachOver(array)` - Array to iterate
- `ForEachItem(varName)` - Loop variable name
- `ForEachIndex(varName)` - Index variable name (optional)
- `ForEachDo(...tasks)` - Tasks to execute per item

### Error Handling (Try/Catch)

Handle errors gracefully:

```go
tryTask := wf.Try("safe-operation",
    // Try block
    workflow.TryDo(
        wf.HttpPost("risky-operation", endpoint,
            workflow.Body(data),
        ),
    ),
    // Catch block
    workflow.CatchError(
        workflow.ErrorMatcher(workflow.ErrorCode("TIMEOUT")),
        workflow.CatchDo(
            wf.SetVars("handle-timeout",
                "status", "timeout",
                "retry", "true",
            ),
        ),
    ),
    workflow.CatchError(
        workflow.ErrorMatcher(workflow.ErrorAny()),
        workflow.CatchDo(
            wf.SetVars("handle-error",
                "status", "error",
                "retry", "false",
            ),
        ),
    ),
)
```

**Error Matchers**:
- `ErrorCode(code)` - Match specific error code
- `ErrorType(type)` - Match error type
- `ErrorAny()` - Match any error (catch-all)

### Parallel Execution (Fork)

Run tasks concurrently:

```go
forkTask := wf.Fork("parallel-fetch",
    workflow.ForkBranch("branch1",
        wf.HttpGet("fetch1", endpoint1),
    ),
    workflow.ForkBranch("branch2",
        wf.HttpGet("fetch2", endpoint2),
    ),
    workflow.ForkBranch("branch3",
        wf.HttpGet("fetch3", endpoint3),
    ),
)

// All branches run in parallel
// Workflow continues when ALL branches complete
```

---

## Helper Functions

### Expression Helpers

#### String Interpolation

```go
// Interpolate variables into strings
message := workflow.Interpolate("Hello, ${name}! Status: ${status}")
```

#### Runtime Secrets

```go
// Reference runtime secrets
apiKey := workflow.RuntimeSecret("API_KEY")

wf.HttpGet("fetch", endpoint,
    workflow.Header("Authorization", workflow.Concat("Bearer ", apiKey)),
)
```

#### Runtime Environment Variables

```go
// Reference runtime environment variables
region := workflow.RuntimeEnv("AWS_REGION")
```

#### String Operations

```go
// Concatenate strings
fullUrl := workflow.Concat(baseUrl, "/api/v1/users")

// Uppercase
upper := workflow.ToUpper("hello")

// Lowercase
lower := workflow.ToLower("HELLO")

// Trim whitespace
trimmed := workflow.Trim("  hello  ")

// Substring
sub := workflow.Substring("hello world", 0, 5)  // "hello"

// Replace
replaced := workflow.Replace("hello world", "world", "Go")
```

#### JSON Operations

```go
// Parse JSON string
parsed := workflow.ParseJSON(jsonString)

// Stringify object to JSON
jsonStr := workflow.ToJSON(dataObject)

// Extract JSON field
value := workflow.JSONPath(jsonData, "$.user.name")
```

#### Numeric Operations

```go
// Add numbers
sum := workflow.Add(10, 20)

// Subtract
diff := workflow.Subtract(100, 30)

// Multiply
product := workflow.Multiply(5, 10)

// Divide
quotient := workflow.Divide(100, 5)

// Modulo
remainder := workflow.Modulo(10, 3)
```

#### Temporal Helpers

```go
// Current timestamp
now := workflow.Now()

// Format timestamp
formatted := workflow.FormatTime(now, "2006-01-02")

// Parse timestamp
parsed := workflow.ParseTime("2024-01-15", "2006-01-02")

// Add duration
future := workflow.AddDuration(now, "1h30m")
```

#### Array Operations

```go
// Array length
length := workflow.Length(arrayVar)

// Get element by index
element := workflow.At(arrayVar, 0)

// Check if array contains value
contains := workflow.Contains(arrayVar, "value")

// Join array into string
joined := workflow.Join(arrayVar, ", ")

// Map over array
mapped := workflow.Map(arrayVar, "item", workflow.ToUpper(workflow.Var("item")))

// Filter array
filtered := workflow.Filter(arrayVar, "item", 
    workflow.ConditionGreaterThan("item.age", 18))
```

---

## Agent SDK

### Creating an Agent

```go
agent, err := agent.New(ctx,
    agent.WithName("code-reviewer"),
    agent.WithInstructionsFromFile("instructions/reviewer.md"),
    agent.WithDescription("AI code reviewer with security expertise"),
    agent.WithIconURL("https://example.com/icon.png"),
)
```

**Required Options**:
- `WithName()` - Agent identifier
- `WithInstructionsFromFile()` or `WithInstructions()` - Agent instructions

**Optional Options**:
- `WithDescription()` - Human-readable description
- `WithIconURL()` - Display icon URL

### Adding Skills

#### Inline Skills (Defined in Repository)

```go
// Create skill from file
skill, _ := skill.New(
    skill.WithName("security-guidelines"),
    skill.WithDescription("Security review guidelines"),
    skill.WithMarkdownFromFile("skills/security.md"),
)

// Add to agent
agent.AddSkill(*skill)
```

#### Platform Skills (Shared)

```go
// Reference platform-wide skill
agent.AddSkill(skill.Platform("coding-best-practices"))
```

#### Organization Skills (Private)

```go
// Reference organization-private skill
agent.AddSkill(skill.Organization("my-org", "internal-standards"))
```

### Adding MCP Servers

#### Stdio Servers

```go
githubMCP, _ := mcpserver.Stdio(
    mcpserver.WithName("github"),
    mcpserver.WithCommand("npx"),
    mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
    mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
)

agent.AddMCPServer(githubMCP)
```

#### HTTP Servers

```go
remoteMCP, _ := mcpserver.HTTP(
    mcpserver.WithName("remote-mcp"),
    mcpserver.WithURL("https://mcp.example.com/github"),
    mcpserver.WithHeader("Authorization", "Bearer ${API_TOKEN}"),
    mcpserver.WithTimeout(30),
)

agent.AddMCPServer(remoteMCP)
```

#### Docker Servers

```go
dockerMCP, _ := mcpserver.Docker(
    mcpserver.WithName("custom-mcp"),
    mcpserver.WithImage("ghcr.io/org/custom-mcp:latest"),
    mcpserver.WithVolumeMount("/host/path", "/container/path", false),
    mcpserver.WithPortMapping(8080, 80, "tcp"),
)

agent.AddMCPServer(dockerMCP)
```

### Adding Sub-Agents

#### Inline Sub-Agents

```go
agent.AddSubAgent(subagent.Inline(
    subagent.WithName("code-analyzer"),
    subagent.WithInstructions("Analyze code quality"),
    subagent.WithMCPServer("github"),
    subagent.WithSkill(skill.Platform("static-analysis")),
))
```

#### Referenced Sub-Agents

```go
// Reference existing agent by ID
agent.AddSubAgent(subagent.Reference("agent-instance-id"))
```

### Environment Variables

#### Secret Variables

```go
apiKey, _ := environment.New(
    environment.WithName("API_KEY"),
    environment.WithSecret(true),
    environment.WithDescription("API key for external service"),
)

agent.AddEnvironmentVariable(apiKey)
```

#### Configuration with Defaults

```go
region, _ := environment.New(
    environment.WithName("AWS_REGION"),
    environment.WithDefaultValue("us-east-1"),
    environment.WithDescription("AWS deployment region"),
)

agent.AddEnvironmentVariable(region)
```

---

## Skill SDK

### Creating Skills

#### From Markdown File

```go
skill, err := skill.New(
    skill.WithName("coding-guidelines"),
    skill.WithDescription("Coding best practices"),
    skill.WithMarkdownFromFile("skills/coding.md"),
)
```

#### From Markdown String

```go
skill, err := skill.New(
    skill.WithName("security-checklist"),
    skill.WithDescription("Security review checklist"),
    skill.WithMarkdown("# Security Review\n\n- Check authentication\n- Validate inputs"),
)
```

**Required Options**:
- `WithName()` - Skill identifier
- `WithMarkdown()` or `WithMarkdownFromFile()` - Skill content

**Optional Options**:
- `WithDescription()` - Human-readable description

---

## Best Practices

### 1. File-Based Content

**✅ Recommended**: Load instructions and skills from files

```go
agent, _ := agent.New(ctx,
    agent.WithName("reviewer"),
    agent.WithInstructionsFromFile("instructions/reviewer.md"),
)

skill, _ := skill.New(
    skill.WithName("guidelines"),
    skill.WithMarkdownFromFile("skills/guidelines.md"),
)
```

**Why**:
- Version control friendly
- Easy to edit and review
- Separate content from code
- Supports Markdown editors

### 2. Descriptive Names

**✅ Recommended**: Use clear, descriptive names

```go
// Good
codeReviewAgent := agent.New(ctx, agent.WithName("code-reviewer"))
securityCheckTask := wf.HttpGet("security-check", endpoint)

// Avoid
agent1 := agent.New(ctx, agent.WithName("agent1"))
task := wf.HttpGet("task", endpoint)
```

### 3. Task Field References

**✅ Recommended**: Use direct field references for clarity

```go
// Good - clear origin
title := fetchTask.Field("title")

// Avoid - unclear origin
title := workflow.FieldRef("title")
```

### 4. Error Handling

**✅ Recommended**: Always check errors

```go
agent, err := agent.New(ctx, agent.WithName("my-agent"))
if err != nil {
    return fmt.Errorf("failed to create agent: %w", err)
}
```

### 5. Organize Resources

**✅ Recommended**: Structure your repository

```
my-repo/
├── main.go
├── instructions/
│   ├── code-reviewer.md
│   └── security-checker.md
├── skills/
│   ├── coding-guidelines.md
│   └── security-checklist.md
└── workflows/
    └── ci-pipeline.go
```

### 6. Use Context for Configuration

**✅ Recommended**: Store shared config in context

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Configuration
    apiBase := ctx.SetString("apiBase", "https://api.example.com")
    orgName := ctx.SetString("org", "my-org")
    
    // Use in resources
    wf, _ := workflow.New(ctx,
        workflow.WithOrg(orgName),
    )
    
    endpoint := apiBase.Concat("/users")
    wf.HttpGet("fetch", endpoint)
    
    return nil
})
```

### 7. Leverage Type Safety

**✅ Recommended**: Take advantage of compile-time checks

```go
// Compile-time error if fetchTask is wrong type
processTask := wf.SetVars("process",
    "title", fetchTask.Field("title"),  // Type-checked!
)
```

---

## Examples

The SDK includes 19 comprehensive examples in `sdk/go/examples/`:

### Agent Examples

1. **Basic Agent** - Simple agent with name and instructions
2. **Agent with Skills** - Platform, organization, and inline skills
3. **Agent with MCP Servers** - Full MCP configuration
4. **Agent with Sub-Agents** - Inline and referenced sub-agents
5. **Agent with Environment Variables** - Secrets and configs
6. **Agent with Instructions from Files** - ⭐ **Recommended pattern**

### Workflow Examples (Basic)

7. **Basic Workflow** - ⭐ **Start here** - Complete workflow example
8. **Workflow with Conditionals** - Switch tasks (✅ tested)
9. **Workflow with Loops** - ForEach tasks
10. **Workflow with Error Handling** - Try/Catch/Finally
11. **Workflow with Parallel Execution** - Fork tasks

### Workflow Examples (Advanced)

12. **Agent with Typed Context** - Typed context variables
13. **Workflow and Agent Shared Context** - Shared configuration
14. **Workflow with Runtime Secrets** - Runtime secret references
15. **Workflow Calling Simple Agent** - Basic agent call
16. **Workflow Calling Agent by Slug** - Reference by slug
17. **Workflow Agent with Runtime Secrets** - Agent calls with config
18. **Workflow Multi-Agent Orchestration** - ⭐ **Real-world CI/CD pipeline**
19. **Workflow Agent Execution Config** - Agent execution parameters

### Running Examples

```bash
# Navigate to examples
cd sdk/go/examples

# Run an example
go run 01_basic_agent.go

# Test an example
go test -v -run TestExample01
```

---

## Deployment

### Using the Stigmer CLI

```bash
# Apply resources from file
stigmer apply main.go

# Apply with organization context
stigmer apply main.go --org my-org --env production

# Dry run (validate only)
stigmer apply main.go --dry-run
```

### CI/CD Integration

```yaml
# .github/workflows/deploy.yml
name: Deploy Stigmer Resources

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Go
        uses: actions/setup-go@v4
        with:
          go-version: '1.21'
      
      - name: Install Stigmer CLI
        run: |
          curl -fsSL https://get.stigmer.ai/install.sh | sh
      
      - name: Deploy
        run: |
          stigmer apply main.go \
            --org ${{ vars.STIGMER_ORG }} \
            --env production
        env:
          STIGMER_TOKEN: ${{ secrets.STIGMER_TOKEN }}
```

---

## Troubleshooting

### Common Issues

#### "agent not registered with context"

**Problem**: Agent created without context

```go
// ❌ Wrong
agent, _ := agent.New(agent.WithName("my-agent"))
```

**Solution**: Pass context as first parameter

```go
// ✅ Correct
agent, _ := agent.New(ctx, agent.WithName("my-agent"))
```

#### "circular dependency detected"

**Problem**: Resources depend on each other in a cycle

**Solution**: Review your resource dependencies and break the cycle

```bash
stigmer apply main.go --dry-run  # Check dependencies
```

#### "validation failed: name must be lowercase"

**Problem**: Invalid resource name

```go
// ❌ Wrong
agent.WithName("My Agent")
```

**Solution**: Use lowercase alphanumeric + hyphens

```go
// ✅ Correct
agent.WithName("my-agent")
```

---

## API Reference

Full API documentation: [pkg.go.dev/github.com/stigmer/stigmer/sdk/go](https://pkg.go.dev/github.com/stigmer/stigmer/sdk/go)

### Package Index

- `stigmer` - Context and resource management
- `agent` - Agent builder and configuration
- `skill` - Skill definitions
- `workflow` - Workflow builder and tasks
- `mcpserver` - MCP server configurations
- `subagent` - Sub-agent definitions
- `environment` - Environment variable configuration

---

## Support

- **Documentation**: [docs.stigmer.ai](https://docs.stigmer.ai)
- **GitHub Issues**: [stigmer/stigmer](https://github.com/stigmer/stigmer/issues)
- **Discord**: [stigmer.ai/discord](https://stigmer.ai/discord)

---

## License

Apache 2.0 - see [LICENSE](../../../LICENSE) for details.

---

**Version**: 0.1.0  
**Last Updated**: 2026-01-22  
**Status**: Production Ready ✅
