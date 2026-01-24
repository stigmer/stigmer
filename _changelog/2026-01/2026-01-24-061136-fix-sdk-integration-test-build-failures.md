# Fix SDK Integration Test Build Failures After API Refactoring

**Date**: 2026-01-24  
**Type**: Bug Fix  
**Scope**: SDK Go - Integration Tests  
**Impact**: Build System  

## Summary

Fixed compilation errors in SDK integration tests (`integration_scenarios_test.go`) that occurred after refactoring APIs to use functional options and struct args patterns.

## Problem

After implementing the new SDK API patterns (Task T06), the integration test file still used the old API methods that were removed during refactoring:

**Compilation Errors**:
- `skill.WithName` undefined (old functional option API)
- `skill.WithMarkdown` undefined (old functional option API)
- `agent.WithName` undefined (old functional option API)
- `agent.WithInstructions` undefined (old functional option API)
- `agent.WithSkills` undefined (old functional option API)
- `workflow.WorkflowArgs` undefined (expected functional options)
- `environment.VariableArgs` undefined (expected functional options)
- `workflow.Header` undefined (old HTTP task option)
- `workflow.Timeout` undefined (old HTTP task option)
- `workflow.Set()` signature mismatch (expected `*SetArgs`, got `map[string]interface{}`)

**Root Cause**: Integration tests were written against the old API before we implemented the new patterns.

## Solution

Updated `integration_scenarios_test.go` to use the correct new API patterns:

### 1. **Skill Creation** - Struct Args Pattern
```go
// OLD (functional options - removed)
skill.New(skill.WithName("name"), skill.WithMarkdown("content"))

// NEW (struct args)
skill.New("name", &skill.SkillArgs{
    MarkdownContent: "content",
})
```

### 2. **Agent Creation** - Struct Args + Builder Methods
```go
// OLD (functional options - removed)
agent.New(ctx, 
    agent.WithName("name"),
    agent.WithInstructions("instructions"),
    agent.WithSkills(*skill),
)

// NEW (struct args + builder)
ag, _ := agent.New(ctx, "name", &agent.AgentArgs{
    Instructions: "instructions",
})
ag.AddSkill(*skill)
ag.AddEnvironmentVariable(env)
```

### 3. **Workflow Creation** - Functional Options (Unchanged)
```go
// CORRECT (workflow still uses functional options)
workflow.New(ctx,
    workflow.WithName("name"),
    workflow.WithNamespace("namespace"),
    workflow.WithVersion("1.0.0"),
)
```

### 4. **Environment Variables** - Functional Options (Unchanged)
```go
// CORRECT (environment still uses functional options)
environment.New(
    environment.WithName("API_KEY"),
    environment.WithSecret(true),
)
```

### 5. **HTTP Tasks** - Struct Args for Timeout
```go
// OLD (functional options - removed)
wf.HttpGet("name", "url", 
    workflow.Header("key", "value"),
    workflow.Timeout(30),
)

// NEW (use HttpCall with struct args for timeout)
workflow.HttpCall("name", &workflow.HttpCallArgs{
    Method: "GET",
    URI: "url",
    Headers: map[string]string{"key": "value"},
    TimeoutSeconds: 30,
})

// OR use convenience methods without timeout
workflow.HttpGet("name", "url", headers)
workflow.HttpPost("name", "url", headers, body)
```

### 6. **SET Tasks** - Struct Args
```go
// OLD (map directly)
workflow.Set("name", map[string]interface{}{...})

// NEW (SetArgs struct)
workflow.Set("name", &workflow.SetArgs{
    Variables: map[string]string{
        "key": "value",
    },
})
```

## Files Modified

```
sdk/go/integration_scenarios_test.go - Updated all 8 integration test functions
```

## Verification

After fixes, ran `make test-sdk`:
- ✅ **Build successful** - All compilation errors resolved
- ⚠️ **Test failures remain** (16 tests) - These are implementation bugs, not build issues

## Build Status

**Before**: Build failed with 10 compilation errors  
**After**: Build successful, no compilation errors

**Remaining test failures** (separate from build issues):
- `sdk/go/agent` - 4 test failures (env vars limits, nil fields, slug generation, data race)
- `sdk/go/examples` - 4 test failures (nil pointers, undeclared variables)  
- `sdk/go/templates` - 2 test failures (template execution)
- `sdk/go/workflow` - 6 test failures (switch condition, HTTP edge cases, wait duration)

## Impact

- **Positive**: SDK now compiles successfully after API refactoring
- **Positive**: Integration tests demonstrate correct usage of new API patterns
- **Neutral**: Test failures are separate implementation bugs, not build issues
- **Next**: Fix remaining test failures in separate tasks

## API Pattern Summary

The SDK uses **three different patterns** across packages:

| Package | Pattern | Reason |
|---------|---------|--------|
| `skill` | Struct Args (`New(name, *Args)`) | Pulumi-style simplicity |
| `agent` | Struct Args + Builder Methods | Flexible composition |
| `workflow` | Functional Options (`New(ctx, ...opts)`) | Complex configuration |
| `environment` | Functional Options (`New(...opts)`) | Simple + validation |

This intentional design provides the best ergonomics for each use case.

## Learnings

**API Migration Pattern**:
- When refactoring APIs, search for all usages (including tests) before committing
- Integration tests are valuable for catching breaking API changes
- Builder methods (`AddSkill()`, `AddEnvironmentVariable()`) provide cleaner syntax than passing everything in constructor

**Test Maintenance**:
- Integration tests serve as documentation of correct API usage
- Keeping integration tests up-to-date ensures examples stay current
- Build failures in tests are easier to debug than runtime failures in examples

## Related Work

- **T06**: Implement options pattern codegen for SDK (the refactoring that broke tests)
- **Prior**: Original integration tests (now updated to new API)
- **Next**: Fix remaining 16 test failures (implementation bugs)

---

**Status**: ✅ Build failures fixed, SDK compiles successfully  
**Next Task**: Fix remaining test failures (nil fields, slug generation, data race, etc.)
