# BUG: Task Export Overwrites Context Instead of Merging

## Summary

Task exports currently **replace** the entire workflow context instead of **adding task results under the task name as a key**. This breaks multi-task workflows where later tasks reference earlier task outputs.

## Root Cause

**File:** `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_do.go:402`

```go
func (t *DoTaskBuilder) processTaskExport(task workflowFunc, taskOutput any, state *utils.State) error {
    // ...
    state.Context = export  // ❌ REPLACES entire context
    // ...
}
```

## Expected Behavior

When a task exports its output, it should be **added to context** under the task name as a key:

```yaml
# YAML
- fetch-pr:
    export:
        as: ${.}
- fetch-diff:
    endpoint:
        uri: ${ $context["fetch-pr"].diff_url }
```

**Expected context after `fetch-pr`:**
```json
{
  "fetch-pr": {
    "diff_url": "https://...",
    "title": "...",
    ...
  }
}
```

## Actual Behavior

Context gets **replaced** by each task's export:

```go
state.Context = <HTTP response>  // Context IS the response, not a map
```

**Actual context after `fetch-pr`:**
```json
{
  "diff_url": "https://...",
  "title": "...",
  ...
}
```

So `$context["fetch-pr"]` returns `nil` because context doesn't have a `"fetch-pr"` key!

## Error Manifests As

```
expression evaluation returned nil for: ${ $context["fetch-pr"].diff_url }
```

Even though:
- The expression syntax is valid
- The `fetch-pr` task completed successfully
- The HTTP response contains `diff_url`

The problem is that `$context` doesn't contain task results organized by task name.

## Fix Required

**Option 1: Merge under task name (recommended)**

```go
func (t *DoTaskBuilder) processTaskExport(task workflowFunc, taskOutput any, state *utils.State) error {
    taskBase := task.GetTask().GetBase()
    
    if taskBase.Export == nil {
        return nil
    }
    
    export, err := utils.TraverseAndEvaluateObj(taskBase.Export.As, taskOutput, state)
    if err != nil {
        return err
    }
    
    if err := swUtil.ValidateSchema(export, taskBase.Export.Schema, task.Name); err != nil {
        return err
    }
    
    // ✅ Merge into context under task name
    if state.Context == nil {
        state.Context = make(map[string]any)
    }
    
    contextMap, ok := state.Context.(map[string]any)
    if !ok {
        // Context is not a map, create new map with existing context
        contextMap = map[string]any{
            "__previous_context": state.Context,
        }
    }
    
    contextMap[task.Name] = export
    state.Context = contextMap
    
    return nil
}
```

**Option 2: Use Data instead of Context**

Alternatively, don't use Context at all - use Data (which already stores by task name):

```yaml
# Users would reference: $data instead of $context
uri: ${ $data["fetch-pr"].diff_url }
```

This would require minimal code changes since `state.Data` already works correctly.

## Impact

**Affects:** Any workflow with multiple tasks where later tasks reference earlier task outputs via `$context`.

**Currently Broken:**
- ✅ SDK generates correct bracket notation: `$context["task-name"].field`
- ✅ YAML is valid
- ❌ Runtime doesn't populate context correctly

**Workaround:** None currently. Users cannot build multi-step workflows that reference prior task outputs.

## Test Case

```yaml
do:
  - fetch-pr:
      call: http
      export:
          as: ${.}
      with:
          endpoint:
              uri: https://api.github.com/repos/owner/repo/pulls/1
          method: GET
  
  - use-pr-data:
      call: http
      with:
          endpoint:
              # This should work but currently returns nil
              uri: ${ $context["fetch-pr"].diff_url }
          method: GET
```

**Expected:** `use-pr-data` receives the diff_url from `fetch-pr`
**Actual:** Error - `expression evaluation returned nil`

## Related Files

- `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_do.go:386-405`
- `backend/services/workflow-runner/pkg/utils/state.go:28-36,144-150`
- `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder.go:111-115`
- `sdk/go/workflow/task.go:86-90` (SDK bracket notation - correct)

## Priority

**HIGH** - Blocks multi-task workflows, which are a core use case.

## Notes

- The SDK's bracket notation change (`$context["task-name"]`) was correct
- The validation requiring kebab-case names is correct
- The bug is entirely in the runtime export handling
- Fixing this will enable all the example workflows to work properly
