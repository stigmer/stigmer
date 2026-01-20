# Fix: Workflow Runner Timeout Validation Test Failures

**Date**: 2026-01-20  
**Category**: Test Quality  
**Scope**: `backend/services/workflow-runner`

## Summary

Fixed two failing test cases in `TestUnmarshalHttpCallTaskConfig` that were failing due to missing `timeout_seconds` field validation. Tests were using default value of `0`, which now fails validation requiring values between 1-300.

## Problem

After running `make test-workflow-runner`, discovered 5 categories of test failures. Focused on fixing the timeout validation failures first.

**Failing tests:**
- `TestUnmarshalHttpCallTaskConfig/valid_config`
- `TestUnmarshalHttpCallTaskConfig/nested_endpoint_structure`

**Error:**
```
validation failed: validation failed for task '' (): 
  field 'timeout_seconds' value must be greater than or equal to 1 and less than or equal to 300
```

**Root cause:** Test cases were not providing a `timeout_seconds` value, defaulting to `0`, which violates the validation rule requiring values between 1-300 seconds.

## Solution

Added valid `timeout_seconds` values to both failing HTTP call task config test cases:

**Changes to `backend/services/workflow-runner/pkg/validation/unmarshal_test.go`:**

1. **`valid_config` test case:**
   - Added `"timeout_seconds": 30` to config struct
   - Represents a reasonable default timeout for HTTP calls

2. **`nested_endpoint_structure` test case:**
   - Added `"timeout_seconds": 60` to config struct
   - Demonstrates a longer timeout for potentially slower endpoints

## Verification

Ran tests to confirm fix:
```bash
cd backend/services/workflow-runner
go test -v -race -timeout 30s ./pkg/validation -run TestUnmarshalHttpCallTaskConfig
```

**Result:** Both test cases now pass ✓

## Remaining Test Failures

After this fix, 4 test failure categories remain:
1. `TestValidateTask/invalid_HTTP_task_fails_with_context` - Error message format issue
2. `TestForTaskBuilderIterator` - Nil pointer dereference
3. `TestSwitchTaskBuilderExecutesMatchingCase` - Boolean assertion failure
4. `TestValidateStructureActivity_InvalidYAML` - Validation should fail but doesn't

These will be addressed in separate focused fixes.

## Impact

**Test Quality:**
- ✅ Reduced test failures from 5 categories to 4
- ✅ Tests now align with validation rules
- ✅ HTTP call task configs now use realistic timeout values

**No user-facing changes** - Internal test quality improvement only.

## Files Modified

- `backend/services/workflow-runner/pkg/validation/unmarshal_test.go`

## Test Results

**Before:**
```
FAIL: TestUnmarshalHttpCallTaskConfig (2 sub-tests failed)
```

**After:**
```
PASS: TestUnmarshalHttpCallTaskConfig (all sub-tests passing)
```
