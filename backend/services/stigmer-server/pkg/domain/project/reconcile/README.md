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

### Phase B: Dependency Graph

#### DependencyGraph

Immutable directed acyclic graph (DAG) representing resource dependencies.

```go
// Build graph using builder pattern
graph := reconcile.NewDependencyGraphBuilder().
    AddDependency(workflowKey, agentKey).
    AddDependency(agentKey, mcpServerKey).
    Build()

// Query dependencies
deps := graph.Dependencies(workflowKey)  // [agentKey]
dependents := graph.Dependents(agentKey) // [workflowKey]

// Topological sort for execution order
order, err := graph.TopologicalSort()
if err != nil {
    // Handle cycle
}
// order: [mcpServerKey, agentKey, workflowKey]

// Reverse sort for deletion order
deleteOrder, _ := graph.ReverseTopologicalSort()
// deleteOrder: [workflowKey, agentKey, mcpServerKey]

// Cycle detection
if graph.HasCycle() {
    cyclePath, _ := graph.DetectCycle()
}
```

#### DependencyDiscoverer

Proto reflection scanner that finds ApiResourceReference fields.

```go
// Discover dependencies in any proto message
refs := reconcile.DiscoverDependencies(agentProto)
// refs: []*ApiResourceReference pointing to skills, MCP servers

// Convert reference to ResourceKey
key, err := reconcile.ToResourceKey(ref)
```

#### GraphBuilder

Build dependency graph from DesiredState.

```go
desired := reconcile.NewDesiredState(agents, workflows, mcpServers, skills)
graph := reconcile.BuildDependencyGraph(desired)
// graph contains only internal dependencies (within the desired state)
```

### Phase C1: Diff Algorithm

#### ComputeDiff

Core diff algorithm that compares desired state with actual state.

```go
// Compute diff to produce reconciliation plan
desired := reconcile.NewDesiredState(agents, workflows, mcpServers, skills)
actual := reconcile.NewActualState(existingAgents, existingWorkflows, nil, nil)
graph := reconcile.BuildDependencyGraph(desired)

plan := reconcile.ComputeDiff(desired, actual, graph)

// Plan categorizes all changes
fmt.Printf("Creates: %d\n", plan.CreateCount())  // New resources
fmt.Printf("Updates: %d\n", plan.UpdateCount())  // Changed specs
fmt.Printf("Deletes: %d\n", plan.DeleteCount())  // Orphans

// Iterate changes
for _, change := range plan.Creates() {
    fmt.Println(change.Key())           // e.g., "agent:new-agent"
    fmt.Println(change.DesiredState())  // The proto to create
}
```

**Diff Categories:**
- **Creates**: Resources in desired but not in actual
- **Updates**: Resources in both with different specs (metadata ignored)
- **Deletes**: Resources in actual but not in desired (orphans)

**Spec-Only Comparison:**

The diff algorithm compares only the `spec` field of resources, ignoring metadata fields like `id`, `created_at`, `updated_at`. This prevents false update detections caused by system-managed metadata.

```go
// Same spec, different metadata -> NO update
agent1 := &Agent{Spec: spec, Metadata: &Meta{Id: "a"}}
agent2 := &Agent{Spec: spec, Metadata: &Meta{Id: "b"}}
// These are considered equal

// Different spec -> YES update
agent3 := &Agent{Spec: differentSpec}
// This triggers an update
```

### Phase C2: Execution Order

The execution order functions determine the safe order for applying changes during reconciliation. Without correct ordering, resources could be created before their dependencies exist, or deleted while still referenced.

#### GetChangesInExecutionOrder

Returns creates and updates in dependency order (dependencies first, dependents after).

```go
// Build plan with dependency graph
graph := reconcile.BuildDependencyGraph(desired)
plan := reconcile.ComputeDiff(desired, actual, graph)

// Execute changes in safe order
for _, change := range plan.GetChangesInExecutionOrder() {
    if err := executeChange(change); err != nil {
        // Handle error - dependencies are already created
    }
}
```

**Ordering Guarantees:**
- If Agent depends on MCP Server, MCP Server is created first
- If Workflow depends on Agent, Agent is created first
- Uses topological sort when dependency graph is available
- Falls back to kind hierarchy: Skills -> MCP Servers -> Agents -> Workflows

#### GetDeletesInReverseDependencyOrder

Returns deletes in reverse dependency order (dependents first, dependencies after).

```go
// Delete orphans safely
for _, change := range plan.GetDeletesInReverseDependencyOrder() {
    if err := deleteResource(change); err != nil {
        // Handle error - dependents are already deleted
    }
}
```

**Ordering Guarantees:**
- If Workflow references Agent, Workflow is deleted first
- If Agent references MCP Server, Agent is deleted first
- Uses reverse topological sort when dependency graph covers all deletes
- Falls back to kind hierarchy: Workflows -> Agents -> MCP Servers -> Skills

#### Kind Hierarchy

When the dependency graph is not available or doesn't cover all resources, the system uses a safe kind-based ordering:

**Creation Order (leaf nodes first):**
1. Skills (no dependencies)
2. MCP Servers (no dependencies)
3. Agents (depend on Skills and MCP Servers)
4. Workflows (depend on Agents)

**Deletion Order (dependents first):**
1. Workflows (depend on Agents)
2. Agents (depend on Skills and MCP Servers)
3. MCP Servers (no dependents among supported kinds)
4. Skills (no dependents among supported kinds)

#### Deterministic Ordering

Within the same precedence level (same topological rank or same kind), resources are sorted by slug for deterministic, reproducible results:

```go
// Same dependency level - sorted by slug
// Result: [agent:alpha, agent:beta, agent:charlie]
```

## File Structure

```
reconcile/
├── resource_key.go              # ResourceKey type and functions
├── resource_key_test.go         # 10 tests
├── desired_state.go             # DesiredState value object
├── desired_state_test.go        # 10 tests
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
├── dependency_graph.go          # DependencyGraph with topo sort
├── dependency_graph_test.go     # 35 tests
├── dependency_discoverer.go     # Proto reflection scanner
├── dependency_discoverer_test.go# 25 tests
├── graph_builder.go             # Build graph from state
├── graph_builder_test.go        # 20 tests
├── diff.go                      # Diff algorithm (ComputeDiff)
├── diff_test.go                 # 35 tests
├── execution_order.go           # Execution order functions (C2)
├── execution_order_test.go      # 25 tests
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
- **Phase D**: CRUD handlers for Project entity
- **Phase E**: `ReconciliationService` - Main orchestrator
- **Phase E**: `ExecutionEngine` - Execute plan with partial failure handling
