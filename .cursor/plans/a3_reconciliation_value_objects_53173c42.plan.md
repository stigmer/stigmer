---
name: A3 Reconciliation Value Objects
overview: Implement the remaining reconciliation value objects (ChangeType, ResourceChange, ReconciliationPlan, ReconciliationResult, ReconciliationOptions, ReconciliationError) following the established immutable value object patterns from A2, with ~30 comprehensive tests.
todos:
  - id: a3-change-type
    content: Implement change_type.go with ChangeType constants and String/IsValid methods + 6 tests
    status: completed
  - id: a3-resource-change
    content: Implement resource_change.go with factory methods (NewCreateChange, NewUpdateChange, NewDeleteChange) and helpers + 8 tests
    status: completed
  - id: a3-reconciliation-plan
    content: Implement reconciliation_plan.go with creates/updates/deletes slices and EmptyPlan singleton + 6 tests
    status: completed
  - id: a3-reconciliation-result
    content: Implement reconciliation_result.go with ResultBuilder pattern and ToProtoSummary + 6 tests
    status: completed
  - id: a3-reconciliation-error
    content: Implement reconciliation_error.go implementing error interface + 3 tests
    status: completed
  - id: a3-reconciliation-options
    content: Implement reconciliation_options.go with singleton presets and copy methods + 5 tests
    status: completed
  - id: a3-build-verify
    content: Update BUILD.bazel, run bazel build/test, verify all 32 tests pass
    status: completed
isProject: false
---

# A3: Reconciliation Value Objects - Plan

## Context

A2 established the foundation with `ResourceKey`, `DesiredState`, and `ActualState`. A3 completes the value object layer with the change-tracking and result types needed for the reconciliation engine.

**Location**: `[backend/services/stigmer-server/pkg/domain/project/reconcile/](backend/services/stigmer-server/pkg/domain/project/reconcile/)`

**Proto Integration**: Uses `projectv1.ReconciliationSummary` and `projectv1.ResourceChangeRecord` from `[apis/stubs/go/ai/stigmer/agentic/project/v1/status.pb.go](apis/stubs/go/ai/stigmer/agentic/project/v1/status.pb.go)`

## Established Patterns (from A2)

All value objects follow these patterns from the existing codebase:

- **Unexported fields** with factory constructors
- **Defensive copying** in constructors and getters
- **Singleton empty instances** for efficiency
- **No setters** - immutability enforced
- **MustXxx** panic helpers for tests
- **Comprehensive documentation** with examples

## Files to Create

### 1. change_type.go (~45 lines)

Typed constants representing reconciliation operations.

```go
type ChangeType int

const (
    ChangeTypeCreate ChangeType = iota + 1
    ChangeTypeUpdate
    ChangeTypeDelete
)
```

**Methods**:

- `String() string` - Returns "create", "update", or "delete"
- `IsValid() bool` - Checks if value is one of the three types

### 2. resource_change.go (~120 lines)

Immutable value object representing a single change to be applied.

```go
type ResourceChange struct {
    key          ResourceKey
    changeType   ChangeType
    desiredState proto.Message  // nil for Delete
    actualState  proto.Message  // nil for Create
}
```

**Factory methods**:

- `NewCreateChange(key ResourceKey, desired proto.Message) ResourceChange`
- `NewUpdateChange(key ResourceKey, desired, actual proto.Message) ResourceChange`
- `NewDeleteChange(key ResourceKey, actual proto.Message) ResourceChange`

**Methods**:

- `Key() ResourceKey`
- `ChangeType() ChangeType`
- `DesiredState() proto.Message`
- `ActualState() proto.Message`
- `IsCreate() bool`, `IsUpdate() bool`, `IsDelete() bool`
- `String() string` - e.g., "create agent:my-agent"

### 3. reconciliation_plan.go (~130 lines)

Immutable container for computed changes, organized by operation type.

```go
type ReconciliationPlan struct {
    creates []ResourceChange
    updates []ResourceChange
    deletes []ResourceChange
}
```

**Factory methods**:

- `NewReconciliationPlan(creates, updates, deletes []ResourceChange) *ReconciliationPlan`
- `EmptyPlan() *ReconciliationPlan` - Singleton

**Methods**:

- `Creates() []ResourceChange`, `Updates() []ResourceChange`, `Deletes() []ResourceChange` - Defensive copies
- `IsEmpty() bool`
- `TotalChanges() int`
- `AllChanges() []ResourceChange` - Combined creates + updates + deletes

**Note**: `GetChangesInExecutionOrder()` and `GetDeletesInReverseDependencyOrder()` deferred to C2 (requires DependencyGraph).

### 4. reconciliation_result.go (~150 lines)

Captures execution outcome with success tracking and error collection.

```go
type ReconciliationResult struct {
    created []*projectv1.ResourceChangeRecord
    updated []*projectv1.ResourceChangeRecord
    deleted []*projectv1.ResourceChangeRecord
    errors  []ReconciliationError
}
```

**Factory methods**:

- `NewSuccessResult(created, updated, deleted []*projectv1.ResourceChangeRecord) *ReconciliationResult`
- `NewPartialResult(created, updated, deleted []*projectv1.ResourceChangeRecord, errors []ReconciliationError) *ReconciliationResult`
- `NewFailureResult(errors []ReconciliationError) *ReconciliationResult`
- `EmptyResult() *ReconciliationResult` - Singleton
- `DryRunResult(plan *ReconciliationPlan, actual *ActualState) *ReconciliationResult` - Extract IDs from actual state

**Methods**:

- `Created()`, `Updated()`, `Deleted()` - Defensive copies
- `Errors() []ReconciliationError`
- `IsSuccess() bool`, `HasErrors() bool`
- `TotalChanges() int`
- `ToProtoSummary() *projectv1.ReconciliationSummary`

**Builder pattern** (for incremental construction during execution):

- `ResultBuilder` struct with `AddCreated()`, `AddUpdated()`, `AddDeleted()`, `AddError()`, `Build()`

### 5. reconciliation_error.go (~50 lines)

Internal error type for tracking failures during execution.

```go
type ReconciliationError struct {
    resourceKey string
    message     string
    cause       error
}
```

**Factory methods**:

- `NewReconciliationError(resourceKey, message string) ReconciliationError`
- `NewReconciliationErrorWithCause(resourceKey, message string, cause error) ReconciliationError`

**Methods**:

- `ResourceKey() string`
- `Message() string`
- `Cause() error`
- `HasCause() bool`
- `Error() string` - Implements `error` interface

### 6. reconciliation_options.go (~70 lines)

Configuration for reconciliation behavior.

```go
type ReconciliationOptions struct {
    pruneEnabled bool  // Delete orphans (default: true)
    dryRun       bool  // Compute plan only (default: false)
}
```

**Singleton constants**:

- `defaultOptions` - pruneEnabled=true, dryRun=false
- `dryRunOptions` - pruneEnabled=true, dryRun=true
- `noPruneOptions` - pruneEnabled=false, dryRun=false

**Factory methods**:

- `DefaultOptions() *ReconciliationOptions`
- `DryRunOptions() *ReconciliationOptions`
- `NoPruneOptions() *ReconciliationOptions`

**Copy methods** (return new instances):

- `WithPrune(enabled bool) *ReconciliationOptions`
- `WithDryRun(dryRun bool) *ReconciliationOptions`

**Methods**:

- `IsPruneEnabled() bool`
- `IsDryRun() bool`

## Test Coverage (~32 tests)

### change_type_test.go (~6 tests)

- `TestChangeType_String` - All three types
- `TestChangeType_IsValid` - Valid and invalid values
- `TestChangeType_ZeroValue` - Zero value is invalid

### resource_change_test.go (~8 tests)

- `TestNewCreateChange` - Valid create with desired state
- `TestNewUpdateChange` - Valid update with both states
- `TestNewDeleteChange` - Valid delete with actual state
- `TestResourceChange_TypeHelpers` - IsCreate/IsUpdate/IsDelete
- `TestResourceChange_String` - Formatted output
- `TestResourceChange_Getters` - Key, ChangeType, states
- `TestResourceChange_NilStates` - Correct nil handling per type
- `TestResourceChange_Equality` - Value equality semantics

### reconciliation_plan_test.go (~6 tests)

- `TestNewReconciliationPlan` - Construction with all change types
- `TestEmptyPlan` - Singleton behavior
- `TestReconciliationPlan_IsEmpty` - Empty vs non-empty
- `TestReconciliationPlan_TotalChanges` - Count accuracy
- `TestReconciliationPlan_DefensiveCopy` - Getters return copies
- `TestReconciliationPlan_AllChanges` - Combined list

### reconciliation_result_test.go (~6 tests)

- `TestNewSuccessResult` - No errors case
- `TestNewPartialResult` - With errors case
- `TestNewFailureResult` - Only errors case
- `TestEmptyResult` - Singleton behavior
- `TestReconciliationResult_ToProtoSummary` - Proto conversion
- `TestResultBuilder` - Incremental construction

### reconciliation_error_test.go (~3 tests)

- `TestNewReconciliationError` - Without cause
- `TestNewReconciliationErrorWithCause` - With cause
- `TestReconciliationError_Error` - Error interface

### reconciliation_options_test.go (~5 tests)

- `TestDefaultOptions` - Default values
- `TestDryRunOptions` - Dry run preset
- `TestNoPruneOptions` - No prune preset
- `TestReconciliationOptions_WithPrune` - Copy with prune change
- `TestReconciliationOptions_WithDryRun` - Copy with dryRun change

## BUILD.bazel Updates

Add new source files:

```starlark
srcs = [
    "actual_state.go",
    "change_type.go",
    "desired_state.go",
    "reconciliation_error.go",
    "reconciliation_options.go",
    "reconciliation_plan.go",
    "reconciliation_result.go",
    "resource_change.go",
    "resource_key.go",
]
```

Add new test files:

```starlark
srcs = [
    "actual_state_test.go",
    "change_type_test.go",
    "desired_state_test.go",
    "reconciliation_error_test.go",
    "reconciliation_options_test.go",
    "reconciliation_plan_test.go",
    "reconciliation_result_test.go",
    "resource_change_test.go",
    "resource_key_test.go",
]
```

Add dependency for project protos:

```starlark
deps = [
    # ... existing deps ...
    "//apis/stubs/go/ai/stigmer/agentic/project/v1:project",
]
```

## Quality Checklist

- All functions under 50 lines
- All files under 300 lines
- Zero linter errors (`go vet`, `gofmt`)
- Table-driven tests with descriptive names
- Defensive copying in constructors and getters
- Comprehensive documentation with examples
- Immutable value objects (no setters)
- Singleton empty instances where appropriate
- Bazel build and test pass

## Verification Commands

```bash
# Build
bazel build //backend/services/stigmer-server/pkg/domain/project/reconcile:reconcile

# Test
bazel test //backend/services/stigmer-server/pkg/domain/project/reconcile:reconcile_test

# Format check
gofmt -l backend/services/stigmer-server/pkg/domain/project/reconcile/
```

## Dependencies on Other Tasks

- **Depends on**: A1 (controller foundation), A2 (state value objects) - both complete
- **Depended on by**: C1 (diff algorithm), D4 (apply handler), E1 (reconciliation service)

