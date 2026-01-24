# Fix SDK Templates to Use New Options-Based API

**Date**: 2026-01-24  
**Category**: SDK / Templates  
**Type**: Fix  
**Scope**: User-Facing

---

## Problem

After implementing the new options-based API for the SDK (AgentArgs, WithX() options for workflows, etc.), the SDK templates in `sdk/go/templates/templates.go` were still using the deprecated old API patterns. This caused:

1. **Template compilation failures** - All 3 templates failed to compile with the new SDK
2. **Broken user experience** - `stigmer init` would generate code that doesn't compile
3. **API confusion** - Templates showed old patterns instead of new best practices

Test failures:
```
TestTemplatesCompile/BasicAgent - FAIL
TestTemplatesCompile/BasicWorkflow - FAIL  
TestTemplatesCompile/AgentAndWorkflow - FAIL
```

Errors included:
- `undefined: agent.WithName`
- `undefined: agent.WithInstructions`
- `undefined: workflow.Header`
- `undefined: workflow.Timeout`
- `wf.SetVars undefined`

---

## Solution

Updated **all 3 SDK templates** to use the new options-based API:

### 1. BasicAgent Template

**Before** (Old API - DEPRECATED):
```go
agent.New(ctx,
    agent.WithName("joke-buddy"),
    agent.WithInstructions("..."),
    agent.WithDescription("..."),
)
```

**After** (New API - Args Pattern):
```go
agent.New(ctx, "joke-buddy", &agent.AgentArgs{
    Instructions: "...",
    Description:  "...",
})
```

**Pattern**: Agent name as positional parameter, configuration in `AgentArgs` struct

---

### 2. BasicWorkflow Template

**Before** (Old API - DEPRECATED):
```go
wf.HttpGet("fetchData", endpoint,
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)

wf.SetVars("processResponse",
    "postTitle", fetchTask.Field("title"),
    "postBody", fetchTask.Field("body"),
)
```

**After** (New API - Direct Args):
```go
wf.HttpGet("fetchData", endpoint.Expression(), map[string]string{
    "Content-Type": "application/json",
})

wf.Set("processResponse", &workflow.SetArgs{
    Variables: map[string]string{
        "postTitle": fetchTask.Field("title").Expression(),
        "postBody":  fetchTask.Field("body").Expression(),
    },
})
```

**Changes**:
- `HttpGet()`: Headers as `map[string]string` (no `workflow.Header()` wrapper needed)
- `endpoint.Expression()`: Explicit expression rendering
- `Set()` replaces `SetVars()`: Configuration in `SetArgs` struct
- `Field().Expression()`: Explicit expression calls

---

### 3. AgentAndWorkflow Template

**Before** (Old API - DEPRECATED):
```go
reviewer, err := agent.New(ctx,
    agent.WithName("pr-reviewer"),
    agent.WithDescription("..."),
    agent.WithInstructions("..."),
)

fetchPR := pipeline.HttpGet("fetch-pr", url,
    workflow.Header("Accept", "application/vnd.github.v3+json"),
    workflow.Header("User-Agent", "Stigmer-Demo"),
)

analyze := pipeline.CallAgent("analyze-pr",
    workflow.AgentOption(workflow.Agent(reviewer)),
    workflow.Message("..."),
    workflow.AgentModel("claude-3-5-sonnet"),
    workflow.AgentTimeout(60),
)

results := pipeline.SetVars("store-results",
    "prTitle", fetchPR.Field("title"),
    "review", analyze.Field("response"),
)
```

**After** (New API - Args Pattern):
```go
reviewer, err := agent.New(ctx, "pr-reviewer", &agent.AgentArgs{
    Instructions: "...",
    Description:  "...",
})

fetchPR := pipeline.HttpGet("fetch-pr", url, map[string]string{
    "Accept":     "application/vnd.github.v3+json",
    "User-Agent": "Stigmer-Demo",
})

analyze := pipeline.CallAgent("analyze-pr", &workflow.AgentCallArgs{
    Agent:   reviewer.Name,
    Message: "...",
    Config: map[string]interface{}{
        "model":   "claude-3-5-sonnet",
        "timeout": 60,
    },
})

results := pipeline.Set("store-results", &workflow.SetArgs{
    Variables: map[string]string{
        "prTitle": fetchPR.Field("title").Expression(),
        "review":  analyze.Field("response").Expression(),
    },
})
```

**Changes**:
- Agent creation: Same as BasicAgent (name as arg, `AgentArgs` struct)
- HTTP requests: Headers as map
- Agent calls: `AgentCallArgs` struct with:
  - `Agent` field as **string** (agent name, not object)
  - `Config` map for model/timeout/temperature
- Set variables: `SetArgs` struct

---

### 4. Updated Test Expectations

**File**: `sdk/go/templates/templates_test.go`

Updated `TestCorrectAPIs/AgentAndWorkflow` to check for new API patterns:

**Before**:
```go
requiredAPIs: []string{
    "agent.New(ctx,",
    "workflow.New(ctx,",
    "CallAgent(",
    "workflow.Agent(",  // ❌ Old API
}
```

**After**:
```go
requiredAPIs: []string{
    "agent.New(ctx,",
    "workflow.New(ctx,",
    "CallAgent(",
    "&workflow.AgentCallArgs{",  // ✅ New Args pattern
    "reviewer.Name",             // ✅ Agent reference by name
}
```

---

## Test Results

**Before**:
```
TestTemplatesCompile - FAIL (3/3 subtests failed)
  - BasicAgent: undefined symbols
  - BasicWorkflow: undefined symbols
  - AgentAndWorkflow: undefined symbols, type errors
```

**After**:
```
TestTemplatesCompile - PASS (3/3 subtests passed)
  ✅ BasicAgent compiles successfully
  ✅ BasicWorkflow compiles successfully  
  ✅ AgentAndWorkflow compiles successfully

PASS
ok  	github.com/stigmer/stigmer/sdk/go/templates	3.013s
```

All template tests passing:
- `TestBasicAgent` ✅
- `TestBasicWorkflow` ✅
- `TestAgentAndWorkflow` ✅
- `TestTemplatesCompile` ✅
- `TestNoDeprecatedAPIs` ✅
- `TestCorrectAPIs` ✅

---

## Impact

### User-Facing Benefits

1. **`stigmer init` now works correctly**
   - Generated code compiles without errors
   - Users see correct API patterns from the start
   - No confusion from deprecated examples

2. **Templates demonstrate best practices**
   - Show new Args-based patterns
   - Demonstrate proper field references with `.Expression()`
   - Show correct agent/workflow integration

3. **Reduced learning curve**
   - Templates match documentation
   - Consistent API patterns across all templates
   - Clear examples for common use cases

### Technical Benefits

1. **Template compilation verified**
   - `TestTemplatesCompile` creates temp projects and runs `go build`
   - Ensures templates always compile with current SDK
   - Catches API drift early

2. **API correctness enforced**
   - `TestCorrectAPIs` checks for required patterns
   - Prevents regression to old API
   - Guards against future template updates

---

## Implementation Details

### Files Changed

```
sdk/go/templates/templates.go        - Updated all 3 template functions
sdk/go/templates/templates_test.go   - Updated test expectations
```

### API Pattern Summary

| Feature | Old API | New API |
|---------|---------|---------|
| **Agent creation** | `agent.New(ctx, WithName(), WithInstructions())` | `agent.New(ctx, name, &AgentArgs{...})` |
| **Workflow creation** | `workflow.New(ctx, WithNamespace(), WithName())` | `workflow.New(ctx, WithNamespace(), WithName())` ✅ (unchanged) |
| **HTTP GET** | `wf.HttpGet(name, url, Header(), Timeout())` | `wf.HttpGet(name, url, map[string]string{...})` |
| **Set variables** | `wf.SetVars(name, key1, val1, key2, val2)` | `wf.Set(name, &SetArgs{Variables: map[...]})` |
| **Call agent** | `wf.CallAgent(name, AgentOption(), Message(), AgentModel())` | `wf.CallAgent(name, &AgentCallArgs{Agent, Message, Config})` |
| **Field references** | `task.Field("name")` | `task.Field("name").Expression()` |
| **Agent reference** | `workflow.Agent(agentObj)` | `agentObj.Name` (string) |

### Why AgentCallArgs Uses String for Agent

The `AgentCallArgs.Agent` field is a **string** (agent slug/name) rather than an `*agent.Agent` object because:

1. **Proto representation**: The underlying proto uses string agent references
2. **Separation of concerns**: Workflow tasks reference agents by name (loose coupling)
3. **Flexibility**: Agents can be defined in different contexts or projects

Templates now correctly show:
```go
Agent: reviewer.Name,  // ✅ String (agent name)
```

Not:
```go
Agent: reviewer,       // ❌ Type error (*agent.Agent != string)
```

### Config Map for Execution Settings

Model, timeout, and temperature go in the `Config` map:

```go
Config: map[string]interface{}{
    "model":       "claude-3-5-sonnet",  // Which AI model
    "timeout":     60,                    // Seconds
    "temperature": 0.7,                   // 0.0 - 1.0
}
```

This follows the proto schema where execution config is a flexible `google.protobuf.Struct`.

---

## Testing Strategy

### What We Test

1. **Syntax validity** (`TestBasicAgent`, `TestBasicWorkflow`, `TestAgentAndWorkflow`)
   - Templates parse as valid Go code
   - Required imports present
   - Required function calls present

2. **Compilation** (`TestTemplatesCompile`)
   - Creates temp project with `go.mod`
   - Runs `go mod tidy`
   - Runs `go build`
   - Ensures templates compile with current SDK

3. **No deprecated APIs** (`TestNoDeprecatedAPIs`)
   - Checks for forbidden patterns (`agent.NewWithContext`, `workflow.NewWithContext`)
   - Prevents regression to removed APIs

4. **Correct APIs** (`TestCorrectAPIs`)
   - Checks for required patterns (`agent.New(ctx,`, `&workflow.AgentCallArgs{`)
   - Ensures templates use current best practices

### Test Execution

```bash
cd sdk/go/templates
go test -v

# Output:
# === RUN   TestBasicAgent
# --- PASS: TestBasicAgent (0.00s)
# === RUN   TestBasicWorkflow
# --- PASS: TestBasicWorkflow (0.00s)
# === RUN   TestAgentAndWorkflow
# --- PASS: TestAgentAndWorkflow (0.00s)
# === RUN   TestTemplatesCompile
# === RUN   TestTemplatesCompile/BasicAgent
#     templates_test.go:126: ✅ Template BasicAgent compiles successfully
# === RUN   TestTemplatesCompile/BasicWorkflow
#     templates_test.go:126: ✅ Template BasicWorkflow compiles successfully
# === RUN   TestTemplatesCompile/AgentAndWorkflow
#     templates_test.go:126: ✅ Template AgentAndWorkflow compiles successfully
# --- PASS: TestTemplatesCompile (2.44s)
# === RUN   TestNoDeprecatedAPIs
# --- PASS: TestNoDeprecatedAPIs (0.00s)
# === RUN   TestCorrectAPIs
# --- PASS: TestCorrectAPIs (0.00s)
# PASS
# ok  	github.com/stigmer/stigmer/sdk/go/templates	3.013s
```

---

## Related Work

This fix is part of the **SDK Options Codegen** project (`_projects/2026-01/20260123.02.sdk-options-codegen/`):

### Project Context

**Goal**: Migrate SDK from variadic options pattern (`WithX()` functions) to Args-based pattern for better IDE support and type safety.

**Status**: In progress
- ✅ Agent API migrated
- ✅ Workflow API migrated  
- ✅ Examples updated
- ✅ **Templates fixed** ← This changelog
- ⏳ Remaining edge case test failures

### Next Steps

From test run, remaining failures:
1. **Examples** (10 failures) - Missing required fields, validation errors
2. **Agent edge cases** (5 failures) - Environment variable limits, nil fields
3. **Workflow edge cases** (9 failures) - Nil fields, empty slices, switch config
4. **Integration tests** (4 failures) - Timeout validation, dependency tracking

Templates are now **production-ready** for user-facing code generation.

---

## Lessons Learned

### 1. Templates Are Critical User Touchpoint

Templates from `stigmer init` are often the **first code** users see and run. They must:
- Compile without errors (or users think SDK is broken)
- Demonstrate current best practices (not deprecated patterns)
- Be tested thoroughly (compilation + API correctness)

### 2. Template Tests Catch API Drift

The `TestTemplatesCompile` test that creates temp projects and runs `go build` is invaluable:
- Catches API changes that break templates
- Verifies SDK backward compatibility
- Ensures examples actually work

Without this test, we wouldn't have caught the template breakage until users reported it.

### 3. Args Pattern Is Clearer for Templates

The new API is **better for templates** than the old one:

**Old API** (confusing for new users):
```go
// What are these functions? Where do they come from?
agent.New(ctx,
    agent.WithName("name"),           // Why repeat "agent"?
    agent.WithInstructions("..."),    // Why repeat "agent"?
)
```

**New API** (clearer structure):
```go
// Clear: name is the identifier, args configure it
agent.New(ctx, "name", &agent.AgentArgs{
    Instructions: "...",   // Field names are self-documenting
    Description:  "...",   // IDE autocomplete shows all options
})
```

Users immediately understand:
1. First arg is the name
2. Second arg is configuration
3. What fields are available (IDE shows `AgentArgs` struct)

### 4. Expression() Calls Are Explicit

The new API requires explicit `.Expression()` calls:

```go
// Old: implicit conversion
fetchTask.Field("title")

// New: explicit expression rendering
fetchTask.Field("title").Expression()
```

This is **better** because:
- Makes expression interpolation visible
- Shows when runtime values are used
- Clearer distinction between field references and static values

---

## Migration Path for Users

Users on old API can migrate incrementally:

### 1. Agent Creation

```go
// Old
ag, err := agent.New(ctx,
    agent.WithName("my-agent"),
    agent.WithInstructions("..."),
)

// New
ag, err := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
})
```

### 2. HTTP Tasks

```go
// Old
task := wf.HttpGet("fetch", url,
    workflow.Header("Accept", "application/json"),
)

// New
task := wf.HttpGet("fetch", url, map[string]string{
    "Accept": "application/json",
})
```

### 3. Set Tasks

```go
// Old
task := wf.SetVars("store",
    "key1", value1,
    "key2", value2,
)

// New
task := wf.Set("store", &workflow.SetArgs{
    Variables: map[string]string{
        "key1": value1.Expression(),
        "key2": value2.Expression(),
    },
})
```

### 4. Agent Calls

```go
// Old
task := wf.CallAgent("analyze",
    workflow.AgentOption(workflow.Agent(myAgent)),
    workflow.Message("..."),
    workflow.AgentModel("claude-3-5-sonnet"),
)

// New
task := wf.CallAgent("analyze", &workflow.AgentCallArgs{
    Agent:   myAgent.Name,
    Message: "...",
    Config: map[string]interface{}{
        "model": "claude-3-5-sonnet",
    },
})
```

---

## Verification

To verify templates work correctly:

```bash
# 1. Generate project from template
stigmer init my-test-project --template=agent
cd my-test-project

# 2. Verify it compiles
go mod tidy
go build

# 3. Verify it runs
go run .

# Expected: Agent created successfully!
```

All three templates (agent, workflow, agent-and-workflow) should now work.

---

## Conclusion

Templates are now **aligned with the new SDK API** and **production-ready**. Users running `stigmer init` will get working, idiomatic code that demonstrates current best practices.

This fix:
- ✅ Restores template compilation
- ✅ Unblocks `stigmer init` command
- ✅ Provides correct examples for users
- ✅ Demonstrates new Args-based patterns
- ✅ Maintains comprehensive test coverage

**Next**: Continue fixing remaining test failures (examples, edge cases, integration tests) to complete the SDK options migration.
