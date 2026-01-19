# Fix: Workflow Runner RunTask Expression Evaluation

**Date**: 2026-01-20  
**Component**: Workflow Runner  
**Impact**: Test Failures → Passing Tests  
**Scope**: Expression Evaluation System

## Problem

The workflow-runner test suite had 2 failing tests related to `RunTask` expression evaluation:

```
TestRunTaskBuilderRunScriptExecutesActivity - FAILED
TestRunTaskBuilderRunShellExecutesActivity - FAILED
```

**Error**: `unsupported task type for expression evaluation: *model.RunTask`

The `evaluateTaskArguments()` function in `task_builder.go` only handled `CallHTTP` and `CallGRPC` task types, but `RunTask` (used for script and shell execution) was missing from the type switch. When script or shell tasks tried to execute activities, they called `evaluateTaskArguments()` which fell through to the default case and returned an error.

## Root Cause

The expression evaluation system was incomplete:

1. **`task_builder.go`** - Type switch in `evaluateTaskArguments()` only had cases for:
   - `*model.CallHTTP`
   - `*model.CallGRPC`
   - Missing: `*model.RunTask`

2. **`task_builder_run.go`** - `executeCommand()` method called `evaluateTaskArguments()` for script/shell tasks, but there was no evaluation logic for RunTask fields

3. **Impact**: Script and shell tasks couldn't evaluate runtime expressions in:
   - Script inline code
   - Shell commands
   - Arguments (for both)
   - Environment variables (for both)

## Solution Implemented

### 1. Added RunTask Case to Expression Evaluation (`task_builder.go`)

```go
case *model.RunTask:
    // Run tasks: evaluate script/shell commands, arguments, environment
    if err := evaluateRunTaskExpressions(ctx, task, state); err != nil {
        return d.task, fmt.Errorf("error evaluating Run task expressions: %w", err)
    }
    logger.Debug("Run task expressions evaluated successfully", "task", d.name)
    return any(task).(T), nil
```

Updated comment from "only CallHTTP and CallGRPC" to "CallHTTP, CallGRPC, and RunTask use executeActivity()".

### 2. Created RunTask Expression Evaluation Functions (`task_builder_run.go`)

**Main evaluation function**:
```go
func evaluateRunTaskExpressions(ctx workflow.Context, task *model.RunTask, state *utils.State) error
```

Handles both script and shell task fields:

**For Script Tasks**:
- `InlineCode` - Evaluates runtime expressions in script code
- `Arguments` - Evaluates runtime expressions in script arguments
- `Environment` - Evaluates runtime expressions in environment variables

**For Shell Tasks**:
- `Command` - Evaluates runtime expressions in shell command
- `Arguments` - Evaluates runtime expressions in shell arguments  
- `Environment` - Evaluates runtime expressions in environment variables

**Helper functions created**:

```go
func evaluateRunArguments(args *model.RunArguments, state *utils.State) error
```
- Uses `utils.TraverseAndEvaluateObj()` on `args.Value`
- Handles both map and slice argument types
- Updates `RunArguments.Value` with evaluated values

```go
func evaluateEnvironmentVariables(env map[string]string, state *utils.State) error
```
- Iterates through environment variable map
- Checks each value for strict expressions (`model.IsStrictExpr()`)
- Evaluates and updates map values

### 3. Pattern Consistency

The implementation follows the same pattern as existing HTTP/gRPC evaluation:
- Uses direct field manipulation (not JSON marshal/unmarshal)
- Evaluates in workflow context (before activity execution)
- Prevents large state from being serialized with activity inputs
- Checks for strict expressions before evaluation
- Returns clear error messages

## Test Results

### Before Fix
```
❌ TestRunTaskBuilderRunScriptExecutesActivity - FAILED
   Error: unsupported task type for expression evaluation: *model.RunTask
   
❌ TestRunTaskBuilderRunShellExecutesActivity - FAILED
   Error: unsupported task type for expression evaluation: *model.RunTask
```

### After Fix
```
✅ TestRunTaskBuilderRunScriptExecutesActivity - PASSING
   - Evaluates script expressions successfully
   - Executes script activity
   - Returns expected results

✅ TestRunTaskBuilderRunShellExecutesActivity - PASSING  
   - Evaluates shell expressions successfully
   - Executes shell activity
   - Returns expected results
```

**Test output confirms**:
```
DEBUG Evaluating Run task expressions with direct field access
DEBUG Run task expressions evaluated successfully
```

## Files Modified

1. **`backend/services/workflow-runner/pkg/zigflow/tasks/task_builder.go`**
   - Added `case *model.RunTask:` to `evaluateTaskArguments()` type switch
   - Updated comment to include RunTask in supported types

2. **`backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_run.go`**
   - Added `evaluateRunTaskExpressions()` function
   - Added `evaluateRunArguments()` helper function
   - Added `evaluateEnvironmentVariables()` helper function

## Impact

### Fixed
- ✅ 2 failing tests now passing
- ✅ Script tasks can now evaluate expressions before execution
- ✅ Shell tasks can now evaluate expressions before execution
- ✅ Runtime expressions work correctly in commands, arguments, and environment

### Architecture
- Expression evaluation system now complete for all task types that use activities
- Consistent pattern across CallHTTP, CallGRPC, and RunTask
- Proper separation: evaluation in workflow context, execution in activities

### Remaining Test Failures (Not Addressed)
- `TestForTaskBuilderIterator` - Different issue (nil pointer in for loop)
- `TestSwitchTaskBuilderExecutesMatchingCase` - Different issue (switch logic)
- `TestValidationCatchesErrors/Invalid_DSL_version` - Different issue (error message case)
- `TestE2E_ValidationIntegration_InvalidConfig` - Different issue (validation)
- `TestGenerateYAMLActivity_Success` - Different issue (activity context)

## Why This Matters

**Runtime expression evaluation is critical** for dynamic workflow execution:

1. **Configuration from State**: Tasks can use workflow state to build commands/scripts
   ```
   run:
     shell:
       command: "${ .env.DEPLOY_SCRIPT }"
       arguments:
         - "${ .data.environment }"
   ```

2. **Security**: Secrets resolved just-in-time in activities (not in history)
3. **Flexibility**: Same workflow definition works across different environments
4. **Consistency**: All task types follow same evaluation pattern

Without this fix, RunTask couldn't leverage the expression evaluation system that CallHTTP and CallGRPC use, limiting workflow capabilities.

## Next Steps

This fix addressed 1 category of test failures (RunTask expression evaluation). 

**Remaining test failure categories** to investigate separately:
1. ForTask iterator (nil pointer dereference)
2. Switch task execution (assertion failure)  
3. Validation error messages (case sensitivity)
4. Converter validation (invalid config not rejected)
5. Activity context setup (test environment issue)

Each category requires separate analysis and fixes.

## Lessons

1. **Type switches must be exhaustive** - When adding new task types that use shared infrastructure (like `executeActivity()`), ensure all type switches account for them
2. **Follow existing patterns** - The HTTP/gRPC evaluation pattern provided a clear template
3. **Test-driven debugging** - Running specific failing tests helped isolate the issue quickly
4. **SDK structure matters** - Understanding `RunArguments.Value` structure was key to correct implementation
5. **One category at a time** - User's instruction to fix one category instead of all at once was wise - kept scope manageable and solution focused
