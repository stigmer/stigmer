# Checkpoint: SDK Templates Fixed

**Date**: 2026-01-24 16:17  
**Milestone**: Fixed SDK templates to use new options-based API - all template tests passing  
**Conversation**: 7

---

## What Was Accomplished

### ✅ Fixed All 3 SDK Templates

Updated `sdk/go/templates/templates.go` to use the new options-based API:

1. **BasicAgent Template**
   - Changed from: `agent.New(ctx, agent.WithName(), agent.WithInstructions(), ...)`
   - Changed to: `agent.New(ctx, "name", &agent.AgentArgs{Instructions: "...", Description: "..."})`
   - Pattern: Name as positional arg, configuration in AgentArgs struct

2. **BasicWorkflow Template**
   - Changed HTTP tasks: `wf.HttpGet(name, url, map[string]string{...})`
   - Changed Set tasks: `wf.Set(name, &workflow.SetArgs{Variables: map[string]string{...}})`
   - Changed field references: `task.Field("name").Expression()` (explicit)

3. **AgentAndWorkflow Template**
   - Updated agent creation (same as BasicAgent)
   - Updated workflow tasks (same as BasicWorkflow)
   - Fixed CallAgent: `wf.CallAgent(name, &workflow.AgentCallArgs{Agent: agent.Name, Message: "...", Config: {...}})`
   - Key insight: Agent field is string (agent name), not object

### ✅ Updated Test Expectations

Updated `sdk/go/templates/templates_test.go`:
- Fixed `TestCorrectAPIs/AgentAndWorkflow` to check for new patterns:
  - `&workflow.AgentCallArgs{` instead of `workflow.Agent(`
  - `reviewer.Name` for agent reference
- All 6 template tests now passing

---

## Test Results

**Before**:
```
FAIL: TestTemplatesCompile (3/3 subtests failed)
  - BasicAgent: undefined: agent.WithName, agent.WithInstructions
  - BasicWorkflow: undefined: workflow.Header, workflow.Timeout, wf.SetVars
  - AgentAndWorkflow: undefined symbols + type errors
```

**After**:
```
PASS: sdk/go/templates (6/6 tests, 100%)
  ✅ TestBasicAgent
  ✅ TestBasicWorkflow
  ✅ TestAgentAndWorkflow
  ✅ TestTemplatesCompile (all 3 subtests)
  ✅ TestNoDeprecatedAPIs
  ✅ TestCorrectAPIs
```

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
   - TestTemplatesCompile creates temp projects and runs `go build`
   - Ensures templates always compile with current SDK
   - Catches API drift early

2. **API correctness enforced**
   - TestCorrectAPIs checks for required patterns
   - Prevents regression to old API
   - Guards against future template updates

---

## Key API Patterns

Templates now correctly demonstrate:

| Feature | Pattern |
|---------|---------|
| **Agent creation** | `agent.New(ctx, "name", &agent.AgentArgs{...})` |
| **HTTP GET** | `wf.HttpGet("name", url, map[string]string{...})` |
| **Set variables** | `wf.Set("name", &workflow.SetArgs{Variables: map[...]})` |
| **Call agent** | `wf.CallAgent("name", &workflow.AgentCallArgs{Agent: agent.Name, ...})` |
| **Field references** | `task.Field("name").Expression()` |
| **Agent reference** | `agent.Name` (string, not object) |

---

## Files Changed

```
sdk/go/templates/templates.go        - Updated all 3 template functions
sdk/go/templates/templates_test.go   - Updated test expectations
```

---

## Overall SDK Test Status

After this fix:

**Packages Now Passing:**
- ✅ `sdk/go/templates` (was failing, **now passing**)
- ✅ `sdk/go/environment`
- ✅ `sdk/go/internal/synth`
- ✅ `sdk/go/mcpserver`
- ✅ `sdk/go/skill`
- ✅ `sdk/go/stigmer`
- ✅ `sdk/go/stigmer/naming`
- ✅ `sdk/go/subagent`

**Still Failing (for next iteration):**
- ❌ `sdk/go` (integration tests)
- ❌ `sdk/go/agent` (edge case tests)
- ❌ `sdk/go/examples` (example execution tests)
- ❌ `sdk/go/workflow` (edge case tests)

---

## Next Steps

Recommended priorities for remaining test failures:

1. **Examples** (user-facing) - Missing required fields, validation errors
2. **Agent edge cases** - Environment variable limits, nil fields
3. **Workflow edge cases** - Nil fields, empty slices, switch config
4. **Integration tests** - Timeout validation, dependency tracking

---

## Lessons Learned

### 1. Templates Are Critical User Touchpoint

Templates from `stigmer init` are often the **first code** users see. They must:
- Compile without errors (or users think SDK is broken)
- Demonstrate current best practices (not deprecated patterns)
- Be tested thoroughly (compilation + API correctness)

### 2. Template Tests Catch API Drift

The `TestTemplatesCompile` test that creates temp projects and runs `go build` is invaluable:
- Catches API changes that break templates
- Verifies SDK backward compatibility
- Ensures examples actually work

### 3. Args Pattern Is Clearer for Templates

The new API is better for templates than the old one:

**Old API** (confusing):
```go
agent.New(ctx,
    agent.WithName("name"),
    agent.WithInstructions("..."),
)
```

**New API** (clear):
```go
agent.New(ctx, "name", &agent.AgentArgs{
    Instructions: "...",
})
```

Users immediately understand:
- First arg is the name
- Second arg is configuration
- What fields are available (IDE autocomplete)

### 4. AgentCallArgs Uses String for Agent

Important discovery: `AgentCallArgs.Agent` is a **string** (agent slug), not `*agent.Agent`:

```go
// ✅ Correct
Agent: reviewer.Name,  // String (agent name)

// ❌ Wrong
Agent: reviewer,       // Type error (*agent.Agent != string)
```

Reason: Proto uses string agent references, enabling loose coupling between workflows and agents.

---

## Success Metrics

- ✅ All 3 templates compile successfully
- ✅ All 6 template tests passing (100%)
- ✅ Zero deprecated API patterns in templates
- ✅ Templates ready for production use
- ✅ `stigmer init` command unblocked
- ✅ Users get working, idiomatic code

---

## Related Documentation

- Changelog: `_changelog/2026-01/2026-01-24-061654-fix-sdk-templates-options-api.md`
- Migration Guide: `docs/guides/migration/v0.2-options-to-args.md`
- Architecture: `docs/architecture/sdk-options-architecture.md`
- API Reference: `sdk/go/docs/API_REFERENCE.md`

---

## Conclusion

Templates are now **aligned with the new SDK API** and **production-ready**. Users running `stigmer init` will get working, idiomatic code that demonstrates current best practices.

This fix completes another critical piece of the SDK migration, ensuring user-facing code generation works correctly.

**Status**: ✅ SDK Templates - Production Ready
