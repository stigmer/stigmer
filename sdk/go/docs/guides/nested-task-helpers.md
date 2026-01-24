# Guide: Type-Safe Helpers for Nested Tasks

Type-safe helper functions for defining tasks within Try/Catch, Fork, and For control flow blocks.

## Why These Helpers Exist

When defining workflows with error handling (Try/Catch), parallel execution (Fork), or loops (For), you need to specify what tasks should execute within those blocks. Without helpers, you'd need to manually construct complex map structures prone to typos and without compile-time checking.

These helpers provide:
- ✅ **Type safety**: Compile-time checking catches errors
- ✅ **IDE support**: Autocomplete and refactoring
- ✅ **Consistency**: Same pattern across all control flow types
- ✅ **Clarity**: Explicit function names vs magic maps

## Quick Reference

| Control Flow | Helper Function | Purpose |
|--------------|----------------|---------|
| **For loops** | `LoopBody(fn)` | Define tasks for each iteration |
| **Try blocks** | `TryBody(tasks...)` | Define tasks to attempt |
| **Catch blocks** | `CatchBody(errorVar, tasks...)` | Define error handlers |
| **Fork branches** | `ForkBranch(name, tasks...)` | Define single parallel branch |
| **Fork args** | `ForkBranches(branches...)` | Combine multiple branches |

## LoopBody - For Iteration

Creates type-safe loop bodies with access to the current item.

### Signature

```go
func LoopBody(fn func(LoopVar) []*Task) []*types.WorkflowTask
```

### Usage

```go
wf.ForEach("processItems", &workflow.ForArgs{
    In: fetchTask.Field("items"),
    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.Set("process", &workflow.SetArgs{
                Variables: map[string]string{
                    "id":   item.Field("id"),      // Type-safe field access
                    "name": item.Field("name"),
                    "value": item.Value(),         // Reference entire item
                },
            }),
        }
    }),
})
```

### LoopVar Methods

- `item.Field("fieldName")` - Access field: `"${.item.fieldName}"`
- `item.Value()` - Reference entire item: `"${.item}"`

## TryBody - Error Handling Attempts

Converts SDK tasks to the format needed for Try blocks.

### Signature

```go
func TryBody(tasks ...*Task) []*types.WorkflowTask
```

### Usage

```go
wf.Try("attemptAPICall", &workflow.TryArgs{
    Try: workflow.TryBody(
        wf.HttpGet("fetchData",
            "https://api.example.com/data",
            map[string]string{"Accept": "application/json"},
        ),
        wf.Set("processData", &workflow.SetArgs{
            Variables: map[string]string{
                "status": "success",
            },
        }),
    ),
    Catch: workflow.CatchBody("error",
        wf.Set("handleError", &workflow.SetArgs{
            Variables: map[string]string{
                "error_msg": "${.error.message}",
                "failed_at": "${.error.timestamp}",
            },
        }),
    ),
})
```

### Benefits Over Raw Maps

**Before** (error-prone):
```go
Try: []*types.WorkflowTask{
    {
        Name: "task1",
        Kind: "HTTP_CALL",  // Magic strings
        TaskConfig: map[string]interface{}{...},  // Manual construction
    },
}
```

**After** (type-safe):
```go
Try: workflow.TryBody(
    wf.HttpGet("task1", url, headers),  // IDE autocomplete, compile-time checks
)
```

## CatchBody - Error Handlers

Creates catch blocks that execute when errors occur in Try blocks.

### Signature

```go
func CatchBody(errorVar string, tasks ...*Task) *types.CatchBlock
```

### Parameters

- `errorVar`: Variable name to store caught error (accessible as `${.errorVar}`)
- `tasks`: Tasks to execute when error is caught

### Usage

```go
Catch: workflow.CatchBody("error",
    wf.Set("logError", &workflow.SetArgs{
        Variables: map[string]string{
            "message": "${.error.message}",     // Access error fields
            "timestamp": "${.error.timestamp}",
            "retryable": "true",
        },
    }),
    wf.Set("notifyTeam", &workflow.SetArgs{
        Variables: map[string]string{
            "alert": "API call failed",
            "details": "${.error}",  // Full error object
        },
    }),
)
```

### Error Variable Access

When you specify `errorVar` (e.g., "error"), the caught error is accessible in subsequent tasks:

- `${.error.message}` - Error message
- `${.error.timestamp}` - When error occurred
- `${.error.code}` - Error code/type
- `${.error}` - Entire error object

## ForkBranch - Parallel Execution

Creates a single branch for parallel execution in Fork tasks.

### Signature

```go
func ForkBranch(name string, tasks ...*Task) *types.ForkBranch
```

### Parameters

- `name`: Branch identifier (used in output: `${context.forkTask.branches.branchName}`)
- `tasks`: Tasks to execute in this branch (in parallel with other branches)

### Usage

```go
wf.Fork("fetchAllData", &workflow.ForkArgs{
    Branches: workflow.ForkBranches(
        workflow.ForkBranch("fetchUsers",
            wf.HttpGet("getUsers",
                "https://api.example.com/users",
                map[string]string{"Accept": "application/json"},
            ),
        ),
        workflow.ForkBranch("fetchPosts",
            wf.HttpGet("getPosts",
                "https://api.example.com/posts",
                map[string]string{"Accept": "application/json"},
            ),
        ),
        workflow.ForkBranch("fetchComments",
            wf.HttpGet("getComments",
                "https://api.example.com/comments",
                map[string]string{"Accept": "application/json"},
            ),
        ),
    ),
})
```

### Accessing Branch Results

After a Fork task completes, access each branch's results:

```go
wf.Set("mergeResults", &workflow.SetArgs{
    Variables: map[string]string{
        "users":    "${context.fetchAllData.branches.fetchUsers.data}",
        "posts":    "${context.fetchAllData.branches.fetchPosts.data}",
        "comments": "${context.fetchAllData.branches.fetchComments.data}",
    },
})
```

## ForkBranches - Combine Branches

Convenience function to combine multiple fork branches into a slice.

### Signature

```go
func ForkBranches(branches ...*types.ForkBranch) []*types.ForkBranch
```

### Usage

Always used with `ForkBranch()`:

```go
Branches: workflow.ForkBranches(
    workflow.ForkBranch("branch1", task1),
    workflow.ForkBranch("branch2", task2),
    workflow.ForkBranch("branch3", task3),
)
```

## Complete Example: Resilient API with Error Handling

Real-world example combining Try/Catch with Switch for decision logic:

```go
err := stigmer.Run(func(ctx *stigmer.Context) error {
    apiBase := ctx.SetString("apiBase", "https://api.github.com")
    
    wf, err := workflow.New(ctx,
        workflow.WithNamespace("resilient-workflows"),
        workflow.WithName("resilient-api-call"),
        workflow.WithVersion("1.0.0"),
    )
    if err != nil {
        return err
    }
    
    // Try to fetch data with automatic error handling
    tryTask := wf.Try("attemptGitHubCall", &workflow.TryArgs{
        Try: workflow.TryBody(
            wf.HttpGet("fetchPR",
                apiBase.Concat("/repos/stigmer/hello-stigmer/pulls/1"),
                map[string]string{
                    "Accept":     "application/vnd.github.v3+json",
                    "User-Agent": "Stigmer-SDK",
                },
            ),
        ),
        Catch: workflow.CatchBody("error",
            wf.Set("handleError", &workflow.SetArgs{
                Variables: map[string]string{
                    "error_msg":  "${.error.message}",
                    "timestamp":  "${.error.timestamp}",
                    "retryable":  "true",
                },
            }),
        ),
    })
    
    // Check result and take action
    success := tryTask.Field("success")
    wf.Switch("checkRetry", &workflow.SwitchArgs{
        Cases: []*types.SwitchCase{
            {
                Name: "success",
                When: success.Equals(true),   // Fluent API
                Then: "processSuccess",
            },
            {
                Name: "failure",
                When: success.Equals(false),
                Then: "logFailure",
            },
        },
    })
    
    // Success path
    wf.Set("processSuccess", &workflow.SetArgs{
        Variables: map[string]string{
            "pr_title":  tryTask.Field("title").Expression(),
            "pr_state":  tryTask.Field("state").Expression(),
            "status":    "completed",
        },
    })
    
    // Failure path
    wf.Set("logFailure", &workflow.SetArgs{
        Variables: map[string]string{
            "status": "failed",
            "reason": tryTask.Field("error").Expression(),
        },
    })
    
    return nil
})
```

## Complete Example: Parallel GitHub API Calls

Fetch multiple GitHub endpoints in parallel using Fork:

```go
err := stigmer.Run(func(ctx *stigmer.Context) error {
    apiBase := ctx.SetString("apiBase", "https://api.github.com/repos/stigmer/hello-stigmer")
    
    wf, err := workflow.New(ctx,
        workflow.WithNamespace("parallel-processing"),
        workflow.WithName("parallel-data-fetch"),
        workflow.WithVersion("1.0.0"),
    )
    if err != nil {
        return err
    }
    
    // Execute three API calls in parallel
    wf.Fork("fetchAllGitHubData", &workflow.ForkArgs{
        Branches: workflow.ForkBranches(
            workflow.ForkBranch("fetchPullRequests",
                wf.HttpGet("getPulls",
                    apiBase.Concat("/pulls"),
                    map[string]string{
                        "Accept":     "application/vnd.github.v3+json",
                        "User-Agent": "Stigmer-SDK",
                    },
                ),
            ),
            workflow.ForkBranch("fetchIssues",
                wf.HttpGet("getIssues",
                    apiBase.Concat("/issues"),
                    map[string]string{
                        "Accept":     "application/vnd.github.v3+json",
                        "User-Agent": "Stigmer-SDK",
                    },
                ),
            ),
            workflow.ForkBranch("fetchCommits",
                wf.HttpGet("getCommits",
                    apiBase.Concat("/commits"),
                    map[string]string{
                        "Accept":     "application/vnd.github.v3+json",
                        "User-Agent": "Stigmer-SDK",
                    },
                ),
            ),
        ),
    })
    
    // Merge results from all parallel calls
    wf.Set("mergeResults", &workflow.SetArgs{
        Variables: map[string]string{
            "pulls":   "${context.fetchAllGitHubData.branches.fetchPullRequests.data}",
            "issues":  "${context.fetchAllGitHubData.branches.fetchIssues.data}",
            "commits": "${context.fetchAllGitHubData.branches.fetchCommits.data}",
            "status":  "merged",
        },
    })
    
    return nil
})
```

## Pattern Summary

All helper functions follow the same pattern:

1. **Accept SDK tasks** (`*workflow.Task`) - Created with `wf.HttpGet()`, `wf.Set()`, etc.
2. **Return proto-compatible types** - `[]*types.WorkflowTask`, `*types.CatchBlock`, `*types.ForkBranch`
3. **Enable type-safe composition** - Compile-time checks, IDE support
4. **Eliminate magic strings** - No manual map construction

### Consistent API Across Control Flow

```go
// Loops - Type-safe iteration
Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
    return []*workflow.Task{wf.Set(...)}
})

// Try/Catch - Type-safe error handling
Try: workflow.TryBody(wf.HttpGet(...), wf.Set(...))
Catch: workflow.CatchBody("error", wf.Set(...))

// Fork - Type-safe parallel execution
Branches: workflow.ForkBranches(
    workflow.ForkBranch("branch1", wf.HttpGet(...)),
    workflow.ForkBranch("branch2", wf.Set(...)),
)
```

## Migration from Raw Maps

If you have existing code using raw maps, migration is straightforward:

### Try/Catch Migration

**Old API**:
```go
wf.Try("attempt", &workflow.TryArgs{
    Tasks: []map[string]interface{}{  // Error-prone
        {
            "httpCall": map[string]interface{}{
                "method": "GET",
                "uri":    url,
            },
        },
    },
    Catch: []map[string]interface{}{  // No type checking
        {
            "as": "error",
            "tasks": []interface{}{...},
        },
    },
})
```

**New API**:
```go
wf.Try("attempt", &workflow.TryArgs{
    Try: workflow.TryBody(  // Type-safe
        wf.HttpGet("fetch", url, headers),
    ),
    Catch: workflow.CatchBody("error",  // Compile-time checked
        wf.Set("handleError", &workflow.SetArgs{...}),
    ),
})
```

### Fork Migration

**Old API**:
```go
wf.Fork("parallel", &workflow.ForkArgs{
    Branches: []map[string]interface{}{  // No compile-time checks
        {
            "name": "branch1",
            "tasks": []interface{}{
                map[string]interface{}{"httpCall": ...},
            },
        },
    },
})
```

**New API**:
```go
wf.Fork("parallel", &workflow.ForkArgs{
    Branches: workflow.ForkBranches(  // Type-safe
        workflow.ForkBranch("branch1",
            wf.HttpGet("task1", url, headers),
        ),
    ),
})
```

## Full Working Examples

Complete, runnable examples demonstrating these helpers:

- **Example 09**: `sdk/go/examples/09_workflow_with_loops.go` - LoopBody usage
- **Example 10**: `sdk/go/examples/10_workflow_with_error_handling.go` - TryBody/CatchBody usage
- **Example 11**: `sdk/go/examples/11_workflow_with_parallel_execution.go` - ForkBranch/ForkBranches usage

All examples use real GitHub APIs (no authentication required) and can be run directly:

```bash
cd sdk/go/examples
go run 10_workflow_with_error_handling.go
go run 11_workflow_with_parallel_execution.go
```

## Related Documentation

- [API Reference](../api-reference.md) - Complete API documentation
- [Getting Started](../getting-started.md) - SDK basics
- [Workflow Package](../../workflow/) - Source code and additional docs

---

**Status**: ✅ Stable API  
**Since**: v0.x.x (January 2026)
