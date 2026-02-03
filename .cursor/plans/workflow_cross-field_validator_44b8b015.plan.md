---
name: Workflow Cross-Field Validator
overview: Implement workflow cross-field validator for Phase 3 T03.2, validating task name uniqueness, flow control references, and DAG acyclicity following the established agent validator pattern.
todos:
  - id: validator-core
    content: Create validator.go with Validate(), validateUniqueTaskNames(), validateFlowControlReferences(), validateNoCycles()
    status: completed
  - id: nested-extraction
    content: Implement nested task extraction from task_config Struct for fork/for/try task kinds
    status: completed
  - id: cycle-detection
    content: Implement DAG cycle detection using DFS with path tracking
    status: completed
  - id: test-helpers
    content: Create test helpers for building workflows and tasks in validator_test.go
    status: completed
  - id: test-suite
    content: "Implement comprehensive test suite: edge cases, valid flows, uniqueness, references, cycles, error messages"
    status: completed
  - id: build-update
    content: Update BUILD.bazel to add validator.go and validator_test.go
    status: completed
isProject: false
---

# Workflow Cross-Field Validator Implementation

## Architectural Context

The workflow loader ([client-apps/cli/internal/cli/workflow/loader.go](client-apps/cli/internal/cli/workflow/loader.go)) handles schema validation via protovalidate. The validator handles cross-field business logic that cannot be expressed in proto rules.

## Key Proto Structures

From [apis/ai/stigmer/agentic/workflow/v1/spec.proto](apis/ai/stigmer/agentic/workflow/v1/spec.proto):

- `WorkflowTask.name` - Task identifier (must be unique)
- `FlowControl.then` - Target task name or "end"
- `WorkflowTask.kind` - Task type (determines nested structure)
- `task_config` - Dynamic config containing nested tasks for fork/for/try

Nested task structures:

- `ForkTaskConfig.branches[].do[]` - Tasks in fork branches
- `ForTaskConfig.do[]` - Tasks in for loops
- `TryTaskConfig.try[]` and `catch.do[]` - Tasks in try/catch

## Cross-Field Validations

### 1. Task Name Uniqueness

Collect all task names (including nested tasks in fork/for/try) and ensure no duplicates.

### 2. Flow Control References

Validate that `flow.then` references either:

- An existing top-level task name, OR
- The literal string "end"

### 3. DAG Acyclicity

Detect circular dependencies in flow control (e.g., A -> B -> C -> A is invalid).

**Algorithm:** Build adjacency list from `flow.then` references, then use DFS to detect cycles.

## Implementation Pattern

Following the agent validator pattern from [client-apps/cli/internal/cli/agent/validator.go](client-apps/cli/internal/cli/agent/validator.go):

```go
func Validate(workflow *workflowv1.Workflow) error {
    if workflow == nil || workflow.Spec == nil {
        return nil // Schema validation handles required fields
    }
    
    if err := validateUniqueTaskNames(workflow.Spec); err != nil {
        return err
    }
    
    if err := validateFlowControlReferences(workflow.Spec); err != nil {
        return err
    }
    
    if err := validateNoCycles(workflow.Spec); err != nil {
        return err
    }
    
    return nil
}
```

## Deliverables

### 1. validator.go (~150 lines)

**Structure:**

- `Validate(workflow)` - Main entry point
- `validateUniqueTaskNames(spec)` - Check for duplicates
- `validateFlowControlReferences(spec)` - Validate `then` targets
- `validateNoCycles(spec)` - DAG cycle detection
- `collectTaskNames(tasks)` - Recursive helper for nested tasks
- `buildFlowGraph(tasks)` - Build adjacency list
- `detectCycles(graph, taskNames)` - DFS cycle detection

**Error Message Quality (per agent pattern):**

- Include field path: `tasks[2].flow.then`
- Provide actionable guidance: "Available task names: taskA, taskB, taskC"
- Clear problem description

### 2. validator_test.go (~300 lines)

**Test Organization:**

- Test helpers section (task builders)
- Edge cases (nil workflow, nil spec, empty spec)
- Valid cases (sequential flow, explicit jumps, end termination)
- Uniqueness tests (duplicate names at top-level, nested duplicates)
- Reference tests (valid references, invalid references, "end" literal)
- Cycle tests (simple A->B->A, complex multi-node cycles)
- Error message quality tests (table-driven)

### 3. BUILD.bazel Updates

Add `validator.go` to sources and `validator_test.go` to test srcs.

## Implementation Details

### Task Name Collection (Recursive)

```go
func collectTaskNames(tasks []*workflowv1.WorkflowTask) map[string]int {
    names := make(map[string]int) // name -> first occurrence index
    for i, task := range tasks {
        if task == nil { continue }
        names[task.Name] = i
        // Recursively collect from nested tasks based on kind
        // - fork: branches[].do[]
        // - for_each: do[]
        // - try_catch: try[] and catch.do[]
    }
    return names
}
```

### Nested Task Extraction

For `task_config` (google.protobuf.Struct), need to unmarshal to specific config types based on `kind`:

- `WORKFLOW_TASK_KIND_FORK` -> Extract branches[].do
- `WORKFLOW_TASK_KIND_FOR_EACH` -> Extract do
- `WORKFLOW_TASK_KIND_TRY_CATCH` -> Extract try and catch.do

**Approach:** Use protojson to convert Struct back to specific config type.

### Cycle Detection Algorithm

```go
func detectCycles(graph map[string]string, taskNames map[string]bool) error {
    visited := make(map[string]bool)
    path := make(map[string]bool) // Current DFS path
    
    var dfs func(node string) error
    dfs = func(node string) error {
        if path[node] {
            return fmt.Errorf("circular dependency detected: %s", reconstructPath(path, node))
        }
        if visited[node] { return nil }
        
        visited[node] = true
        path[node] = true
        
        if next, ok := graph[node]; ok && next != "end" {
            if err := dfs(next); err != nil {
                return err
            }
        }
        
        path[node] = false
        return nil
    }
    
    for task := range taskNames {
        if err := dfs(task); err != nil { return err }
    }
    return nil
}
```

## File Locations

- [client-apps/cli/internal/cli/workflow/validator.go](client-apps/cli/internal/cli/workflow/validator.go) (NEW)
- [client-apps/cli/internal/cli/workflow/validator_test.go](client-apps/cli/internal/cli/workflow/validator_test.go) (NEW)
- [client-apps/cli/internal/cli/workflow/BUILD.bazel](client-apps/cli/internal/cli/workflow/BUILD.bazel) (MODIFY)

## Coding Guidelines Compliance

- validator.go: Target ~150 lines (under 250 limit)
- validator_test.go: Target ~300 lines
- All functions under 50 lines
- Single responsibility per function
- Errors wrapped with specific context
- Actionable error messages with guidance

## Dependencies

No new dependencies required. Uses existing:

- `workflowv1` proto types (already in deps)
- `google.golang.org/protobuf/encoding/protojson` (for nested task extraction)
- `fmt`, `strings` (standard library)

## Test Coverage Requirements


| Category    | Test Cases                                                |
| ----------- | --------------------------------------------------------- |
| Edge Cases  | nil workflow, nil spec, empty spec, empty tasks           |
| Valid Flows | sequential, explicit jumps, end termination, fork/for/try |
| Uniqueness  | top-level duplicates, nested duplicates in fork/for/try   |
| References  | valid refs, invalid refs, "end" literal, empty `then`     |
| Cycles      | A->A self-loop, A->B->A, complex chains, disjoint cycles  |
| Messages    | field paths, actionable guidance, available tasks list    |


