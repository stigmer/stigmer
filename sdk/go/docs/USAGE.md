# Stigmer Go SDK - Usage Guide

**Version**: 0.2.0  
**Status**: Production Ready ✅

A comprehensive guide to building AI agents and workflows with the Stigmer Go SDK using struct-based args (Pulumi pattern).

> **Migration Notice**: Version 0.2.0+ uses struct-based args instead of functional options.  
> See [Migration Guide](migration-from-functional-options.md) for upgrading from v0.1.0.

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
    "os"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/skill"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Load skill content from file
        skillContent, _ := os.ReadFile("skills/coding.md")
        
        // Create a skill with struct-based args
        codingSkill, _ := skill.New("coding-guidelines", &skill.SkillArgs{
            MarkdownContent: string(skillContent),
            Description:     "Coding best practices",
        })
        
        // Load instructions from file
        instructions, _ := os.ReadFile("instructions/reviewer.md")
        
        // Create an agent with struct-based args
        codeReviewer, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
            Instructions: string(instructions),
            Description:  "AI code reviewer",
        })
        
        // Add skills using builder method
        codeReviewer.AddSkill(codingSkill)
        
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
        
        // Fetch data from API (convenience method)
        fetchTask := wf.HttpGet("fetch", "https://api.example.com/data", map[string]string{
            "Content-Type": "application/json",
        })
        
        // Process the response (struct-based args)
        wf.Set("process", &workflow.SetArgs{
            Variables: map[string]string{
                "title": fetchTask.Field("title").Expression(),  // Map values still need .Expression()
                "body":  fetchTask.Field("body").Expression(),   // (not a direct expression field)
            },
        })
        
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
agent, _ := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
})
// → Registered as "agent:my-agent"

// Workflow registers with context
wf, _ := workflow.New(ctx,
    workflow.WithNamespace("default"),
    workflow.WithName("my-workflow"),
    workflow.WithVersion("1.0.0"),
)
// → Registered as "workflow:my-workflow"

// Skills register when used inline
skill, _ := skill.New("my-skill", &skill.SkillArgs{
    MarkdownContent: "...",
})
// → Registered as "skill:my-skill" when added to agent
```

### Dependency Tracking

The SDK tracks dependencies automatically:

```go
// Create skill
codingSkill, _ := skill.New("coding", &skill.SkillArgs{
    MarkdownContent: "# Coding Standards\n...",
})

// Create agent
reviewer, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
})

// Add skill (dependency tracked automatically)
reviewer.AddSkill(codingSkill)
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

Two ways to create HTTP tasks: **convenience methods** (simple) or **struct-based args** (full control).

#### Convenience Methods (Recommended for Simple Cases)

```go
// GET Request
fetchTask := wf.HttpGet("fetch", "https://api.example.com/users", map[string]string{
    "Authorization": "Bearer ${API_TOKEN}",
    "Content-Type":  "application/json",
})

// POST Request
createTask := wf.HttpPost("create", "https://api.example.com/users",
    map[string]string{"Content-Type": "application/json"},
    map[string]interface{}{
        "name":  "John Doe",
        "email": "john@example.com",
    },
)

// PUT Request
updateTask := wf.HttpPut("update", "https://api.example.com/users/123",
    map[string]string{"Content-Type": "application/json"},
    userData,
)

// DELETE Request
deleteTask := wf.HttpDelete("delete", "https://api.example.com/users/123",
    map[string]string{"Authorization": "Bearer ${API_TOKEN}"},
)
```

#### Struct-Based Args (Full Control)

```go
// Full control with HttpCallArgs
task := wf.HttpCall("fetch", &workflow.HttpCallArgs{
    Method:  "GET",
    URI:     "https://api.example.com/users",
    Headers: map[string]string{
        "Authorization": "Bearer ${API_TOKEN}",
        "Content-Type":  "application/json",
    },
    QueryParams: map[string]string{
        "page":  "1",
        "limit": "10",
    },
    TimeoutSeconds: 30,
})
```

**HttpCallArgs Fields**:
- `Method` - HTTP method (GET, POST, PUT, PATCH, DELETE)
- `URI` - Request URI
- `Headers` - HTTP headers (map[string]string)
- `Body` - Request body (map[string]interface{})
- `QueryParams` - Query parameters (map[string]string)
- `TimeoutSeconds` - Request timeout (default: 30)

### SET Tasks (Variable Assignment)

Use struct-based args to set variables:

```go
// Set variables using SetArgs
processTask := wf.Set("process", &workflow.SetArgs{
    Variables: map[string]string{
        "userId":    fetchTask.Field("id").Expression(),
        "userName":  fetchTask.Field("name").Expression(),
        "timestamp": workflow.Now(),
        "status":    "success",
    },
})
```

### Task Field References

Reference task outputs to create dependencies:

```go
// Task produces outputs
fetchTask := wf.HttpGet("fetch", "https://api.example.com/data", nil)

// Reference task fields (creates implicit dependency)
processTask := wf.Set("process", &workflow.SetArgs{
    Variables: map[string]string{
        "title":  fetchTask.Field("title").Expression(),  // From fetchTask
        "body":   fetchTask.Field("body").Expression(),   // From fetchTask
        "status": "complete",                             // Static value
    },
})
```

**Key Points**:
- `task.Field("name")` creates a typed field reference
- Dependencies are tracked automatically
- No manual dependency wiring needed

#### Smart Expression Conversion (v0.2.1+)

**Expression fields automatically accept both strings and references** - no manual `.Expression()` calls needed!

```go
// ✅ NEW: Clean syntax (automatic conversion)
wf.ForEach("process", &workflow.ForArgs{
    In: fetchTask.Field("items"),  // TaskFieldRef - auto-converted!
})

wf.HttpGet("fetch",
    apiBase.Concat("/data"),  // StringRef - auto-converted!
    nil,
)

// ✅ STILL WORKS: Explicit conversion (backward compatible)
wf.ForEach("process", &workflow.ForArgs{
    In: fetchTask.Field("items").Expression(),  // Still valid
})

// ✅ ALWAYS WORKED: Literal strings
wf.ForEach("process", &workflow.ForArgs{
    In: "${.items}",  // String literal
})
```

**Fields with smart conversion**:
- `ForTaskConfig.In` - Loop input collection
- `HttpEndpoint.Uri` - HTTP request URI
- `AgentCallTaskConfig.Message` - Agent prompt/message
- `RaiseTaskConfig.Error` - Error type
- `RaiseTaskConfig.Message` - Error message

**How it works**: These fields are marked with `is_expression` proto option. The SDK generator creates them as `interface{}` and automatically converts TaskFieldRef/StringRef to expressions at runtime.

**Map/array string values**: Still need `.Expression()` for values inside maps or arrays:
```go
Body: map[string]interface{}{
    "userId": userTask.Field("id").Expression(),  // ✅ Still needed for map values
},
```

### Agent Call Tasks

Call AI agents from workflows using struct-based args:

```go
// Call agent with typed configuration
reviewTask := wf.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "code-reviewer",
    Message: "Review this code: ${.input.code}",  // ✅ Smart conversion - string or TaskFieldRef
    Env: map[string]string{
        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
    },
    Config: &types.AgentExecutionConfig{
        Model:       "claude-3-5-sonnet",
        Temperature: 0.7,
        Timeout:     300,
    },
})

// With TaskFieldRef (automatic conversion)
reviewTask := wf.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "code-reviewer",
    Message: fetchCode.Field("content"),  // ✅ No .Expression() needed!
    Config: &types.AgentExecutionConfig{
        Model:   "claude-3-5-sonnet",
        Timeout: 300,
    },
})
```

**AgentCallArgs Fields**:
- `Agent` - Agent slug or reference (required)
- `Message` - Message/prompt to agent (required, supports smart conversion)
- `Env` - Environment variables (map[string]string)
- `Config` - Agent execution config (*types.AgentExecutionConfig)

### WAIT Tasks

Pause workflow execution using struct-based args:

```go
// Wait for duration
wf.Wait("pause", &workflow.WaitArgs{
    Duration: "30s",
})

// Wait until timestamp
wf.Wait("schedule", &workflow.WaitArgs{
    Until: "2024-12-31T23:59:59Z",
})
```

### LISTEN Tasks

Wait for external events using struct-based args:

```go
listenTask := wf.Listen("wait-for-approval", &workflow.ListenArgs{
    SignalName:     "approval-signal",
    TimeoutSeconds: 3600, // 1 hour timeout
})
```

### RAISE Tasks

Emit events from workflow using struct-based args:

```go
wf.Raise("notify", &workflow.RaiseArgs{
    SignalName: "workflow-complete",
    Payload: map[string]interface{}{
        "status":   "success",
        "duration": "45s",
    },
})
```

---

## Advanced Features

### Conditional Logic (Switch)

Branch execution based on conditions using struct-based args:

```go
// Define tasks for different cases
successTask := wf.HttpPost("notify-success", successWebhook, nil, nil)
errorTask := wf.HttpPost("notify-error", errorWebhook, nil, nil)
defaultTask := wf.Set("unknown", &workflow.SetArgs{
    Variables: map[string]string{"message": "Unknown status"},
})

// Create switch task
switchTask := wf.Switch("check-status", &workflow.SwitchArgs{
    Cases: []*workflow.SwitchCase{
        {
            Condition: &workflow.Condition{
                Operator: "equals",
                Key:      "status",
                Value:    "success",
            },
            Tasks: []*workflow.Task{successTask},
        },
        {
            Condition: &workflow.Condition{
                Operator: "equals",
                Key:      "status",
                Value:    "error",
            },
            Tasks: []*workflow.Task{errorTask},
        },
    },
    Default: []*workflow.Task{defaultTask},
})
```

**Condition Operators**:
- `"equals"` - Equality check
- `"notEquals"` - Inequality check
- `"greaterThan"` - Greater than
- `"lessThan"` - Less than
- `"greaterOrEqual"` - Greater than or equal
- `"lessOrEqual"` - Less than or equal
- `"contains"` - String contains
- `"startsWith"` - String starts with
- `"endsWith"` - String ends with
- `"matches"` - Regex match

### Loops (ForEach)

Iterate over collections using struct-based args with the type-safe **LoopBody** helper.

#### Modern Pattern: Using LoopBody (Recommended) ⭐

The `LoopBody` helper provides type-safe access to loop variables without magic strings:

```go
// Fetch list of items
fetchTask := wf.HttpGet("fetch-users", usersEndpoint, nil)

// Create ForEach with LoopBody - clean and type-safe!
forEachTask := wf.ForEach("process-users", &workflow.ForArgs{
    In: fetchTask.Field("items"),  // ✅ No .Expression() needed!
    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.HttpPost("process", processEndpoint,
                nil,  // Headers
                map[string]interface{}{
                    "userId": item.Field("id"),    // ✅ Type-safe reference!
                    "name":   item.Field("name"),  // ✅ No magic strings!
                },
            ),
        }
    }),
})
```

**LoopBody Benefits**:
- ✅ **Type-safe**: Field references are validated at compile time
- ✅ **No magic strings**: `item.Field("id")` instead of `"${.item.id}"`
- ✅ **IDE support**: Autocomplete and refactoring work properly
- ✅ **Clear structure**: Loop body is a proper Go function

#### Custom Variable Names

The loop variable name defaults to "item" but can be customized with the `Each` field:

```go
wf.ForEach("process-users", &workflow.ForArgs{
    Each: "user",  // Custom variable name
    In: fetchTask.Field("users"),
    Do: workflow.LoopBody(func(user workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.Set("processUser", &workflow.SetArgs{
                Variables: map[string]string{
                    "userId": user.Field("id"),  // References ${.user.id}
                    "email":  user.Field("email"),
                },
            }),
        }
    }),
})
```

#### LoopVar Methods

The `LoopVar` provides two methods for referencing loop data:

```go
// .Field(name) - Access a field of the current item
item.Field("id")    // → "${.item.id}"
item.Field("name")  // → "${.item.name}"

// .Value() - Access the entire current item
item.Value()        // → "${.item}"
```

#### Nested Loops

LoopBody works seamlessly with nested loops:

```go
wf.ForEach("process-departments", &workflow.ForArgs{
    In: fetchDepts.Field("departments"),
    Do: workflow.LoopBody(func(dept workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.ForEach("process-employees", &workflow.ForArgs{
                In: dept.Field("employees"),
                Do: workflow.LoopBody(func(emp workflow.LoopVar) []*workflow.Task {
                    return []*workflow.Task{
                        wf.Set("processEmployee", &workflow.SetArgs{
                            Variables: map[string]string{
                                "deptId": dept.Field("id"),
                                "empId":  emp.Field("id"),
                            },
                        }),
                    }
                }),
            }),
        }
    }),
})
```

#### Legacy Pattern (Still Supported)

For backward compatibility, the old pattern still works:

```go
// Old pattern with magic strings
processTask := wf.HttpPost("process", processEndpoint,
    map[string]string{"Content-Type": "application/json"},
    map[string]interface{}{
        "userId": "${.item.id}",   // ❌ Magic string
        "name":   "${.item.name}", // ❌ Magic string
    },
)

forEachTask := wf.ForEach("process-users", &workflow.ForArgs{
    In:    fetchTask.Field("users").Expression(),  // Old style
    Do:    []*types.WorkflowTask{/* manual task definitions */},
})
```

**ForArgs Fields**:
- `In` - Collection to iterate over (required, supports smart conversion)
- `Each` - Loop variable name for current item (optional, default: "item")
- `Do` - Tasks to execute per iteration (required, use `LoopBody` helper)

### Error Handling (Try/Catch)

Handle errors gracefully using struct-based args:

```go
// Define tasks
riskyTask := wf.HttpPost("risky-operation", endpoint, nil, data)
timeoutHandler := wf.Set("handle-timeout", &workflow.SetArgs{
    Variables: map[string]string{
        "status": "timeout",
        "retry":  "true",
    },
})
errorHandler := wf.Set("handle-error", &workflow.SetArgs{
    Variables: map[string]string{
        "status": "error",
        "retry":  "false",
    },
})

// Create Try task
tryTask := wf.Try("safe-operation", &workflow.TryArgs{
    Tasks: []*workflow.Task{riskyTask},
    Catches: []*workflow.CatchBlock{
        {
            ErrorMatcher: &workflow.ErrorMatcher{
                Code: "TIMEOUT",
            },
            Tasks: []*workflow.Task{timeoutHandler},
        },
        {
            ErrorMatcher: &workflow.ErrorMatcher{
                MatchAny: true, // Catch all errors
            },
            Tasks: []*workflow.Task{errorHandler},
        },
    },
})
```

**ErrorMatcher Fields**:
- `Code` - Match specific error code (e.g., "TIMEOUT", "NOT_FOUND")
- `Type` - Match error type (e.g., "NetworkError", "ValidationError")
- `MatchAny` - Match any error (catch-all)

### Parallel Execution (Fork)

Run tasks concurrently using struct-based args:

```go
// Define tasks for each branch
task1 := wf.HttpGet("fetch1", endpoint1, nil)
task2 := wf.HttpGet("fetch2", endpoint2, nil)
task3 := wf.HttpGet("fetch3", endpoint3, nil)

// Create Fork task
forkTask := wf.Fork("parallel-fetch", &workflow.ForkArgs{
    Branches: []*workflow.ForkBranch{
        {Name: "branch1", Tasks: []*workflow.Task{task1}},
        {Name: "branch2", Tasks: []*workflow.Task{task2}},
        {Name: "branch3", Tasks: []*workflow.Task{task3}},
    },
})

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

Use struct-based args (Pulumi pattern) for agent creation:

```go
// Load instructions from file
instructions, _ := os.ReadFile("instructions/reviewer.md")

// Create agent with struct-based args
agent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: string(instructions),
    Description:  "AI code reviewer with security expertise",
    IconUrl:      "https://example.com/icon.png",
})
```

**AgentArgs Fields**:
- `Instructions` - Agent behavior definition (required, 10-10,000 chars)
- `Description` - Human-readable description (optional, max 500 chars)
- `IconUrl` - Display icon URL (optional)

**Complex Fields** (use builder methods):
- Skills - Use `agent.AddSkill()` or `agent.AddSkills()`
- MCP Servers - Use `agent.AddMCPServer()` or `agent.AddMCPServers()`
- Sub-Agents - Use `agent.AddSubAgent()` or `agent.AddSubAgents()`
- Environment Variables - Use `agent.AddEnvironmentVariable()` or `agent.AddEnvironmentVariables()`

### Adding Skills

#### Inline Skills (Defined in Repository)

```go
// Load skill content from file
skillContent, _ := os.ReadFile("skills/security.md")

// Create skill with struct-based args
securitySkill, _ := skill.New("security-guidelines", &skill.SkillArgs{
    MarkdownContent: string(skillContent),
    Description:     "Security review guidelines",
})

// Add to agent using builder method
agent.AddSkill(securitySkill)
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

#### Multiple Skills at Once

```go
agent.AddSkills(
    securitySkill,
    skill.Platform("coding-best-practices"),
    skill.Organization("my-org", "internal-standards"),
)
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

Use struct-based args (Pulumi pattern) for skill creation:

#### From Markdown File

```go
// Load skill content from file
content, _ := os.ReadFile("skills/coding.md")

// Create skill with struct-based args
skill, err := skill.New("coding-guidelines", &skill.SkillArgs{
    MarkdownContent: string(content),
    Description:     "Coding best practices",
})
```

#### From Markdown String

```go
skill, err := skill.New("security-checklist", &skill.SkillArgs{
    MarkdownContent: "# Security Review\n\n- Check authentication\n- Validate inputs",
    Description:     "Security review checklist",
})
```

**SkillArgs Fields**:
- `MarkdownContent` - Skill content (required, 10-50,000 chars)
- `Description` - Human-readable description (optional, max 500 chars)

---

## Best Practices

### 1. File-Based Content

**✅ Recommended**: Load instructions and skills from files

```go
// Load content from files
instructions, _ := os.ReadFile("instructions/reviewer.md")
skillContent, _ := os.ReadFile("skills/guidelines.md")

// Create resources with struct-based args
agent, _ := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: string(instructions),
})

skill, _ := skill.New("guidelines", &skill.SkillArgs{
    MarkdownContent: string(skillContent),
})
```

**Why**:
- Version control friendly
- Easy to edit and review
- Separate content from code
- Supports Markdown editors
- Clear what's loaded from where

### 2. Descriptive Names

**✅ Recommended**: Use clear, descriptive names

```go
// Good
codeReviewAgent, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "...",
})
securityCheckTask := wf.HttpGet("security-check", endpoint, nil)

// Avoid
agent1, _ := agent.New(ctx, "agent1", &agent.AgentArgs{
    Instructions: "...",
})
task := wf.HttpGet("task", endpoint, nil)
```

### 3. Task Field References

**✅ Recommended**: Use direct field references for clarity

```go
// Good - clear origin, use .Expression() for workflow engine
title := fetchTask.Field("title").Expression()

// Avoid - unclear origin
title := "${.title}"
```

### 4. Error Handling

**✅ Recommended**: Always check errors

```go
agent, err := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
})
if err != nil {
    return fmt.Errorf("failed to create agent: %w", err)
}
```

### 5. Use Struct-Based Args for Complex Configuration

**✅ Recommended**: Use struct args for full control

```go
// Full control with HttpCallArgs
task := wf.HttpCall("fetch", &workflow.HttpCallArgs{
    Method:  "GET",
    URI:     "https://api.example.com/data",
    Headers: map[string]string{
        "Authorization": "Bearer ${.token}",
    },
    TimeoutSeconds: 30,
})

// Or use convenience methods for simple cases
task := wf.HttpGet("fetch", "https://api.example.com/data", map[string]string{
    "Authorization": "Bearer ${.token}",
})
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
agent, _ := agent.New("my-agent", &agent.AgentArgs{
    Instructions: "...",
})
```

**Solution**: Pass context as first parameter

```go
// ✅ Correct
agent, _ := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
})
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
agent, _ := agent.New(ctx, "My Agent", &agent.AgentArgs{
    Instructions: "...",
})
```

**Solution**: Use lowercase alphanumeric + hyphens

```go
// ✅ Correct
agent, _ := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
})
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

**Version**: 0.2.0  
**Last Updated**: 2026-01-24  
**Status**: Production Ready ✅  
**Migration**: See [Migration Guide](migration-from-functional-options.md) for upgrading from v0.1.0
