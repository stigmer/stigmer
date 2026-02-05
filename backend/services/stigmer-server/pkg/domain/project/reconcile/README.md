# Reconcile Package

The `reconcile` package provides value objects for the Project reconciliation engine. These types form the foundation for comparing desired state (from `Project.Spec`) with actual state (from repositories) to compute reconciliation plans and track execution results.

## Overview

When a user runs `stigmer apply`, the CLI synthesizes SDK code into a `Project` proto containing embedded resources (agents, workflows, MCP servers, skills). The reconciliation engine compares this desired state with the actual state in the database to determine what needs to be created, updated, or deleted.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Reconciliation Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Project.Spec ──► parseDesiredState() ──► DesiredState          │
│                                               │                  │
│                                               ▼                  │
│  Repositories ──► fetchActualState() ──► ActualState            │
│                                               │                  │
│                                               ▼                  │
│                                          ComputeDiff()           │
│                                               │                  │
│                                               ▼                  │
│                                      ReconciliationPlan          │
│                                               │                  │
│                                               ▼                  │
│                                         ExecutePlan()            │
│                                               │                  │
│                                               ▼                  │
│                                     ReconciliationResult         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Types

### Phase A2: State Value Objects

#### ResourceKey

A type-safe composite key in `"{kind}:{slug}"` format that uniquely identifies a resource within a project's scope.

```go
// Create a ResourceKey
key, err := reconcile.NewResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
if err != nil {
    return err
}
fmt.Println(key.String()) // Output: agent:my-agent

// Parse from string
key, err = reconcile.ParseResourceKey("workflow:data-pipeline")

// For tests (panics on error)
key := reconcile.MustResourceKey(apiresourcekind.ApiResourceKind_skill, "web-search")
```

**Supported Kinds:**
- `agent` - Agent resources
- `workflow` - Workflow resources
- `mcp_server` - MCP Server resources
- `skill` - Skill resources

#### DesiredState

An immutable value object representing resources parsed from `Project.Spec` - the "what should exist" side of reconciliation.

```go
// Create from parsed resources
desired := reconcile.NewDesiredState(
    map[string]*agentv1.Agent{"my-agent": agent},
    map[string]*workflowv1.Workflow{"pipeline": workflow},
    nil, // No MCP servers
    nil, // No skills
)

// Query the state
fmt.Println(desired.ResourceCount()) // Output: 2
fmt.Println(desired.IsEmpty())       // Output: false

// Check for specific resources
key := reconcile.MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
if desired.HasResource(key) {
    // Resource exists in desired state
}
```

#### ActualState

An immutable value object representing resources fetched from repositories - the "what currently exists" side of reconciliation.

```go
// Create from repository queries
actual := reconcile.NewActualState(
    agentRepo.FindByProjectID(projectID),
    workflowRepo.FindByProjectID(projectID),
    mcpServerRepo.FindByProjectID(projectID),
    skillRepo.FindByProjectID(projectID),
)

// Get a resource by key
resource := actual.GetResource(key)
id := actual.GetResourceID(key) // e.g., "agt_abc123"
```

### Phase A3: Plan Value Objects

#### ChangeType

Typed constants representing reconciliation operations.

```go
// Three valid change types
reconcile.ChangeTypeCreate  // Resource to be created
reconcile.ChangeTypeUpdate  // Resource to be updated  
reconcile.ChangeTypeDelete  // Resource to be deleted (orphan)

// String representation
ct := reconcile.ChangeTypeCreate
fmt.Println(ct.String()) // Output: "create"
fmt.Println(ct.IsValid()) // Output: true
```

#### ResourceChange

Immutable value object representing a single change to be applied.

```go
// Create a new resource
createChange := reconcile.NewCreateChange(key, agentProto)
createChange.IsCreate() // true
createChange.DesiredState() // agentProto
createChange.ActualState() // nil

// Update an existing resource
updateChange := reconcile.NewUpdateChange(key, newProto, existingProto)
updateChange.IsUpdate() // true
updateChange.DesiredState() // newProto
updateChange.ActualState() // existingProto

// Delete an orphan resource
deleteChange := reconcile.NewDeleteChange(key, existingProto)
deleteChange.IsDelete() // true
deleteChange.DesiredState() // nil
deleteChange.ActualState() // existingProto

// String representation
fmt.Println(createChange.String()) // Output: "create agent:my-agent"
```

#### ReconciliationPlan

Immutable container for computed changes, organized by operation type.

```go
// Create a plan with changes
plan := reconcile.NewReconciliationPlan(creates, updates, deletes)

// Query the plan
plan.IsEmpty()        // false
plan.TotalChanges()   // 4
plan.CreateCount()    // 2
plan.UpdateCount()    // 1
plan.DeleteCount()    // 1

// Get changes (defensive copies)
for _, change := range plan.AllChanges() {
    fmt.Println(change)
}

// Empty plan singleton (for no-op reconciliation)
emptyPlan := reconcile.EmptyPlan()
```

#### ReconciliationResult

Captures execution outcome with success tracking and error collection.

```go
// Success case - all changes applied
result := reconcile.NewSuccessResult(created, updated, deleted)
result.IsSuccess() // true
result.HasErrors() // false

// Partial success - some failed
result := reconcile.NewPartialResult(created, updated, deleted, errors)
result.IsSuccess() // false (has errors)
result.TotalChanges() // count of successful changes

// Complete failure
result := reconcile.NewFailureResult(errors)

// Convert to proto for API response
summary := result.ToProtoSummary()

// Use builder for incremental construction during execution
builder := reconcile.NewResultBuilder()
builder.AddCreated(record)
builder.AddUpdated(record)
builder.AddError(err)
result := builder.Build()
```

#### ReconciliationError

Internal error type for tracking failures during execution.

```go
// Create error without cause
err := reconcile.NewReconciliationError("agent:my-agent", "validation failed")

// Create error with underlying cause
err := reconcile.NewReconciliationErrorWithCause("workflow:pipeline", "create failed", dbErr)

// Query error
err.ResourceKey() // "agent:my-agent"
err.Message()     // "validation failed"
err.HasCause()    // true/false
err.Cause()       // underlying error or nil

// Implements error interface
fmt.Println(err.Error()) // "agent:my-agent: validation failed"
```

#### ReconciliationOptions

Configuration for reconciliation behavior.

```go
// Default options (prune orphans, execute changes)
opts := reconcile.DefaultOptions()
opts.IsPruneEnabled() // true
opts.IsDryRun()       // false

// Dry run (preview without execution)
opts := reconcile.DryRunOptions()
opts.IsDryRun() // true

// No prune (don't delete orphans)
opts := reconcile.NoPruneOptions()
opts.IsPruneEnabled() // false

// Copy with modifications
opts := reconcile.DefaultOptions().WithPrune(false).WithDryRun(true)
```

## Design Principles

### Immutability

All value objects in this package are immutable:
- Fields are unexported (lowercase)
- Construction only through factory functions (`New*`, `Empty*`)
- Getters return defensive copies of maps and slices
- No setter methods

This ensures thread-safety and prevents accidental mutation during reconciliation.

### Defensive Copying

Maps and slices passed to constructors are cloned to prevent external mutation:

```go
original := []ResourceChange{change1}
plan := reconcile.NewReconciliationPlan(original, nil, nil)

// Modifying original doesn't affect plan
original[0] = change2
plan.Creates()[0] // Still change1
```

### Singleton Empty Instances

Common empty values are singletons for efficiency:
- `EmptyPlan()` - Empty reconciliation plan
- `EmptyResult()` - Empty success result
- `EmptyDesiredState()` - Empty desired state
- `EmptyActualState()` - Empty actual state
- `DefaultOptions()`, `DryRunOptions()`, `NoPruneOptions()` - Common option presets

## File Structure

```
reconcile/
├── resource_key.go              # ResourceKey type and functions
├── resource_key_test.go         # 10 tests
├── desired_state.go             # DesiredState value object
├── desired_state_test.go        # 8 tests
├── actual_state.go              # ActualState value object
├── actual_state_test.go         # 9 tests
├── change_type.go               # ChangeType enum constants
├── change_type_test.go          # 6 tests
├── resource_change.go           # ResourceChange value object
├── resource_change_test.go      # 8 tests
├── reconciliation_plan.go       # ReconciliationPlan container
├── reconciliation_plan_test.go  # 6 tests
├── reconciliation_result.go     # ReconciliationResult with Builder
├── reconciliation_result_test.go# 7 tests
├── reconciliation_error.go      # ReconciliationError type
├── reconciliation_error_test.go # 4 tests
├── reconciliation_options.go    # ReconciliationOptions config
├── reconciliation_options_test.go# 6 tests
├── BUILD.bazel                  # Bazel build configuration
└── README.md                    # This file
```

## Testing

Run tests with:

```bash
bazel test //backend/services/stigmer-server/pkg/domain/project/reconcile:reconcile_test
```

## Future Extensions

This package will be extended in later phases with:
- **Phase B**: `DependencyGraph` - Immutable graph with topological sort
- **Phase B**: `DependencyDiscoverer` - Proto reflection to find ApiResourceReference fields
- **Phase B**: `GraphBuilder` - Build dependency graph from state
- **Phase C**: `ComputeDiff()` - Diff algorithm to produce ReconciliationPlan
- **Phase C**: `GetChangesInExecutionOrder()` - Topological ordering for creates/updates
- **Phase C**: `GetDeletesInReverseDependencyOrder()` - Safe deletion ordering
