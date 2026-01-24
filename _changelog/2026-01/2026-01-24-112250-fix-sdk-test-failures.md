# Fix SDK Test Failures

**Date**: 2026-01-24  
**Type**: Test Quality  
**Scope**: SDK Go  
**Impact**: Medium

## Summary

Fixed 3 failing tests in the Stigmer Go SDK test suite by correcting test data generation patterns and improving validation error messages.

## What Changed

### 1. TestAgentToProto_MaximumEnvironmentVars - Environment Variable Name Uniqueness

**Problem**: Test created 100 environment variables but used only 10 unique names due to `i%10` modulo logic, resulting in name collisions.

**Root Cause**: The `convertEnvironmentVariables` function stores variables in a map using name as the key. Duplicate names overwrite each other, leaving only 10 unique variables instead of 100.

**Fix**: Changed test to generate 100 unique names using `fmt.Sprintf("ENV_VAR_%d", i)` instead of `string(rune('0'+i%10))`.

**File**: `sdk/go/agent/edge_cases_test.go`

**Before**:
```go
environment.WithName("ENV_VAR_"+string(rune('0'+i%10)))
// Creates: ENV_VAR_0 through ENV_VAR_9 (10 unique names repeated 10 times)
```

**After**:
```go
environment.WithName(fmt.Sprintf("ENV_VAR_%d", i))
// Creates: ENV_VAR_0 through ENV_VAR_99 (100 unique names)
```

**Result**: Test now correctly validates that 100 environment variables and 50 secrets are preserved.

### 2. TestIntegration_ManyResourcesStressTest - Name Validation Compliance

**Problem**: Test created names ending with hyphens (e.g., `"stress-skill-"`) when `i%10 == 0`, violating the validation rule that names must "start and end with alphanumeric characters".

**Root Cause**: `strings.Repeat("x", i%10)` generates empty strings when `i%10 == 0`, creating names like `"stress-agent-"` that fail validation.

**Fix**: Replaced `strings.Repeat` pattern with `fmt.Sprintf` to generate unique numeric suffixes for all resources.

**Files**: `sdk/go/integration_scenarios_test.go`

**Changes**:
- Skills: `"stress-skill-"+strings.Repeat("x", i%10)` → `fmt.Sprintf("stress-skill-%d", i)`
- Agents: `"stress-agent-"+strings.Repeat("x", i%10)` → `fmt.Sprintf("stress-agent-%d", i)`
- Workflows: `"stress-workflow-"+strings.Repeat("x", i%10)` → `fmt.Sprintf("stress-workflow-%d", i)`
- Tasks: `"task-"+string(rune('0'+j))` → `fmt.Sprintf("task-%d", j)`

**Result**: Test now creates 50 skills, 20 agents, and 10 workflows with valid names that comply with validation rules.

### 3. TestValidationError_ErrorMessage - Error Message Clarity

**Problem**: Test expected the word "invalid" in name validation errors to indicate the value is invalid, but error message only described the validation rule.

**Root Cause**: Validation error message was: `"name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric"` - descriptive but not explicit about invalidity.

**Fix**: Updated validation error message to include "invalid" prefix for clarity.

**File**: `sdk/go/agent/validation.go`

**Before**:
```go
"name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric"
```

**After**:
```go
"invalid name format: must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric"
```

**Result**: Error messages are now more explicit and user-friendly, clearly indicating when a name is invalid.

## Technical Details

### Environment Variable Map Deduplication

The `convertEnvironmentVariables` function uses a map to convert SDK environment variables to proto format:

```go
envData := make(map[string]*environmentv1.EnvironmentValue)
for _, v := range vars {
    envData[v.Name] = &environmentv1.EnvironmentValue{
        Value:       v.DefaultValue,
        IsSecret:    v.IsSecret,
        Description: v.Description,
    }
}
```

Maps in Go only keep unique keys. When duplicate keys are inserted, the last value wins. This is correct behavior for ensuring no duplicate environment variable names, but the test was incorrectly generating duplicates.

### Name Validation Rules

Agent, skill, and workflow names must match the regex:
```go
var nameRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$`)
```

Rules:
- Lowercase alphanumeric and hyphens only
- Must start with alphanumeric
- Must end with alphanumeric
- Cannot start or end with hyphen

## Testing

All three tests now pass:
```bash
✅ TestAgentToProto_MaximumEnvironmentVars
✅ TestIntegration_ManyResourcesStressTest
✅ TestValidationError_ErrorMessage (all 3 sub-tests)
```

## Impact

**Positive**:
- SDK test suite is more reliable
- Tests correctly validate intended behavior
- Error messages are clearer for users
- Test patterns use proper unique name generation

**Risk**: Low - test-only changes, no production code changes except error message improvement

## Lessons Learned

1. **Test Data Generation**: When testing collections, ensure test data has the uniqueness properties the production code expects
2. **Validation Rules**: Tests must generate data that complies with validation rules, not violate them
3. **Error Messages**: Include explicit keywords like "invalid" in error messages for better user experience and testability
4. **Map Behavior**: Remember that maps deduplicate by key - test data must account for this

## Follow-Up Work

None required. Tests are fixed and passing.

## Related Issues

Part of SDK test quality improvements. Other failing tests remain (data races, workflow edge cases) but are unrelated to these fixes.
