# Workflow SDK: Fluent API Guide

**Last Updated**: 2026-01-22  
**Status**: Production Ready  
**SDK Version**: Go SDK v1.x+

---

## Overview

The Stigmer Go SDK provides a Pulumi-style fluent API for building workflows. This guide shows you how to use the functional options pattern and workflow builder to create clean, type-safe workflows.

**Key Benefits**:
- **70% less code** for common patterns vs raw struct initialization
- **Type-safe** with compile-time error checking
- **IDE autocomplete** for all options
- **Self-documenting** - option names explain their purpose
- **Clear dependencies** - TaskFieldRef shows where data comes from

---

## Quick Start

### Basic Workflow

```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        // Create workflow with builder pattern
        wf, err := workflow.New(ctx,
            workflow.WithNamespace("data-processing"),
            workflow.WithName("daily-sync"),
            workflow.WithVersion("1.0.0"),
            workflow.WithDescription("Sync data from external API"),
        )
        if err != nil {
            return err
        }
        
        // Add tasks using fluent methods
        wf.HttpGet("fetch", "https://api.example.com/data")
        
        return nil
    })
}
```

### HTTP Task with Options

```go
// Clean, fluent API with functional options
fetchTask := wf.HttpGet("fetch", "https://api.example.com/posts/1",
    workflow.Header("Content-Type", "application/json"),
    workflow.Header("Authorization", "Bearer ${TOKEN}"),
    workflow.Timeout(30),
)
```

### Dependency Tracking

```go
// Fetch data
fetchTask := wf.HttpGet("fetch", apiURL)

// Process data with clear dependencies
processTask := wf.Set("process",
    workflow.SetVar("title", fetchTask.Field("title")),  // Clear origin!
    workflow.SetVar("body", fetchTask.Field("body")),
    workflow.SetVar("status", "processed"),
)
// Dependencies automatically tracked: processTask → fetchTask
```

---

## Architecture

The SDK uses a **hybrid architecture** (inspired by Pulumi):

```
┌─────────────────────────────────────────────────────────────┐
│                    USER-FACING API                          │
│  wf.HttpGet(), wf.Set(), wf.CallAgent()                     │
│  Fluent, type-safe, IDE autocomplete                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│               FUNCTIONAL OPTIONS LAYER                       │
│  Header(), Body(), Timeout(), SetVar(), etc.                │
│  (Hand-crafted for ergonomics)                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│               GENERATED CODE LAYER                          │
│  SetTask(), HttpCallTask(), proto conversion                │
│  (Auto-generated from schemas)                              │
└─────────────────────────────────────────────────────────────┘
```

**Why This Works**:
- **Generated layer** handles mechanical work (structs, proto conversion)
- **Options layer** handles ergonomics (how you want to use it)
- **Best of both worlds**: consistency + flexibility

---

## Workflow Builder

### Creating Workflows

**Required Options**:
- `WithNamespace(namespace)` - Workflow namespace
- `WithName(name)` - Workflow name

**Optional Options**:
- `WithVersion(version)` - Semver version (defaults to "0.1.0")
- `WithDescription(description)` - Human-readable description
- `WithOrg(org)` - Organization identifier

**Example**:
```go
wf, err := workflow.New(ctx,
    workflow.WithNamespace("data-processing"),
    workflow.WithName("daily-sync"),
    workflow.WithVersion("1.0.0"),
    workflow.WithDescription("Sync data from external API"),
)
```

### Adding Tasks

**Two Ways to Add Tasks**:

1. **During creation** (using `WithTask` / `WithTasks`):
```go
wf, err := workflow.New(ctx,
    workflow.WithNamespace("ns"),
    workflow.WithName("wf"),
    workflow.WithTasks(
        workflow.HttpGet("fetch", url),
        workflow.Set("init", workflow.SetVar("x", "1")),
    ),
)
```

2. **After creation** (using workflow builder methods):
```go
wf, err := workflow.New(ctx, ...)

// Fluent task builders
wf.HttpGet("fetch", url)
wf.Set("init", workflow.SetVar("x", "1"))
wf.CallAgent("review", ...)
```

**Recommendation**: Use workflow builder methods (more fluent, Pulumi-style).

---

## Task Types & Options

### HTTP Tasks

**Workflow Builder Methods**:
- `wf.HttpGet(name, uri, opts...)` - HTTP GET
- `wf.HttpPost(name, uri, opts...)` - HTTP POST
- `wf.HttpPut(name, uri, opts...)` - HTTP PUT
- `wf.HttpPatch(name, uri, opts...)` - HTTP PATCH
- `wf.HttpDelete(name, uri, opts...)` - HTTP DELETE

**Available Options**:
- `Header(key, value)` - Add HTTP header
- `Headers(map)` - Add multiple headers
- `Body(map)` - Set request body
- `Timeout(seconds)` - Set timeout

**Examples**:

```go
// Simple GET
wf.HttpGet("fetch", "https://api.example.com/data")

// GET with headers and timeout
wf.HttpGet("fetch", "https://api.example.com/data",
    workflow.Header("Content-Type", "application/json"),
    workflow.Header("Authorization", "Bearer token"),
    workflow.Timeout(30),
)

// POST with body
wf.HttpPost("create", "https://api.example.com/users",
    workflow.Body(map[string]any{
        "name":  "John Doe",
        "email": "john@example.com",
    }),
    workflow.Header("Content-Type", "application/json"),
)

// Dynamic values from expressions
wf.HttpGet("fetch", "${.apiBase}/users/${.userId}",
    workflow.Header("Authorization", "Bearer ${.token}"),
)
```

### SET Tasks

**Workflow Builder Method**:
- `wf.Set(name, opts...)` - Set variables

**Available Options**:
- `SetVar(key, value)` - Set single variable
- `SetVars(map)` - Set multiple variables

**Examples**:

```go
// Set single variable
wf.Set("init",
    workflow.SetVar("counter", "0"),
)

// Set multiple variables
wf.Set("init",
    workflow.SetVar("x", "1"),
    workflow.SetVar("y", "2"),
    workflow.SetVar("z", "3"),
)

// Set from map
wf.Set("init",
    workflow.SetVars(map[string]interface{}{
        "x": "1",
        "y": "2",
        "z": "3",
    }),
)

// Set from task output (dependency tracking)
fetchTask := wf.HttpGet("fetch", apiURL)
wf.Set("process",
    workflow.SetVar("title", fetchTask.Field("title")),
    workflow.SetVar("body", fetchTask.Field("body")),
)
```

**Value Types Supported**:
- Strings: `"hello"`
- Integers: `42`
- Floats: `3.14`
- Booleans: `true`
- Expressions: `"${.x + .y}"`
- TaskFieldRef: `fetchTask.Field("data")`

### Agent Call Tasks

**Workflow Builder Method**:
- `wf.CallAgent(name, opts...)` - Call agent

**Available Options**:
- `AgentOption(ref)` - Set agent via AgentRef
- `AgentSlug(slug)` - Set agent by slug
- `Message(message)` - Set agent message/instructions
- `WithAgentEnv(map)` - Set environment variables
- `AgentEnvVar(key, value)` - Add single env var
- `Model(model)` - Set AI model
- `Temperature(temp)` - Set AI temperature
- `MaxTokens(tokens)` - Set max tokens

**Examples**:

```go
// Simple agent call
wf.CallAgent("review",
    workflow.AgentSlug("code-reviewer"),
    workflow.Message("Review this code"),
)

// Agent with config
wf.CallAgent("analyze",
    workflow.AgentSlug("data-analyst"),
    workflow.Message("Analyze: ${.input.text}"),
    workflow.Model("gpt-4"),
    workflow.Temperature(0.7),
    workflow.MaxTokens(2000),
)

// Agent with environment
wf.CallAgent("deploy",
    workflow.AgentSlug("deployer"),
    workflow.Message("Deploy to ${.env}"),
    workflow.WithAgentEnv(map[string]string{
        "API_KEY": "${.secrets.API_KEY}",
        "REGION":  "us-west-2",
    }),
)

// Using AgentRef (type-safe)
reviewer := workflow.AgentBySlug("code-reviewer")
wf.CallAgent("review",
    workflow.AgentOption(reviewer),
    workflow.Message("Review PR"),
)
```

### gRPC Call Tasks

**Standalone Constructor**:
- `workflow.GrpcCall(name, opts...)` - gRPC call

**Available Options**:
- `Service(service)` - Set gRPC service
- `GrpcMethod(method)` - Set gRPC method
- `GrpcBody(body)` - Set request body

**Example**:

```go
grpcTask := workflow.GrpcCall("callService",
    workflow.Service("userservice.UserService"),
    workflow.GrpcMethod("GetUser"),
    workflow.GrpcBody(map[string]interface{}{
        "id": "${.userId}",
    }),
)
wf.AddTask(grpcTask)
```

### Wait Tasks

**Standalone Constructor**:
- `workflow.Wait(name, opts...)` - Pause execution

**Available Options**:
- `Duration(duration)` - Wait duration

**Example**:

```go
waitTask := workflow.Wait("pause",
    workflow.Duration("5s"),  // Supports: "5s", "1m", "1h", "1d"
)
wf.AddTask(waitTask)
```

### Switch Tasks - Conditional Logic

**Workflow Builder Method**:
- `wf.Switch(name, opts...)` - Conditional branching

**Available Options**:
- `SwitchOn(condition)` - Set switch condition
- `Case(matcher, target)` - Add conditional case
- `DefaultCase(target)` - Set default branch

**Condition Matchers**:
- `Equals(value)` - Equality check
- `GreaterThan(value)` - Greater than check
- `LessThan(value)` - Less than check
- `CustomCondition(expr)` - Custom expression

**Examples**:

```go
// Simple conditional routing
checkTask := wf.HttpGet("check", endpoint)

switchTask := wf.Switch("route",
    workflow.SwitchOn(checkTask.Field("statusCode")),
    workflow.Case(workflow.Equals(200), "success"),
    workflow.Case(workflow.Equals(404), "notFound"),
    workflow.DefaultCase("error"),
)
```

### ForEach Tasks - Iteration

**Workflow Builder Method**:
- `wf.ForEach(name, opts...)` - Loop over collection

**Available Options**:
- `IterateOver(collection)` - Set collection to iterate
- `WithLoopBody(builder)` - Functional loop body
- `DoTasks(tasks)` - Set tasks (low-level)

**Loop Variable**:
- `LoopVar` - Type-safe loop variable
- `item.Field(name)` - Access item fields
- `item.Value()` - Get entire item

**Examples**:

```go
// Functional loop body
fetchTask := wf.HttpGet("fetch", apiBase.Concat("/items"))

loopTask := wf.ForEach("processEachItem",
    workflow.IterateOver(fetchTask.Field("items")),
    workflow.WithLoopBody(func(item workflow.LoopVar) *workflow.Task {
        return wf.HttpPost("processItem",
            apiBase.Concat("/process"),
            workflow.Body(map[string]interface{}{
                "itemId": item.Field("id"),
                "data":   item.Field("data"),
            }),
        )
    }),
)
```

### Try/Catch Tasks - Error Handling

**Workflow Builder Method**:
- `wf.Try(name, opts...)` - Try/catch error handling

**Available Options**:
- `TryBlock(builder)` - Functional try block
- `CatchBlock(builder)` - Functional catch block
- `CatchErrors(types, as, builder)` - Type-specific catch
- `FinallyBlock(builder)` - Cleanup block
- `TryTasks(tasks)` - Set tasks (low-level)
- `Catch(map)` - Add catch (low-level)

**Error Reference**:
- `ErrorRef` - Type-safe error access
- `err.Message()` - Error message
- `err.Type()` - Error type
- `err.Timestamp()` - When error occurred
- `err.StackTrace()` - Stack trace
- `err.Field(name)` - Custom error fields

**Examples**:

```go
// Try/catch with functional builders
tryTask := wf.Try("attemptAPICall",
    workflow.TryBlock(func() *workflow.Task {
        return wf.HttpGet("callAPI", endpoint, workflow.Timeout(30))
    }),
    workflow.CatchBlock(func(err workflow.ErrorRef) *workflow.Task {
        return wf.Set("handleError",
            workflow.SetVar("error", err.Message()),
            workflow.SetVar("timestamp", err.Timestamp()),
        )
    }),
    workflow.FinallyBlock(func() *workflow.Task {
        return wf.Set("cleanup",
            workflow.SetVar("status", "attempted"),
        )
    }),
)

// Catch specific error types
tryTask := wf.Try("attempt",
    workflow.TryBlock(func() *workflow.Task {
        return wf.HttpGet("call", endpoint)
    }),
    workflow.CatchErrors([]string{"NetworkError", "TimeoutError"}, "netErr",
        func(err workflow.ErrorRef) *workflow.Task {
            return wf.Set("handleNetworkError",
                workflow.SetVar("error", err.Message()),
            )
        },
    ),
)
```

### Fork Tasks - Parallel Execution

**Workflow Builder Method**:
- `wf.Fork(name, opts...)` - Parallel branches

**Available Options**:
- `ParallelBranches(branches...)` - Define branches
- `BranchBuilder(name, builder)` - Functional branch
- `WaitForAll()` - Wait for all branches
- `WaitForAny()` - Wait for any branch
- `WaitForCount(n)` - Wait for N branches
- `Branch(map)` - Add branch (low-level)

**Branch Result**:
- `task.Branch(name)` - Access branch result
- `branch.Field(name)` - Access branch field
- `branch.Value()` - Get entire result

**Examples**:

```go
// Parallel API calls
forkTask := wf.Fork("fetchAllData",
    workflow.ParallelBranches(
        workflow.BranchBuilder("fetchUsers", func() *workflow.Task {
            return wf.HttpGet("getUsers", usersEndpoint)
        }),
        workflow.BranchBuilder("fetchProducts", func() *workflow.Task {
            return wf.HttpGet("getProducts", productsEndpoint)
        }),
        workflow.BranchBuilder("fetchOrders", func() *workflow.Task {
            return wf.HttpGet("getOrders", ordersEndpoint)
        }),
    ),
    workflow.WaitForAll(),
)

// Merge results from all branches
wf.Set("mergeResults",
    workflow.SetVar("users", forkTask.Branch("fetchUsers").Field("data")),
    workflow.SetVar("products", forkTask.Branch("fetchProducts").Field("data")),
    workflow.SetVar("orders", forkTask.Branch("fetchOrders").Field("data")),
)
```

### Other Task Types

See full API reference for:
- **Listen Tasks**: `workflow.Listen(name, workflow.Event(...))`
- **Call Activity Tasks**: `workflow.CallActivity(name, workflow.Activity(...), workflow.ActivityInput(...))`
- **Raise Tasks**: `workflow.Raise(name, workflow.ErrorType(...), workflow.ErrorMessage(...))`
- **Run Tasks**: `workflow.Run(name, workflow.SubWorkflow(...), workflow.WorkflowInput(...))`

---

## TaskFieldRef: Clear Dependencies

### What is TaskFieldRef?

`TaskFieldRef` provides type-safe references to task output fields, making dependencies explicit and clear.

**Problem it solves**:
```go
// ❌ Old way - where does "title" come from?
workflow.SetVar("title", workflow.FieldRef("title"))

// ✅ New way - clear origin!
workflow.SetVar("title", fetchTask.Field("title"))
```

### Creating Field References

**Syntax**: `task.Field(fieldName)`

```go
// Create HTTP task
fetchTask := wf.HttpGet("fetch", "https://api.example.com/post/1")

// Reference output fields
title := fetchTask.Field("title")
body := fetchTask.Field("body")
author := fetchTask.Field("author")

// Use in other tasks
wf.Set("process",
    workflow.SetVar("postTitle", title),
    workflow.SetVar("postBody", body),
    workflow.SetVar("postAuthor", author),
)
```

### Automatic Dependency Tracking

When you use `TaskFieldRef`, dependencies are **automatically tracked**:

```go
fetchTask := wf.HttpGet("fetch", apiURL)
processTask := wf.Set("process",
    workflow.SetVar("data", fetchTask.Field("result")),
)
// Dependencies: processTask → fetchTask (automatic!)
```

### Auto-Export Behavior

Calling `.Field()` **automatically exports** the task output:

```go
fetchTask := wf.HttpGet("fetch", endpoint)
title := fetchTask.Field("title")
// fetchTask is now auto-exported (ExportAs = "${.}")
```

**No need to manually call** `.ExportAll()` when using `.Field()`!

### Nested Field Access

Access nested fields using dot notation:

```go
fetchTask := wf.HttpGet("fetch", apiURL)

// Access nested fields
userName := fetchTask.Field("user.name")
userEmail := fetchTask.Field("user.email")
addressCity := fetchTask.Field("user.address.city")
```

### JQ Expression Format

Under the hood, `TaskFieldRef` generates JQ expressions:

```go
fetchTask.Field("title")
// Generates: ${ $context["fetch"].title }

fetchTask.Field("user.name")
// Generates: ${ $context["fetch"].user.name }
```

**Benefit**: Works with task names containing hyphens or special characters.

---

## Expression Helpers

The SDK provides 20+ helper functions for building dynamic expressions.

### String Interpolation

**Concatenate Multiple Values**:
```go
// Interpolate any values
workflow.Interpolate("Hello ", userName, " from ", location)

// Concat is an alias
workflow.Concat(apiBase, "/users/", userId, "/profile")

// Use in HTTP calls
wf.HttpGet("fetch",
    workflow.Concat(apiBase, "/repos/", repoName, "/pulls/", prNumber),
)

// Use in headers
workflow.Header("Authorization",
    workflow.Concat("Bearer ", workflow.RuntimeSecret("API_TOKEN")),
)
```

### Runtime Values

**Runtime Secrets** (resolved JIT, never in history):
```go
// Reference secrets at runtime
workflow.RuntimeSecret("API_TOKEN")        // ${.secrets.API_TOKEN}
workflow.RuntimeSecret("DATABASE_PASSWORD")

// Use in HTTP headers
wf.HttpPost("call", endpoint,
    workflow.Header("Authorization",
        workflow.Concat("Bearer ", workflow.RuntimeSecret("OPENAI_KEY")),
    ),
)
```

**Runtime Environment Variables**:
```go
// Reference env vars at runtime
workflow.RuntimeEnv("DEPLOY_ENV")      // ${.env.DEPLOY_ENV}
workflow.RuntimeEnv("PR_NUMBER")

// Dynamic endpoint based on environment
wf.HttpGet("fetch",
    workflow.Concat("https://api-", workflow.RuntimeEnv("ENVIRONMENT"), ".example.com/data"),
)
```

**Runtime Configuration**:
```go
// Reference runtime config
workflow.RuntimeConfig("timeout")      // ${.config.timeout}
workflow.RuntimeConfig("max_retries")
```

### Built-in Functions

```go
// Timestamp
workflow.Now()                         // Current timestamp

// UUID
workflow.UUID()                        // Generate UUID

// JSON Path queries
workflow.JSONPath("$.users[0].name")
workflow.JSONPath("$.data.items[*].id")

// Custom expressions
workflow.Expr("${.status == 'active' && .count > 10}")
```

### Type Conversions

```go
// Convert types in expressions
workflow.ToString(statusCode)      // Convert to string
workflow.ToInt(count)             // Convert to integer
workflow.ToFloat(price)           // Convert to float
workflow.ToBool(isActive)         // Convert to boolean

// Example usage
wf.Set("convert",
    workflow.SetVar("countStr", workflow.ToString(fetchTask.Field("count"))),
    workflow.SetVar("priceNum", workflow.ToFloat(fetchTask.Field("price"))),
)
```

### Conditional Expressions

```go
// If-then-else
workflow.IfThenElse("${.status == 200}", "success", "error")

// Example usage
wf.Set("result",
    workflow.SetVar("outcome",
        workflow.IfThenElse(
            checkTask.Field("statusCode"),
            "success",
            "failure",
        ),
    ),
)
```

### Collection Helpers

```go
// Length
workflow.Length(items)                 // ${length(.items)}

// Contains
workflow.Contains(tags, "production")  // ${contains(.tags, 'production')}

// Join
workflow.Join(tags, ", ")             // ${join(.tags, ', ')}

// Example usage
wf.Set("info",
    workflow.SetVar("itemCount", workflow.Length(fetchTask.Field("items"))),
    workflow.SetVar("isProd", workflow.Contains(fetchTask.Field("tags"), "production")),
    workflow.SetVar("tagList", workflow.Join(fetchTask.Field("tags"), ", ")),
)
```

### Math Operations

```go
// Math expressions
workflow.Add(count, 1)                 // ${.count + 1}
workflow.Subtract(total, discount)     // ${.total - .discount}
workflow.Multiply(price, quantity)     // ${.price * .quantity}
workflow.Divide(total, count)          // ${.total / .count}

// Multiple values
workflow.Add(a, b, c, d)              // ${.a + .b + .c + .d}
workflow.Multiply(x, y, z)            // ${.x * .y * .z}

// Example usage
wf.Set("calculations",
    workflow.SetVar("total",
        workflow.Multiply(
            fetchTask.Field("price"),
            fetchTask.Field("quantity"),
        ),
    ),
    workflow.SetVar("average",
        workflow.Divide(
            fetchTask.Field("sum"),
            fetchTask.Field("count"),
        ),
    ),
)
```

---

## Advanced Patterns

### Chaining Tasks

```go
// Fetch data
fetchTask := wf.HttpGet("fetch", "${.apiBase}/posts/1")

// Process data (depends on fetch)
processTask := wf.Set("process",
    workflow.SetVar("title", fetchTask.Field("title")),
    workflow.SetVar("cleanBody", "${.trim(.body)}"),
)

// Create summary (depends on process)
summarizeTask := wf.CallAgent("summarize",
    workflow.AgentSlug("summarizer"),
    workflow.Message("Summarize: ${.title}"),
)

// Dependencies: summarizeTask → processTask → fetchTask
```

### Explicit Dependencies

Use `.DependsOn()` when side effects matter:

```go
// Cleanup task doesn't use processTask output, but must run after it
cleanupTask := wf.Set("cleanup",
    workflow.SetVar("status", "cleaned"),
)
cleanupTask.DependsOn(processTask)
```

### Conditional Execution

```go
// Create tasks
successTask := wf.Set("success", workflow.SetVar("result", "ok"))
failureTask := wf.Set("failure", workflow.SetVar("result", "error"))

// Switch based on condition
switchTask := workflow.Switch("route",
    workflow.Case(map[string]interface{}{
        "condition": "${.status == 'ok'}",
        "then":      "success",
    }),
    workflow.Case(map[string]interface{}{
        "condition": "${.status == 'error'}",
        "then":      "failure",
    }),
)
wf.AddTask(switchTask)
```

### Error Handling

```go
// Import error matcher
import "github.com/stigmer/stigmer/sdk/go/workflow"

// Create tasks to try
riskyTask := wf.HttpGet("fetch", "${.unstableApi}/data")

// Handle errors
tryTask := workflow.Try("attempt",
    workflow.WithTry(riskyTask),
    workflow.WithCatchTyped(
        workflow.CatchHTTPErrors(),
        "httpErr",
        wf.Set("handleError", workflow.SetVar("handled", "true")),
    ),
)
wf.AddTask(tryTask)
```

---

## Best Practices

### 1. Use Workflow Builder Methods

**Recommended** (fluent, Pulumi-style):
```go
wf.HttpGet("fetch", url)
wf.Set("init", workflow.SetVar("x", "1"))
wf.CallAgent("review", ...)
```

**Not Recommended** (verbose):
```go
task := workflow.HttpGet("fetch", url)
wf.AddTask(task)
```

### 2. TaskFieldRef for Dependencies

**Recommended** (clear origin):
```go
title := fetchTask.Field("title")
wf.Set("process", workflow.SetVar("postTitle", title))
```

**Not Recommended** (unclear origin):
```go
wf.Set("process", workflow.SetVar("postTitle", "${.title}"))
```

### 3. Named Functional Options

**Recommended** (self-documenting):
```go
wf.HttpGet("fetch", url,
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

**Not Recommended** (magic values):
```go
task := &Task{
    Config: &HttpCallTaskConfig{
        Headers: map[string]string{"Content-Type": "application/json"},
        TimeoutSeconds: 30,
    },
}
```

### 4. One Task Per Line

**Recommended** (readable):
```go
fetchTask := wf.HttpGet("fetch", url)
processTask := wf.Set("process", workflow.SetVar("data", fetchTask.Field("result")))
sendTask := wf.HttpPost("send", notifyUrl, workflow.Body(data))
```

**Not Recommended** (chained confusion):
```go
wf.HttpGet("fetch", url).HttpPost("send", notifyUrl)  // Doesn't work this way!
```

### 5. Meaningful Task Names

**Recommended**:
```go
wf.HttpGet("fetchUserProfile", userApiURL)
wf.HttpGet("fetchUserOrders", ordersApiURL)
wf.Set("mergeUserData", ...)
```

**Not Recommended**:
```go
wf.HttpGet("task1", userApiURL)
wf.HttpGet("task2", ordersApiURL)
wf.Set("task3", ...)
```

---

## Migration Guide

### From Raw Structs

**Before**:
```go
task := &Task{
    Name: "fetch",
    Kind: TaskKindHttpCall,
    Config: &HttpCallTaskConfig{
        Method: "GET",
        URI:    "https://api.example.com/data",
        Headers: map[string]string{
            "Content-Type": "application/json",
        },
        TimeoutSeconds: 30,
    },
}
workflow.Tasks = append(workflow.Tasks, task)
```

**After**:
```go
wf.HttpGet("fetch", "https://api.example.com/data",
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

**Benefits**:
- 70% less code
- Type-safe with IDE autocomplete
- Self-documenting
- Compile-time validation

### Migration Strategy

**Recommended Approach**:
1. **New workflows**: Use new API exclusively
2. **Existing workflows**: Continue working (no breaking changes)
3. **Refactor on edit**: Convert to new API when touching code

**No Rush**: Both styles work. Migrate gradually at your own pace.

---

## Troubleshooting

### Issue: "Cannot find workflow.HttpGet"

**Problem**: Old import or wrong package

**Solution**:
```go
import "github.com/stigmer/stigmer/sdk/go/workflow"

// Use workflow. prefix
wf.HttpGet(...)  // ✅ Correct
HttpGet(...)     // ❌ Wrong
```

### Issue: "Type mismatch for SetVar"

**Problem**: Using wrong type

**Solution**: Values are coerced to strings automatically
```go
workflow.SetVar("count", 42)        // ✅ Correct (int → string)
workflow.SetVar("name", "John")     // ✅ Correct (string)
workflow.SetVar("ref", task.Field("data"))  // ✅ Correct (TaskFieldRef)
```

### Issue: "Field() doesn't work"

**Problem**: Calling Field() on wrong type

**Solution**: Only works on `*Task` returned by workflow builders
```go
task := wf.HttpGet("fetch", url)    // Returns *Task
ref := task.Field("title")          // ✅ Works

task := workflow.Set("init", ...)   // Returns *Task
ref := task.Field("x")              // ✅ Works
```

### Issue: "Dependencies not tracked"

**Problem**: Using string expressions instead of TaskFieldRef

**Solution**: Use `.Field()` for automatic dependency tracking
```go
// ❌ No dependency tracking
wf.Set("process", workflow.SetVar("data", "${.result}"))

// ✅ Automatic dependency tracking
fetchTask := wf.HttpGet("fetch", url)
wf.Set("process", workflow.SetVar("data", fetchTask.Field("result")))
```

---

## Related Documentation

- **SDK Overview**: `docs/sdk/README.md`
- **Code Generator Architecture**: `_projects/2026-01/20260122.01.sdk-code-generators-go/`
- **API Reference**: `sdk/go/workflow/` (generated from proto schemas)
- **ADR: SDK Code Generators**: `docs/adr/20260118-181912-sdk-code-generators.md`

---

## Changelog

- **2026-01-22**: Added advanced workflow APIs (Switch, ForEach, Try/Catch, Fork) and expression helpers
- **2026-01-22**: Initial version - Fluent API with functional options pattern
- See `_changelog/2026-01/` for detailed implementation history

---

**Questions?** Check the checkpoint documentation or browse examples in `sdk/go/examples/`.
