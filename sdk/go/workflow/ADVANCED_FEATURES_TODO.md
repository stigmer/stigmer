# Advanced Workflow Features - TODO (Post-MVP)

This document tracks the advanced workflow control flow features that need to be implemented in the Stigmer SDK.

## Current Status

✅ **Implemented (MVP Features)**
- Basic workflow creation with namespace/name/version
- HTTP tasks (GET, POST, PUT, PATCH, DELETE) via `HttpGet()`, `HttpPost()`, etc.
- SET tasks via `SetVars()` for variable assignment
- Task field references for implicit dependencies
- Typed context integration
- Environment variables
- Basic task chaining with implicit dependencies

⏳ **Not Yet Implemented (Post-MVP)**
- Switch/Case conditionals (Example 08)
- ForEach loops (Example 09)
- Try/Catch/Finally error handling (Example 10)
- Fork/Join parallel execution (Example 11)
- Explicit task dependencies with `DependsOn()`

---

## Feature 1: Switch/Case Conditionals

**Example Test:** `TestExample08_WorkflowWithConditionals` (currently skipped)

**Required Implementations:**

### 1.1 Workflow Method
```go
func (w *Workflow) Switch(name string, opts ...SwitchTaskOption) *Task
```
- Creates a SWITCH task that routes execution based on a condition
- Returns the switch task for further chaining

### 1.2 Switch Task Options
```go
// Core switch configuration
func SwitchOn(value interface{}) SwitchTaskOption
func DefaultCase(targetTaskName string) SwitchTaskOption

// Case builder
func Case(condition Condition, targetTaskName string) SwitchTaskOption
```

### 1.3 Condition Builders
```go
type Condition interface {
    Expression() string
}

// Comparison conditions
func Equals(value interface{}) Condition
func NotEquals(value interface{}) Condition
func GreaterThan(value interface{}) Condition
func LessThan(value interface{}) Condition
func GreaterThanOrEqual(value interface{}) Condition
func LessThanOrEqual(value interface{}) Condition

// Logical conditions
func And(conditions ...Condition) Condition
func Or(conditions ...Condition) Condition
func Not(condition Condition) Condition
```

### 1.4 Task Dependency Support
```go
// Allow explicit dependencies (for tasks after switch branches)
func (t *Task) DependsOn(tasks ...*Task) *Task
```

**Example Usage:**
```go
checkTask := wf.HttpGet("checkStatus", apiURL)

switchTask := wf.Switch("routeByStatus",
    workflow.SwitchOn(checkTask.Field("statusCode")),
    workflow.Case(workflow.Equals(200), "handleSuccess"),
    workflow.Case(workflow.Equals(500), "handleError"),
    workflow.DefaultCase("handleUnknown"),
)

wf.SetVars("handleSuccess", "status", "ok").DependsOn(switchTask)
wf.SetVars("handleError", "status", "failed").DependsOn(switchTask)
```

**Proto Mapping:**
- Maps to `WorkflowTaskKind.SWITCH`
- Switch options map to `WorkflowSwitchTask` proto message
- Cases map to `WorkflowSwitchTaskCase` repeated field

---

## Feature 2: ForEach Loops

**Example Test:** `TestExample09_WorkflowWithLoops` (currently skipped)

**Required Implementations:**

### 2.1 Workflow Method
```go
func (w *Workflow) ForEach(name string, opts ...ForEachTaskOption) *Task
```
- Creates a FOR task that iterates over a collection
- Executes a body task for each item
- Returns the loop task (with access to aggregated results)

### 2.2 ForEach Task Options
```go
// Core loop configuration
func IterateOver(collection interface{}) ForEachTaskOption
func WithLoopBody(bodyFunc func(LoopVar) *Task) ForEachTaskOption

// Optional loop controls
func WithConcurrency(max int) ForEachTaskOption
func WithBatchSize(size int) ForEachTaskOption
```

### 2.3 Loop Variable Type
```go
// LoopVar represents the current item in iteration
type LoopVar interface {
    // Access fields of the current item
    Field(name string) TaskFieldRef
    
    // Get the loop index
    Index() TaskFieldRef
    
    // Expression for the entire current item
    Expression() string
}
```

### 2.4 Helper Aliases
```go
// Convenience alias for WithBody
func Body(data interface{}) HttpCallTaskOption {
    return WithBody(data)
}
```

**Example Usage:**
```go
fetchTask := wf.HttpGet("fetchItems", apiURL)

loopTask := wf.ForEach("processEachItem",
    workflow.IterateOver(fetchTask.Field("items")),
    workflow.WithLoopBody(func(item workflow.LoopVar) *workflow.Task {
        return wf.HttpPost("processItem", processURL,
            workflow.Body(map[string]interface{}{
                "itemId": item.Field("id"),
                "data": item.Field("data"),
            }),
        )
    }),
)

wf.SetVars("collectResults",
    "processed", loopTask.Field("results"),
    "count", loopTask.Field("count"),
)
```

**Proto Mapping:**
- Maps to `WorkflowTaskKind.FOR`
- Loop body is a nested task definition
- Collection expression maps to `for_each` field
- Loop variable is available in body task scope

---

## Feature 3: Try/Catch/Finally Error Handling

**Example Test:** `TestExample10_WorkflowWithErrorHandling` (currently skipped)

**Required Implementations:**

### 3.1 Workflow Method
```go
func (w *Workflow) Try(name string, opts ...TryTaskOption) *Task
```
- Creates a TRY task with error handling blocks
- Returns the try task

### 3.2 Try Task Options
```go
// Required blocks
func TryBlock(bodyFunc func() *Task) TryTaskOption
func CatchBlock(handlerFunc func(ErrorRef) *Task) TryTaskOption

// Optional blocks
func FinallyBlock(cleanupFunc func() *Task) TryTaskOption
```

### 3.3 Error Reference Type
```go
// ErrorRef represents the caught error
type ErrorRef interface {
    // Get error message
    Message() TaskFieldRef
    
    // Get error timestamp
    Timestamp() TaskFieldRef
    
    // Get error code/type
    Code() TaskFieldRef
    
    // Expression for the entire error object
    Expression() string
}
```

**Example Usage:**
```go
tryTask := wf.Try("attemptAPICall",
    workflow.TryBlock(func() *workflow.Task {
        return wf.HttpGet("callAPI", apiURL,
            workflow.Timeout(30),
        )
    }),
    workflow.CatchBlock(func(err workflow.ErrorRef) *workflow.Task {
        return wf.SetVars("handleError",
            "error", err.Message(),
            "timestamp", err.Timestamp(),
            "retryable", "true",
        )
    }),
    workflow.FinallyBlock(func() *workflow.Task {
        return wf.SetVars("cleanup",
            "status", "attempted",
        )
    }),
)
```

**Proto Mapping:**
- Maps to `WorkflowTaskKind.TRY`
- Try/catch/finally blocks are nested task definitions
- Error is available in catch block scope

---

## Feature 4: Fork/Join Parallel Execution

**Example Test:** `TestExample11_WorkflowWithParallelExecution` (currently skipped)

**Required Implementations:**

### 4.1 Workflow Method
```go
func (w *Workflow) Fork(name string, opts ...ForkTaskOption) *Task
```
- Creates a FORK task that executes branches in parallel
- Returns the fork task (with access to branch results)

### 4.2 Fork Task Options
```go
// Core parallel configuration
func ParallelBranches(branches ...Branch) ForkTaskOption

// Join strategies
func WaitForAll() ForkTaskOption        // Default: wait for all
func WaitForAny() ForkTaskOption        // Complete when any branch completes
func WaitForN(n int) ForkTaskOption     // Complete when N branches complete

// Timeout and error handling
func WithParallelTimeout(seconds int) ForkTaskOption
func FailFast(enabled bool) ForkTaskOption  // Stop all on first error
```

### 4.3 Branch Builder
```go
type Branch interface {
    Name() string
    Task() *Task
}

func Branch(name string, taskFunc func() *Task) Branch
```

### 4.4 Task Method for Branch Access
```go
// Access results from a specific branch
func (t *Task) Branch(branchName string) BranchRef

type BranchRef interface {
    Field(name string) TaskFieldRef
    Expression() string
}
```

**Example Usage:**
```go
forkTask := wf.Fork("fetchAllData",
    workflow.ParallelBranches(
        workflow.Branch("fetchUsers", func() *workflow.Task {
            return wf.HttpGet("getUsers", apiBase.Concat("/users"))
        }),
        workflow.Branch("fetchProducts", func() *workflow.Task {
            return wf.HttpGet("getProducts", apiBase.Concat("/products"))
        }),
        workflow.Branch("fetchOrders", func() *workflow.Task {
            return wf.HttpGet("getOrders", apiBase.Concat("/orders"))
        }),
    ),
    workflow.WaitForAll(),
)

wf.SetVars("mergeResults",
    "users", forkTask.Branch("fetchUsers").Field("data"),
    "products", forkTask.Branch("fetchProducts").Field("data"),
    "orders", forkTask.Branch("fetchOrders").Field("data"),
)
```

**Proto Mapping:**
- Maps to `WorkflowTaskKind.FORK`
- Branches are nested task definitions
- Branch results are available via branch name lookup
- Join strategy maps to fork task configuration

---

## Implementation Priority

Based on common use cases:

1. **Priority 1 (High):** Switch/Case Conditionals
   - Most common control flow pattern
   - Simple to implement
   - Enables decision-making workflows

2. **Priority 2 (High):** ForEach Loops
   - Critical for batch processing
   - Common pattern in data workflows
   - More complex than switch but very useful

3. **Priority 3 (Medium):** Fork/Join Parallel Execution
   - Important for performance
   - Enables concurrent data fetching
   - Complex but high value

4. **Priority 4 (Medium):** Try/Catch/Finally Error Handling
   - Nice-to-have for robust workflows
   - Can be partially achieved with switch on status codes
   - More complex semantics

---

## Testing Strategy

For each feature:

1. ✅ Example file already exists (`0X_workflow_with_*.go`)
2. ✅ Test already exists in `examples_test.go` (currently skipped)
3. ⏳ Implement the feature in `workflow` package
4. ⏳ Remove the `t.Skip()` line from the test
5. ⏳ Verify the test passes
6. ⏳ Add additional edge case tests

---

## Proto Schema Reference

The Stigmer workflow proto schema supports all these features. Reference:

```
workflow/v1/workflow.proto:
- WorkflowTaskKind enum (SWITCH, FOR, TRY, FORK)
- WorkflowSwitchTask message
- WorkflowForTask message  
- WorkflowTryTask message
- WorkflowForkTask message
```

When implementing, ensure the Go SDK types map cleanly to these proto messages.

---

## Questions to Resolve Before Implementation

1. **Switch/Case:**
   - Should we support fallthrough between cases?
   - How to handle multiple tasks in a case branch?

2. **ForEach:**
   - Should we support early break/continue?
   - How to handle errors in loop body?
   - Should we collect all results or just last result?

3. **Try/Catch:**
   - Should catch blocks be type-specific (HTTP errors vs general errors)?
   - Can catch blocks re-throw errors?

4. **Fork/Join:**
   - Should we support nested forks?
   - How to handle partial failures with WaitForAll?
   - Should there be a max concurrency limit?

---

## Useful Resources

- Stigmer Workflow Proto: `apis/ai/stigmer/agentic/workflow/v1/workflow.proto`
- Existing Task Implementation: `workflow/task.go`
- HTTP Task Example: `workflow/http_task.go`
- Test Examples: `examples/08_*.go`, `examples/09_*.go`, etc.

---

**Last Updated:** 2026-01-17
**Status:** All basic features (MVP) implemented and tested ✅
**Next Steps:** Implement Priority 1 features post-MVP
