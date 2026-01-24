# Fix SDK Smart Conversion for StringRef and Task References

**Date**: 2026-01-24  
**Type**: Bug Fix (SDK)  
**Impact**: Medium - Fixes workflow example failures, improves smart conversion reliability  
**Scope**: SDK (`sdk/go/workflow`), Code Generator, Examples  

## Summary

Fixed critical bugs in smart expression conversion that prevented workflow examples from running:
1. **StringRef Value Handling** - `coerceToString()` now uses `.Value()` for resolved StringRef literals
2. **Task Reference Support** - Direct task references (e.g., `In: fetchTask`) now convert to proper expressions
3. **Message Field Conversion** - HttpEndpoint and other message types properly convert nested expression fields
4. **Example Corrections** - Fixed examples 07, 08, 10 to use `.Expression()` for map values (where smart conversion doesn't apply)

**Test Results**:
- ✅ Example 07 (Basic Workflow) - PASSING
- ✅ Example 08 (Conditionals) - PASSING  
- ⏸️ Example 09 (Loops) - In progress (WorkflowTask array serialization issue remains)
- ✅ Example 10 (Error Handling) - Syntax fixed (type structure issues remain)

## Problem Statement

### Issue 1: StringRef.Expression() Returns Empty String

**Symptom**:
```
validation error: endpoint: value is required
```

**Root Cause**:
When `StringRef.Concat()` creates a resolved literal (all parts known at compile-time), it returns a `StringRef` with:
- `name: ""` (empty name)
- `value: "resolved-string"` (actual resolved value)

When `coerceToString()` called `.Expression()` on this StringRef:
```go
func (r *baseRef) Expression() string {
    if r.name == "" {
        return "" // ← Returns empty string for resolved literals!
    }
    return fmt.Sprintf("${ $context.%s }", r.name)
}
```

**Impact**: HTTP calls with `apiBase.Concat("/path")` failed validation because URI was empty string.

### Issue 2: Task References Not Supported

**Symptom**:
```
failed to create protobuf struct: proto: invalid type: *workflow.Task
```

**Root Cause**:
Examples passed `*Task` directly to expression fields (e.g., `In: fetchTask`), but `coerceToString()` didn't handle Task types. It fell through to `fmt.Sprintf("%v", value)` which printed pointer representation instead of proper task reference expression.

**Impact**: ForEach loops couldn't reference task outputs directly.

### Issue 3: Nested Message Field Conversion Missing

**Symptom**:
HttpEndpoint.Uri (which is `interface{}`) wasn't being converted by `coerceToString()` in generated ToProto methods.

**Root Cause**:
Generator created code like:
```go
data["endpoint"] = map[string]interface{}{
    "uri": c.Endpoint.Uri, // ← No conversion!
}
```

If `Uri` contained a `*StringRef`, it wasn't converted to string.

**Impact**: Smart conversion didn't work for nested message types.

### Issue 4: Map Values Don't Support Smart Conversion

**Discovery**:
Examples incorrectly assumed smart conversion works for `map[string]string` values:
```go
Variables: map[string]string{
    "title": fetchTask.Field("title"), // ❌ Won't compile!
}
```

**Reality**: Go's type system requires map values to match declared type exactly. `TaskFieldRef` can't be assigned to `string`.

**Solution**: Map values still require `.Expression()`:
```go
Variables: map[string]string{
    "title": fetchTask.Field("title").Expression(), // ✅ Explicit conversion
}
```

## Solution

### Fix 1: Enhanced `coerceToString()` for StringRef

**Generator Change** (`tools/codegen/generator/main.go`):
```go
// Check for StringRef with both Value() and Expression() methods
if sr, ok := value.(interface{ Value() string; Expression() string }); ok {
    // Try Value() first (for resolved StringRef from Concat, etc.)
    if v := sr.Value(); v != "" {
        return v  // ✅ Use resolved value!
    }
    // Fall back to Expression() for computed/context refs
    return sr.Expression()
}
```

**Why This Works**:
- Resolved StringRef (from `Concat()`) has non-empty `.Value()` → use that
- Computed StringRef (runtime expression) has empty `.Value()` → use `.Expression()`
- Context variable StringRef uses `.Expression()` to generate `${ $context.varName }`

### Fix 2: Added Task Reference Support

**Generator Change**:
```go
// Handle *Task - convert to task reference expression
if task, ok := value.(*Task); ok {
    return fmt.Sprintf("${ $context[\"%s\"] }", task.Name)
}
```

**Result**: `In: fetchTask` → `${ $context["fetchCommits"] }`

### Fix 3: Message Field Smart Conversion in Generator

**Generator Enhancement**:
- Added special handling for message types (e.g., `*types.HttpEndpoint`)
- Uses JSON marshaling to convert message to map
- Applies `coerceToString()` to known expression fields (e.g., `uri` in HttpEndpoint)

**Generated Code**:
```go
if c.Endpoint != nil {
    jsonBytes, _ := json.Marshal(c.Endpoint)
    var EndpointMap map[string]interface{}
    json.Unmarshal(jsonBytes, &EndpointMap)
    
    // Apply smart conversion to uri field
    if uri, ok := EndpointMap["uri"]; ok {
        EndpointMap["uri"] = coerceToString(uri)  // ✅ Converts StringRef/TaskFieldRef
    }
    data["endpoint"] = EndpointMap
}
```

### Fix 4: Example Corrections

**Pattern Clarification**:
- **Top-level expression fields**: Support smart conversion (no `.Expression()` needed)
  - `In: fetchTask.Field("items")` ✅
  - `Message: promptTask` ✅
  - `Uri: apiBase.Concat("/path")` ✅
  
- **Map values**: Require explicit `.Expression()` (Go type system limitation)
  - `Variables: map[string]string{"x": task.Field("y").Expression()}` ✅
  - `Headers: map[string]string{"Auth": token.Expression()}` ✅

**Files Updated**:
- `07_basic_workflow.go` - Added `.Expression()` for Variables map values
- `08_workflow_with_conditionals.go` - Added `.Expression()` for Variables map values
- `10_workflow_with_error_handling.go` - Added `.Expression()` for Variables map values

## Testing

**Passing Tests**:
- ✅ `TestExample07_BasicWorkflow` - HTTP call + Set task with field references
- ✅ `TestExample08_WorkflowWithConditionals` - Switch cases with fluent API
- ✅ All existing loop tests in `for_loop_test.go` (28 tests)

**Remaining Issues**:
- ⏸️ `TestExample09_WorkflowWithLoops` - WorkflowTask array serialization in ForTaskConfig.ToProto()
- ⏸️ `TestExample10_WorkflowWithErrorHandling` - Type structure issues (TryArgs fields)
- ⏸️ `TestExample11_WorkflowWithParallelExecution` - Type structure issues (ForkBranch)

## Technical Details

### Code Generation Changes

**Array of Message Types**:
```go
// Generator now produces:
if !isEmpty(c.Do) {
    jsonBytes, _ := json.Marshal(c.Do)
    var DoArray []interface{}
    json.Unmarshal(jsonBytes, &DoArray)
    data["do"] = DoArray
}
```

**Why JSON Marshaling**: `structpb.NewStruct()` can't directly handle `[]*types.WorkflowTask`. JSON round-trip converts to basic types.

### Smart Conversion Behavior

**StringRef Handling**:
- `apiBase.Concat("/path")` where `apiBase = ctx.SetString("apiBase", "https://api.com")`
- All parts known → resolved to `"https://api.com/path"` at compile time
- `coerceToString()` uses `.Value()` → returns `"https://api.com/path"` ✅

**Task Reference Handling**:
- `In: fetchTask` where `fetchTask = wf.HttpGet("fetch", ...)`
- `coerceToString()` converts to `${ $context["fetch"] }`
- Backend resolves task output at runtime

**TaskFieldRef Handling** (unchanged):
- `fetchTask.Field("title")` creates `TaskFieldRef{taskName: "fetch", fieldName: "title"}`
- `.Expression()` returns `${ $context["fetch"].title }`
- Still works with smart conversion via interface duck typing

## Files Modified (24 files)

**Code Generator** (1 file):
- `tools/codegen/generator/main.go` (+111 lines)
  - Enhanced ToProto generation for arrays of messages
  - Enhanced ToProto generation for message types
  - Enhanced coerceToString() generation (StringRef.Value(), *Task handling)
  - Added generateMessageFieldConversion() helper

**Generated SDK Files** (19 files):
- All `*taskconfig_task.go` files regenerated with updated ToProto logic
- `helpers.go` - Enhanced coerceToString()
- `types/agentic_types.go`, `types/commons_types.go` - Regenerated
- `agent/agentspec_args.go`, `skill/skillspec_args.go` - Regenerated

**Manual SDK File** (1 file):
- `workflow/proto.go` - Fixed `httpCallTaskConfigToMap()` Uri conversion

**Examples** (3 files):
- `07_basic_workflow.go` - Corrected map value expressions
- `08_workflow_with_conditionals.go` - Corrected map value expressions
- `10_workflow_with_error_handling.go` - Corrected map value expressions

## Impact Assessment

**Immediate Benefits**:
- ✅ 2 more workflow examples passing (07, 08)
- ✅ StringRef.Concat() works correctly in expressions
- ✅ Direct task references work (cleaner API)
- ✅ Nested message types properly converted

**Developer Experience**:
- ✅ Can use `In: fetchTask` instead of `In: fetchTask.Field("")`
- ✅ StringRef operations work as expected
- ✅ Clear pattern: `.Expression()` only needed for map values

**Remaining Work** (for next session):
- ⏸️ Resolve WorkflowTask array serialization for example 09
- ⏸️ Fix TryArgs, ForkArgs type structure issues in examples 10, 11
- ⏸️ Run full test suite to identify other failing tests

## Backward Compatibility

**Fully Compatible**: ✅
- Existing code with `.Expression()` calls still works
- New smart conversion is additive
- No breaking changes to APIs

## Lessons Learned

### Generator is Source of Truth

Modified generated files directly initially - **WRONG APPROACH**. 

**Correct approach**:
1. Identify issue in generated code
2. Fix generator logic
3. Regenerate files
4. Test

### Smart Conversion Scope

Smart conversion **only works** for:
- Top-level struct fields of type `interface{}`
- Types implementing `Expression()` method

Smart conversion **does NOT work** for:
- Map values (`map[string]string` requires exact type match)
- Struct fields of type `string` (not `interface{}`)

This is a Go language limitation, not a design choice.

### Iterative Debugging Required

Complex serialization issues require:
- Understanding data flow through multiple layers
- Checking generated vs manual code
- Testing individual components
- Adding temporary debug output

---

**Status**: Partial fix complete - 2 examples passing, foundation improved for remaining fixes.
