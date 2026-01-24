# Fix Workflow Validation Tests

**Date**: 2026-01-24  
**Type**: Test Quality Improvement  
**Scope**: SDK Workflow Tests  
**Status**: ✅ Complete

## Summary

Fixed all validation error tests in the workflow package by aligning test expectations with actual proto validation rules. All 5 test suites with 13 sub-tests now pass, eliminating 8 test failures.

## Problem

The workflow edge case tests were failing because they expected invalid configurations to pass validation. The tests were written to test edge cases, but the buf.validate proto validation rules correctly rejected these invalid configurations.

### Root Cause

Tests had incorrect expectations (`wantErr: false`) for configurations that validation rules correctly reject:
- Empty tasks slices (validation requires ≥1 task)
- Nil task configs (explicitly rejected)
- Empty namespaces (required field)
- Zero or excessive timeout values (must be 1-300)
- Empty required fields (variables, message)
- Duplicate environment variable names (map deduplication)

## Solution

### Approach

Updated test expectations to match validation behavior:
1. **Expect errors for invalid cases** - Changed `wantErr: false` to `wantErr: true` for configurations that should fail
2. **Provide valid values for valid cases** - Added missing required fields (timeouts, etc.)
3. **Fix duplicate names** - Changed from modulo-based naming to sequential unique names
4. **Split tests for clarity** - Separated valid and invalid cases into distinct sub-tests

### Tests Fixed

#### 1. TestWorkflowToProto_NilFields (4 sub-tests)

**Changed expectations**:
- ✅ `nil environment variables` - Already correct (passes)
- ✅ `empty tasks slice` - Now expects error (requires ≥1 task)
- ✅ `nil task config` - Now expects error (nil explicitly rejected)
- ✅ `empty string fields` - Now expects error (namespace required)

```go
// Before: Expected all to pass
wantErr: false

// After: Correct expectations
{name: "empty tasks slice", wantErr: true},    // Validation requires ≥1 task
{name: "nil task config", wantErr: true},      // Nil config explicitly rejected  
{name: "empty string fields", wantErr: true},  // Namespace is required
```

#### 2. TestWorkflowToProto_MaximumFields

**Fixed duplicate environment variables**:
- Changed from modulo-based names (only 10 unique) to sequential names (50 unique)
- Changed task names similarly for uniqueness

```go
// Before: Only creates 10 unique env vars due to modulo
environment.WithName("ENV_VAR_"+string(rune('0'+i%10)))

// After: Creates 50 unique env vars
environment.WithName(fmt.Sprintf("ENV_VAR_%d", i))
```

**Result**: Test now correctly validates 50 unique environment variables and 100 unique tasks.

#### 3. TestWorkflowToProto_EmptyMaps (Split into 2 sub-tests)

**Restructured for clarity**:
- ✅ `empty variables in SET task` - Expects error (SET requires ≥1 variable)
- ✅ `empty headers in HTTP task` - Passes (headers are optional, added valid timeout)

```go
// Before: Single test expecting both to pass
Tasks: []*Task{emptyVars, emptyHeaders}

// After: Separate sub-tests with correct expectations
{name: "empty variables in SET task", wantErr: true},    // SET needs variables
{name: "empty headers in HTTP task", wantErr: false},   // Headers optional
```

#### 4. TestWorkflowToProto_HttpCallEdgeCases (6 sub-tests, 4 new)

**Added comprehensive timeout validation tests**:
- ✅ `zero_timeout` - Expects error (proto requires timeout ≥1)
- ✅ `minimum_valid_timeout` - New test, timeout=1 (passes)
- ✅ `maximum_valid_timeout` - New test, timeout=300 (passes)
- ✅ `very_large_timeout` - Expects error (proto requires timeout ≤300)
- ✅ `many_headers` - Added valid timeout (passes)
- ✅ `very_long_URI` - Added valid timeout (passes)

```go
// Added boundary tests
{name: "minimum_valid_timeout", config: {TimeoutSeconds: 1}, wantErr: false},
{name: "maximum_valid_timeout", config: {TimeoutSeconds: 300}, wantErr: false},

// Fixed invalid cases to expect errors
{name: "zero_timeout", config: {TimeoutSeconds: 0}, wantErr: true},
{name: "very_large_timeout", config: {TimeoutSeconds: 86400}, wantErr: true},
```

#### 5. TestWorkflowToProto_AgentCallEdgeCases (3 sub-tests)

**Fixed empty message expectation**:
- ✅ `very_long_message` - Already correct (passes)
- ✅ `agent_with_special_characters` - Already correct (passes)
- ✅ `empty_message` - Now expects error (message is required)

```go
// Before: Expected empty message to pass
{name: "empty message", wantErr: false}

// After: Correctly expects error
{name: "empty message", config: {Message: ""}, wantErr: true}
```

## Files Changed

```
sdk/go/workflow/edge_cases_test.go
  - Added fmt import for Sprintf
  - Fixed TestWorkflowToProto_NilFields expectations (3 changed to wantErr: true)
  - Fixed TestWorkflowToProto_MaximumFields unique naming (env vars + tasks)
  - Restructured TestWorkflowToProto_EmptyMaps into sub-tests
  - Enhanced TestWorkflowToProto_HttpCallEdgeCases (4 new sub-tests)
  - Fixed TestWorkflowToProto_AgentCallEdgeCases empty message expectation
```

## Test Results

**Before**:
```
❌ TestWorkflowToProto_NilFields (3 sub-failures)
❌ TestWorkflowToProto_MaximumFields (expected 50, got 10 env vars)
❌ TestWorkflowToProto_EmptyMaps (1 failure)
❌ TestWorkflowToProto_HttpCallEdgeCases (4 sub-failures)
❌ TestWorkflowToProto_AgentCallEdgeCases (1 sub-failure)

Total: 8 test failures across 5 test suites
```

**After**:
```bash
✅ TestWorkflowToProto_NilFields (0.04s)
    ✅ nil_environment_variables (0.04s)
    ✅ empty_tasks_slice (0.00s)
    ✅ nil_task_config (0.00s)
    ✅ empty_string_fields (0.00s)
✅ TestWorkflowToProto_MaximumFields (0.01s)
✅ TestWorkflowToProto_EmptyMaps (0.02s)
    ✅ empty_variables_in_SET_task (0.00s)
    ✅ empty_headers_in_HTTP_task (0.02s)
✅ TestWorkflowToProto_HttpCallEdgeCases (0.00s)
    ✅ zero_timeout (0.00s)
    ✅ minimum_valid_timeout (0.00s)
    ✅ maximum_valid_timeout (0.00s)
    ✅ very_large_timeout (0.00s)
    ✅ many_headers (0.00s)
    ✅ very_long_URI (0.00s)
✅ TestWorkflowToProto_AgentCallEdgeCases (0.02s)
    ✅ very_long_message (0.02s)
    ✅ agent_with_special_characters (0.00s)
    ✅ empty_message (0.00s)

Total: 0 failures, all 13 sub-tests passing ✅
```

## Validation Rules Confirmed

These proto validation rules are now properly tested:

1. **Workflow level**:
   - `spec.tasks` must contain ≥1 item
   - `spec.document.namespace` is required

2. **Task level**:
   - Task config cannot be nil

3. **SET task**:
   - `variables` map must have ≥1 entry

4. **HTTP_CALL task**:
   - `timeout_seconds` must be ≥1 and ≤300
   - `headers` map is optional (can be empty)

5. **AGENT_CALL task**:
   - `message` field is required (non-empty)

## Impact

### Immediate

- ✅ All validation error tests now pass
- ✅ Tests correctly validate edge cases with proper expectations
- ✅ Test suite demonstrates proper validation behavior

### Quality Improvements

- **Better test documentation**: Tests now clearly show what should pass vs fail
- **Clearer edge case coverage**: Boundary conditions (min/max timeouts) explicitly tested
- **Unique naming patterns**: Demonstrates correct approach for generating test data
- **No false positives**: Tests don't expect invalid configs to pass

## Remaining Test Failures

**Other categories** (not addressed in this work):

1. **Concurrency/Race conditions** (2 tests):
   - `TestAgent_ConcurrentSkillAddition` - Data race in skill addition
   - `TestWorkflow_ConcurrentTaskAddition` - Data race in task addition

2. **Dependency tracking** (1 test):
   - `TestIntegration_DependencyTracking` - Missing dependency tracking functionality

3. **Example integration** (1 test):
   - `TestExample13_WorkflowAndAgentSharedContext` - Validation error in example

These require different fix approaches (concurrency synchronization, feature implementation, example updates).

## Learnings

### Test Design Principles

1. **Align expectations with validation**: Tests should expect errors for invalid configurations
2. **Test boundaries explicitly**: Min/max values should have dedicated test cases
3. **Use unique identifiers**: Avoid modulo patterns that create duplicates
4. **Separate valid/invalid cases**: Use sub-tests for clarity
5. **Add comments explaining expectations**: Help future developers understand test intent

### Validation Testing Best Practices

```go
// ✅ GOOD: Clear expectation with explanation
{
    name: "zero_timeout",
    config: &HttpCallTaskConfig{TimeoutSeconds: 0},
    wantErr: true, // Proto validation requires timeout_seconds >= 1
}

// ❌ BAD: Unclear expectation without context
{
    name: "zero_timeout",
    config: &HttpCallTaskConfig{TimeoutSeconds: 0},
    wantErr: false, // Wrong expectation
}
```

## Technical Decisions

### Why Fix Test Expectations Instead of Validation?

The validation rules are **correct** - they enforce:
- Required fields (namespace, message)
- Minimum task counts (≥1)
- Valid ranges (timeout 1-300 seconds)
- Non-nil configs

The tests had incorrect expectations. Fixing the tests aligns them with the correct validation behavior.

### Why Split Some Tests into Sub-tests?

For clarity and precision:
- `TestWorkflowToProto_EmptyMaps` split into valid (empty headers) and invalid (empty variables) cases
- `TestWorkflowToProto_HttpCallEdgeCases` expanded to explicitly test boundaries

This makes test intent clearer and failure diagnosis easier.

## Documentation

- **This Changelog**: Comprehensive record of test fixes
- **Test Comments**: Added inline explanations for test expectations
- **No product documentation needed**: Internal test quality improvement only

## Next Steps

**Recommended order for remaining test fixes**:

1. Fix `TestExample13_WorkflowAndAgentSharedContext` (validation error)
2. Address concurrency tests (requires mutex/synchronization)
3. Investigate dependency tracking (may require feature implementation)

---

**Work Status**: ✅ Complete  
**Category**: Test Quality Improvement (Validation Errors)  
**Test Result**: All validation error tests passing
