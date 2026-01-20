# Fix SDK Agent StringRef Resolution Bug

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: SDK (Go) - Agent Package  
**Impact**: Critical - 7 test failures resolved

## Problem

The agent package's `toExpression()` helper function had a type switch ordering bug that prevented StringRef values from being resolved to their actual values when creating agents with typed context variables.

**Symptom**: When passing a StringRef to agent options (e.g., `WithName(ctx.SetString("name", "value"))`), the agent field would contain the expression placeholder `${ $context.name }` instead of the actual value `"value"`.

**Root Cause**: The type switch in `ref_helpers.go` checked for the `Ref` interface before checking for `StringValue`. Since `StringRef` implements both interfaces, it matched `Ref` first and called `Expression()` instead of `Value()`.

## Solution

Reordered the type switch in `toExpression()` to check `StringValue` before `Ref`:

```go
// Before (broken):
switch v := value.(type) {
case string:
    return v
case Ref:
    return v.Expression()  // Matched first for StringRef
case StringValue:
    return v.Value()       // Never reached
}

// After (fixed):
switch v := value.(type) {
case string:
    return v
case StringValue:
    return v.Value()       // Now matches StringRef first
case Ref:
    return v.Expression()  // Only for non-StringValue refs
}
```

**File Changed**: `sdk/go/agent/ref_helpers.go`

## Impact

### Tests Fixed (7 failures → all passing)

**Agent Package** (`sdk/go/agent`):
- ✅ `TestAgentBuilder_WithNameStringRef` - Now resolves name from context
- ✅ `TestAgentBuilder_WithInstructionsStringRef` - Now resolves instructions from context
- ✅ `TestAgentBuilder_WithDescriptionStringRef` - Now resolves description from context
- ✅ `TestAgentBuilder_WithIconURLStringRef` - Now resolves iconURL from context
- ✅ `TestAgentBuilder_WithOrgStringRef` - Now resolves org from context
- ✅ `TestAgentBuilder_MixedTypedAndLegacy` - Mixed StringRef and string values work
- ✅ `TestAgentBuilder_StringRefConcat` - StringRef concatenation works

All agent package tests now pass (100% pass rate).

### User Impact

**Before**: Users couldn't use typed context variables with agents:
```go
ctx := stigmer.NewContext()
agentName := ctx.SetString("agentName", "code-reviewer")
ag, err := agent.New(ctx, agent.WithName(agentName), ...)
// ag.Name would be "${ $context.agentName }" ❌ WRONG
```

**After**: Typed context variables work as expected:
```go
ctx := stigmer.NewContext()
agentName := ctx.SetString("agentName", "code-reviewer")
ag, err := agent.New(ctx, agent.WithName(agentName), ...)
// ag.Name is "code-reviewer" ✅ CORRECT
```

### Backward Compatibility

✅ **Fully backward compatible** - Plain string usage unchanged:
```go
agent.New(ctx, agent.WithName("code-reviewer"), ...)  // Still works
```

## Testing

- All 7 previously failing tests now pass
- Full agent package test suite passes (100% pass rate)
- No regressions introduced
- Backward compatibility verified

## Related Context

This fix enables the typed context variable feature introduced earlier. Users can now safely use `ctx.SetString()`, `ctx.SetInt()`, etc., to define agent properties and have them resolved to actual values during agent creation.

The fix is minimal (reordering 4 lines in a type switch) but critical for the SDK's typed context feature to work properly.

## Technical Notes

**Go Type Assertion Pattern**: When a type implements multiple interfaces, the order of `case` statements in a type switch matters. More specific interfaces should be checked before more general ones.

**Why this pattern?**:
- `StringRef` implements both `Ref` (for JQ expressions) and has a `Value()` method (for synthesis)
- For agent creation (synthesis), we want the actual value, not the expression
- Checking `StringValue` first ensures we get the value for synthesis contexts
- Checking `Ref` second handles pure expression refs that don't have concrete values

This is a common Go pattern when working with interface hierarchies where types implement multiple interfaces with overlapping use cases.
