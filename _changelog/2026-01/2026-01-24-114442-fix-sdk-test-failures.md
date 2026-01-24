# Fix SDK Test Failures - Dependency Tracking and Example 13

**Date**: 2026-01-24  
**Type**: Bug Fix (SDK Quality)  
**Scope**: SDK Go - Agent and Workflow Integration  
**Impact**: Internal quality improvement - all SDK tests now pass

## Summary

Fixed two failing tests in the Stigmer Go SDK that were preventing the test suite from passing. The fixes improve the reliability of skill dependency tracking and correct the usage pattern for StringRef in workflow examples.

## Issues Fixed

### 1. TestExample13_WorkflowAndAgentSharedContext

**Problem**: Example was incorrectly calling `.Expression()` explicitly on a StringRef when building HTTP endpoints, causing validation errors during proto conversion.

**Root Cause**: The example used:
```go
endpoint := apiURL.Concat("/data")
wf.HttpGet("fetchData", endpoint.Expression(), ...)
```

When `.Expression()` is called explicitly, it returns a JQ expression string that isn't properly handled by the validation layer.

**Fix**: Changed to use `workflow.Interpolate()` pattern:
```go
endpoint := workflow.Interpolate(apiURL, "/data")
wf.HttpGet("fetchData", endpoint, ...)
```

This follows the correct SDK pattern where `Interpolate()` handles StringRef conversion internally.

**Files Changed**:
- `sdk/go/examples/13_workflow_and_agent_shared_context.go`

### 2. TestIntegration_DependencyTracking

**Problem**: When skills were added to agents using `AddSkill()` after agent creation, they weren't being registered in the context or tracked as dependencies. The test expected skills to be tracked but found 0 skills registered.

**Root Cause**: The agent registration flow was:
1. `agent.New()` calls `ctx.RegisterAgent()` (agent has empty Skills slice at this point)
2. Skills are added via `agent.AddSkill()` AFTER registration
3. `RegisterAgent()` never saw the skills

**Fix**: Implemented automatic skill registration in `AddSkill()`:

1. **Extended agent.Context interface** to include:
   - `RegisterSkill(s interface{})`
   - `TrackDependency(resourceID, dependsOnID string)`

2. **Updated stigmer.Context** to implement new methods:
   - Made `RegisterSkill` accept `interface{}` for cross-package compatibility
   - Added `TrackDependency` as public, thread-safe method
   - Added `isSkillRegistered()` helper to prevent duplicate registrations
   - Updated `RegisterAgent` to register inline skills and check for duplicates

3. **Enhanced agent.AddSkill()** to:
   - Register inline skills with the context when added
   - Track the dependency between the agent and the skill
   - Prevent duplicate skill registrations

**Files Changed**:
- `sdk/go/agent/agent.go` - Updated `Context` interface and `AddSkill()` method
- `sdk/go/stigmer/context.go` - Added public methods and duplicate detection

## Technical Details

### Dependency Tracking Flow (After Fix)

```
1. Create agent → agent.New() → ctx.RegisterAgent() → agent has no skills yet
2. Add skill → agent.AddSkill(skill) → NOW triggers:
   a. ctx.RegisterSkill(&skill) - registers skill if inline and not duplicate
   b. ctx.TrackDependency("agent:name", "skill:name") - tracks dependency
3. Result → Skills tracked correctly, dependencies recorded
```

### Duplicate Prevention

Both `RegisterSkill` and `RegisterAgent` now check if a skill is already registered before adding it to the skills slice. This prevents double-registration when:
- Skills are manually registered via `ctx.RegisterSkill()`
- Then agents with those skills are registered via `ctx.RegisterAgent()`

### Interface Design

The `agent.Context` interface uses `interface{}` for `RegisterSkill` to avoid circular dependencies between packages, with runtime type assertion in the implementation.

## Testing

**Before**: 2 tests failing
```
FAIL: TestIntegration_DependencyTracking (0 skills tracked, expected 2)
FAIL: TestExample13_WorkflowAndAgentSharedContext (validation error: endpoint required)
```

**After**: All tests pass
```
PASS: TestIntegration_DependencyTracking (dependencies tracked correctly)
PASS: TestExample13_WorkflowAndAgentSharedContext (workflow synthesizes successfully)
PASS: All SDK tests (full test suite passes)
```

## Impact

**Users**: No user-facing changes - internal SDK quality improvement

**Developers**: 
- SDK tests are now reliable
- Dependency tracking works correctly for skills added after agent creation
- Example 13 demonstrates correct StringRef usage pattern

## Lessons Learned

1. **StringRef Usage**: Don't call `.Expression()` explicitly - use `workflow.Interpolate()` or pass StringRef directly to methods that accept `interface{}`

2. **Registration Timing**: When resources are added to collections after creation (like skills to agents), need to handle registration at add-time, not just at creation-time

3. **Duplicate Prevention**: When multiple code paths can register the same resource, need duplicate detection to prevent double-registration

4. **Interface Design**: Using `interface{}` with type assertions allows cross-package communication without circular dependencies

## Related Components

- `sdk/go/agent` - Agent creation and skill management
- `sdk/go/stigmer` - Context and dependency tracking
- `sdk/go/workflow` - Workflow creation and StringRef handling
- `sdk/go/examples` - Example demonstrating shared context usage

## Files Modified

```
sdk/go/agent/agent.go
sdk/go/stigmer/context.go
sdk/go/examples/13_workflow_and_agent_shared_context.go
```

## Verification

Run `make test-sdk` from repository root - all tests pass.
