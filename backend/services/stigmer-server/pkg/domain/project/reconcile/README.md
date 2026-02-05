# Reconcile Package

The `reconcile` package provides value objects for the Project reconciliation engine. These types form the foundation for comparing desired state (from `Project.Spec`) with actual state (from repositories) to compute reconciliation plans.

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
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Types

### ResourceKey

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

### DesiredState

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

// Get all keys (deterministic order)
for _, key := range desired.AllResourceKeys() {
    fmt.Println(key) // agent:my-agent, workflow:pipeline, ...
}

// Get resource maps (defensive copies)
agents := desired.Agents()
```

### ActualState

An immutable value object representing resources fetched from repositories - the "what currently exists" side of reconciliation.

```go
// Create from repository queries
actual := reconcile.NewActualState(
    agentRepo.FindByProjectID(projectID),
    workflowRepo.FindByProjectID(projectID),
    mcpServerRepo.FindByProjectID(projectID),
    skillRepo.FindByProjectID(projectID),
)

// Get a resource by key (returns proto.Message)
key := reconcile.MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
resource := actual.GetResource(key)

// Get resource ID for update operations
id := actual.GetResourceID(key) // e.g., "agt_abc123"

// Type-safe getters when you know the type
agent := actual.GetAgent("my-agent")
workflow := actual.GetWorkflow("data-pipeline")
```

## Design Principles

### Immutability

All value objects in this package are immutable:
- Fields are unexported (lowercase)
- Construction only through factory functions (`New*`, `Empty*`)
- Getters return defensive copies of maps
- No setter methods

This ensures thread-safety and prevents accidental mutation during reconciliation.

### Defensive Copying

Maps passed to constructors are cloned to prevent external mutation:

```go
original := map[string]*agentv1.Agent{"a": agent}
state := reconcile.NewDesiredState(original, nil, nil, nil)

// Modifying original doesn't affect state
original["b"] = otherAgent
state.ResourceCount() // Still 1
```

Maps returned by getters are also cloned:

```go
agents := state.Agents()
agents["new"] = newAgent  // Doesn't affect state
```

### Deterministic Ordering

`AllResourceKeys()` returns keys in a deterministic order:
1. By kind: agents → workflows → mcp_servers → skills
2. Alphabetically by slug within each kind

This ensures reproducible test results and predictable reconciliation.

## Usage in Reconciliation

```go
// 1. Parse desired state from Project
desired := parseDesiredState(project)

// 2. Fetch actual state from repositories
actual := fetchActualState(projectID)

// 3. Compute diff (implemented in later phases)
plan := computeDiff(desired, actual, dependencyGraph)

// 4. Execute plan (implemented in later phases)
result := executePlan(plan, options)
```

## File Structure

```
reconcile/
├── resource_key.go          # ResourceKey type and functions
├── resource_key_test.go     # 10 tests
├── desired_state.go         # DesiredState value object
├── desired_state_test.go    # 8 tests
├── actual_state.go          # ActualState value object
├── actual_state_test.go     # 9 tests
├── BUILD.bazel              # Bazel build configuration
└── README.md                # This file
```

## Testing

Run tests with:

```bash
bazel test //backend/services/stigmer-server/pkg/domain/project/reconcile:reconcile_test
```

## Future Extensions

This package will be extended in later phases with:
- `ChangeType` - Enum for create/update/delete operations
- `ResourceChange` - Single change record
- `ReconciliationPlan` - Computed diff with ordered changes
- `ReconciliationResult` - Execution outcome with success/error tracking
- `DependencyGraph` - Graph for topological ordering
- `DependencyDiscoverer` - Proto reflection to find references
