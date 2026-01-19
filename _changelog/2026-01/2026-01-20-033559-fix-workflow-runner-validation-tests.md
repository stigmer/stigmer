# Fix Workflow-Runner Validation Tests

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: `backend/services/workflow-runner`  
**Files Changed**: 3

## Summary

Fixed 3 failing test cases in the workflow-runner validation system by adding validation to the unmarshal step and improving error context propagation. All validation tests now pass.

## Problem

Running `make test-workflow-runner` revealed 4 test failures across 3 packages:

1. **TestE2E_ValidationIntegration_InvalidConfig** (converter package)
   - Expected validation to reject invalid HTTP task config
   - Validation was passing when it should have failed

2. **TestValidateTask** (validation package)  
   - Expected error messages to include task kind (`WORKFLOW_TASK_KIND_HTTP_CALL`)
   - Error messages were missing task context

3. **TestValidateStructureActivity_InvalidYAML** (activities package)
   - Expected invalid YAML to fail parsing
   - YAML was syntactically valid (extra field ignored) - test case was wrong

## Root Cause

### Validation Not Happening During Unmarshal

The `UnmarshalTaskConfig()` function only unmarshaled `Struct` → typed proto without validating. Tests expected validation to occur during unmarshal, but it only happened later in `ValidateTask()`.

**Before**:
```go
func UnmarshalTaskConfig(kind, config) (proto.Message, error) {
    // Convert Struct to JSON
    // Unmarshal JSON to proto
    return protoMsg, nil  // No validation!
}
```

### Error Context Lost

When `ValidateTask()` called `UnmarshalTaskConfig()`, validation errors from the unmarshal step didn't include task name and kind context that tests expected.

### Invalid Test Case

The "invalid YAML" test used syntactically valid YAML with an extra field that was silently ignored by the parser. The test needed truly malformed YAML.

## Solution

### 1. Added Validation to UnmarshalTaskConfig

Modified `unmarshal.go` to validate immediately after unmarshaling:

```go
func UnmarshalTaskConfig(kind, config) (proto.Message, error) {
    // ... existing unmarshal code ...
    
    // Validate the unmarshaled proto message
    if err := ValidateTaskConfig(protoMsg); err != nil {
        return nil, err
    }
    
    return protoMsg, nil
}
```

**Impact**: Invalid task configs are now caught during unmarshal, matching test expectations.

### 2. Enhanced Error Context Propagation in ValidateTask

Modified `validate.go` to add task context to validation errors from `UnmarshalTaskConfig()`:

```go
func ValidateTask(task *workflowv1.WorkflowTask) error {
    // 1. Unmarshal (now also validates)
    msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
    if err != nil {
        taskKind := task.Kind.String()
        
        // Add task context to validation errors
        if valErrs, ok := err.(*ValidationErrors); ok {
            for i := range valErrs.Errors {
                valErrs.Errors[i].TaskName = task.Name
                valErrs.Errors[i].TaskKind = taskKind
            }
            return err
        }
        
        // For non-validation errors, wrap with context
        return fmt.Errorf("failed to unmarshal task '%s' (%s): %w", 
            task.Name, taskKind, err)
    }
    
    // 2. Redundant validation kept for backwards compatibility
    // ...
}
```

**Impact**: Error messages now include task name and kind, improving debuggability.

### 3. Fixed Invalid YAML Test Case

Modified `validate_workflow_activity_test.go` to use truly malformed YAML:

**Before** (syntactically valid):
```yaml
do:
  - greet:
      set:
        message: Hello, World!
      invalid_indentation:  # Extra field ignored
```

**After** (malformed - unclosed quote):
```yaml
do:
  - greet:
      set:
        message: "Hello, World!
        status: incomplete
```

**Impact**: Test now properly validates YAML parsing failure.

## Test Results

**Before**: 4 tests failing
```
FAIL: TestE2E_ValidationIntegration_InvalidConfig
FAIL: TestValidateTask/invalid_HTTP_task_fails_with_context  
FAIL: TestValidateStructureActivity_InvalidYAML
FAIL: TestForTaskBuilderIterator (unrelated)
FAIL: TestSwitchTaskBuilderExecutesMatchingCase (unrelated)
```

**After**: 3 validation tests passing (2 task builder tests remain - different category)
```
PASS: TestE2E_ValidationIntegration_InvalidConfig ✅
PASS: TestValidateTask ✅
PASS: TestValidateStructureActivity_InvalidYAML ✅
FAIL: TestForTaskBuilderIterator (nil pointer - separate issue)
FAIL: TestSwitchTaskBuilderExecutesMatchingCase (assertion failure - separate issue)
```

## Files Modified

1. **`backend/services/workflow-runner/pkg/validation/unmarshal.go`**
   - Added `ValidateTaskConfig()` call after unmarshaling
   - Ensures invalid configs are rejected early

2. **`backend/services/workflow-runner/pkg/validation/validate.go`**
   - Enhanced error handling in `ValidateTask()`
   - Adds task name and kind context to validation errors
   - Handles both `ValidationErrors` and generic errors

3. **`backend/services/workflow-runner/worker/activities/validate_workflow_activity_test.go`**
   - Fixed `TestValidateStructureActivity_InvalidYAML` test case
   - Changed from syntactically valid YAML to truly malformed YAML

## Design Decisions

### Why Validate in UnmarshalTaskConfig?

**Decision**: Add validation during unmarshal rather than only in `ValidateTask()`.

**Rationale**:
- Tests expect validation during unmarshal (integration point)
- Converter calls `UnmarshalTaskConfig()` directly
- Fail-fast principle: catch errors as early as possible
- Consistent behavior across all unmarshal call sites

**Trade-off**: Slight duplication (validation happens in both `UnmarshalTaskConfig` and `ValidateTask`), but marked as "redundant validation kept for backwards compatibility" in comments.

### Why Keep Redundant Validation in ValidateTask?

**Decision**: Keep `ValidateTaskConfig()` call in `ValidateTask()` even though `UnmarshalTaskConfig()` now validates.

**Rationale**:
- Backwards compatibility (callers may expect this pattern)
- Defense in depth (extra safety layer)
- Comment clearly marks it as redundant
- Minimal performance impact (validation is fast)

### Why Not Make YAML Parser Strict?

**Decision**: Fix test to use malformed YAML instead of enabling strict parsing.

**Rationale**:
- Test name says "InvalidYAML" - should test YAML parsing, not extra fields
- YAML parsers are typically lenient by design
- Strict parsing would require changes to zigflow loader
- Extra fields being ignored is acceptable behavior for forward compatibility

## Validation Flow After Changes

```
User provides WorkflowTask proto
    ↓
ValidateTask(task)
    ↓
UnmarshalTaskConfig(task.Kind, task.TaskConfig)
    ↓
    1. Struct → JSON → Typed Proto
    2. ValidateTaskConfig(protoMsg)  ← NEW: Validation added here
    3. Return validated proto
    ↓
[Validation already done]
ValidateTaskConfig(msg)  ← Redundant, but kept for compatibility
    ↓
    Run protovalidate rules
    ↓
    Format violations as ValidationErrors
    ↓
    Add task name + kind context
    ↓
Return with full context
```

## Impact

**User Impact**: None (internal test quality improvement)

**Developer Impact**:
- ✅ Validation tests pass reliably
- ✅ Better error messages with task context
- ✅ Invalid configs caught earlier in the flow
- ✅ Test suite accurately validates malformed YAML

**Code Quality**:
- ✅ Validation happens at unmarshal (fail-fast)
- ✅ Consistent error context across all code paths
- ✅ Tests accurately reflect expected behavior

## Testing

Ran `make test-workflow-runner` multiple times to verify:

1. All validation tests pass consistently
2. Error messages include task name and kind
3. Invalid configs are rejected during unmarshal
4. Valid configs pass through cleanly
5. YAML parsing errors are caught properly

## Future Considerations

**Task Builder Failures** (not addressed in this fix):
- `TestForTaskBuilderIterator` - nil pointer dereference in for-loop
- `TestSwitchTaskBuilderExecutesMatchingCase` - assertion failure

These are separate runtime errors in the zigflow task builders (different category from validation). Will be addressed separately.

**Potential Improvements**:
- Consider removing redundant validation in `ValidateTask()` once callers are verified
- Add proto validation rule documentation for common patterns
- Consider strict YAML mode for explicitly typed workflows

## Related

- Validation package: `backend/services/workflow-runner/pkg/validation/`
- Proto validation: Uses buf.build protovalidate library
- Error types: `ValidationErrors` struct with field paths and messages
- Test categories: Validation vs Task Builder failures
