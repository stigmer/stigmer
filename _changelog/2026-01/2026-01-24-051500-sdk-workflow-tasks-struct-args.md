# SDK: Migrate Workflow Tasks to Struct-Based Args (Pulumi Pattern)

**Type**: Enhancement  
**Date**: 2026-01-24  
**Scope**: sdk/go/workflow  
**Breaking**: Yes (API change)

---

## Summary

Migrated all 13 workflow task types from functional options to Pulumi-style struct-based args, completing the SDK-wide transition started in Phase 2 (Agent/Skill). The workflow package now uses a consistent args pattern across all task constructors, improving API clarity and matching Pulumi conventions.

---

## What Changed

### Before (Functional Options)

```go
// HTTP Call with functional options
task := workflow.HttpCall("fetch",
    workflow.HTTPMethod("GET"),
    workflow.URI("https://api.example.com/data"),
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)

// Set task with functional options  
task := workflow.Set("init",
    workflow.SetVar("x", "1"),
    workflow.SetVar("y", "2"),
)

// Agent call with functional options
task := workflow.AgentCall("review",
    workflow.AgentSlug("code-reviewer"),
    workflow.Message("Review this PR"),
    workflow.WithEnv(map[string]string{"TOKEN": "${.token}"}),
)
```

### After (Struct Args)

```go
// HTTP Call with struct args
task := workflow.HttpCall("fetch", &workflow.HttpCallArgs{
    Method:  "GET",
    URI:     "https://api.example.com/data",
    Headers: map[string]string{
        "Content-Type": "application/json",
    },
    TimeoutSeconds: 30,
})

// Set task with struct args
task := workflow.Set("init", &workflow.SetArgs{
    Variables: map[string]string{
        "x": "1",
        "y": "2",
    },
})

// Agent call with struct args
task := workflow.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "code-reviewer",
    Message: "Review this PR",
    Env:     map[string]string{"TOKEN": "${.token}"},
})

// Convenience helpers for common cases
task := workflow.HttpGet("fetch", "https://api.example.com/data", 
    map[string]string{"Content-Type": "application/json"})
```

---

## Impact

### API Simplification ✅

**Before**: 13 option types × ~5 functions each = 65+ functions to remember  
**After**: 13 args structs + constructor = Direct struct initialization

**Developer Experience**:
- ✅ IDE autocomplete shows all available fields
- ✅ Required vs optional fields clear from struct definition
- ✅ No need to memorize option function names
- ✅ Consistent with Agent/Skill APIs (Phase 2)
- ✅ Matches Pulumi resource creation pattern

### Breaking Changes ⚠️

**Migration Required**:
- All workflow task creation code must be updated
- 12 workflow examples need updating (follow-up work)
- User code using functional options must migrate

**Migration Path**:
```go
// OLD
HttpCall("task", HTTPMethod("GET"), URI("url"), Header("k", "v"))

// NEW
HttpCall("task", &HttpCallArgs{
    Method:  "GET",
    URI:     "url", 
    Headers: map[string]string{"k": "v"},
})
```

---

## Technical Details

### Task Types Migrated (13/13)

1. **HTTP_CALL** → `HttpCallArgs` (method, uri, headers, body, timeout)
2. **AGENT_CALL** → `AgentCallArgs` (agent, message, env, config)
3. **GRPC_CALL** → `GrpcCallArgs` (service, method, body)
4. **CALL_ACTIVITY** → `CallActivityArgs` (activity, input)
5. **FOR** → `ForArgs` (in, do) + LoopVar helper
6. **FORK** → `ForkArgs` (branches) + BranchResult helper
7. **LISTEN** → `ListenArgs` (event)
8. **RAISE** → `RaiseArgs` (error, message, data)
9. **RUN** → `RunArgs` (workflowName, input)
10. **SET** → `SetArgs` (variables)
11. **SWITCH** → `SwitchArgs` (cases, defaultTask) + ConditionMatcher
12. **TRY** → `TryArgs` (tasks, catch) + ErrorRef helper
13. **WAIT** → `WaitArgs` (duration)

### Implementation Pattern

All task constructors follow this pattern:

```go
// Type alias for clean API naming
type HttpCallArgs = HttpCallTaskConfig

// Nil-safe constructor
func HttpCall(name string, args *HttpCallArgs) *Task {
    if args == nil {
        args = &HttpCallArgs{}
    }
    
    // Initialize nil maps/slices
    if args.Headers == nil {
        args.Headers = make(map[string]string)
    }
    
    return &Task{
        Name:   name,
        Kind:   TaskKindHttpCall,
        Config: args,
    }
}
```

### Helper Types Preserved

Kept essential helpers for ergonomic APIs:

- **ErrorRef** - Error variable references in catch blocks
- **LoopVar** - Loop item field access
- **BranchResult** - Parallel branch result access
- **ConditionMatcher** - Type-safe condition builders (Equals, GreaterThan, etc.)
- **ErrorMatcher** - Type-safe error type matching

### Workflow Builder Methods Updated

```go
// Before
wf.HttpGet(name, uri, Header(...), Timeout(...))

// After  
wf.HttpGet(name, uri, headers)
```

All builder methods now accept simplified parameters for common cases.

---

## Files Changed

### Task Option Files (13 modified)
- `sdk/go/workflow/httpcall_options.go` - HTTP args
- `sdk/go/workflow/agentcall_options.go` - Agent args
- `sdk/go/workflow/grpccall_options.go` - gRPC args
- `sdk/go/workflow/callactivity_options.go` - Activity args
- `sdk/go/workflow/for_options.go` - Loop args + helper
- `sdk/go/workflow/fork_options.go` - Fork args + helper
- `sdk/go/workflow/listen_options.go` - Listen args
- `sdk/go/workflow/raise_options.go` - Raise args
- `sdk/go/workflow/run_options.go` - Run args
- `sdk/go/workflow/set_options.go` - Set args
- `sdk/go/workflow/switch_options.go` - Switch args + helper
- `sdk/go/workflow/try_options.go` - Try args + helper
- `sdk/go/workflow/wait_options.go` - Wait args

### Core Files (2 modified)
- `sdk/go/workflow/workflow.go` - Builder methods
- `sdk/go/workflow/error_matcher.go` - Removed WithCatchTyped

---

## Migration Guide

### Step 1: Update Task Creation

**HTTP Calls**:
```go
// OLD
HttpCall("fetch",
    HTTPMethod("GET"),
    URI("https://api.example.com"),
    Header("Auth", "token"),
)

// NEW
HttpCall("fetch", &HttpCallArgs{
    Method: "GET",
    URI:    "https://api.example.com",
    Headers: map[string]string{"Auth": "token"},
})
```

**Agent Calls**:
```go
// OLD
AgentCall("review",
    AgentSlug("code-reviewer"),
    Message("Review PR"),
)

// NEW
AgentCall("review", &AgentCallArgs{
    Agent:   "code-reviewer",
    Message: "Review PR",
})
```

**Variable Setting**:
```go
// OLD
Set("init",
    SetVar("x", "1"),
    SetVar("y", "2"),
)

// NEW
Set("init", &SetArgs{
    Variables: map[string]string{
        "x": "1",
        "y": "2",
    },
})
```

### Step 2: Update Workflow Builders

```go
// OLD
wf.HttpGet("fetch", endpoint,
    Header("Content-Type", "application/json"),
    Timeout(30),
)

// NEW - Simplified
wf.HttpGet("fetch", endpoint, map[string]string{
    "Content-Type": "application/json",
})

// OR - Full control
HttpCall("fetch", &HttpCallArgs{
    Method:         "GET",
    URI:            endpoint,
    Headers:        map[string]string{"Content-Type": "application/json"},
    TimeoutSeconds: 30,
})
```

### Step 3: Update Error Handling

```go
// OLD
Try("attempt",
    WithTry(tasks...),
    WithCatchTyped(CatchHTTPErrors(), "err", handleError),
)

// NEW
Try("attempt", &TryArgs{
    Tasks: []map[string]interface{}{...},
    Catch: []map[string]interface{}{
        {
            "errors": CatchHTTPErrors().Types(), // Helper still works
            "as":     "err",
            "tasks":  []interface{}{...},
        },
    },
})
```

---

## Testing

### Compilation
- ✅ Workflow package compiles
- ✅ Entire SDK compiles  
- ✅ No compilation errors

### Next Steps
- ⏳ Update 12 workflow examples (07-19)
- ⏳ Add integration tests for struct args
- ⏳ Update workflow documentation

---

## Related Changes

**Previous Phases**:
- Phase 2: Agent/Skill struct args (2026-01-24)
- Phase 4: SDK examples updated (2026-01-24)

**Next Steps**:
- Phase 5 Follow-up: Update workflow examples
- Phase 6: Documentation and cleanup

---

## Why This Change?

### Consistency
- Matches Agent/Skill APIs (Phase 2)
- Aligns with Pulumi resource creation pattern
- Unifies SDK API surface

### Developer Experience  
- Clearer API (struct fields vs option functions)
- Better IDE support (autocomplete)
- Easier to discover available options
- Simpler mental model

### Maintainability
- Less code to maintain (removed 65+ option functions)
- Type aliases avoid duplication
- Single source of truth (proto schemas)

---

**Impact**: Breaking change - all workflow task creation code must be updated  
**Benefit**: Simpler, more consistent API matching Pulumi conventions  
**Status**: Core migration complete, examples need follow-up
