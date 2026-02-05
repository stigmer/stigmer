# Project Apply Handler: Idempotent Create-or-Update with Reconciliation Engine

**Date**: February 5, 2026

## Summary

Implemented the D4 Apply Handler for the Project resource controller, enabling idempotent create-or-update operations with integrated reconciliation. This is a foundational component that orchestrates the complete lifecycle of Project resources: initial persistence, desired state parsing, actual state fetching, diff computation, and (stubbed) execution. The implementation establishes clean architectural patterns with dependency injection, comprehensive test coverage (25 tests), and prepares the foundation for full reconciliation execution in future phases.

## Problem Statement

The Project resource controller needed a unified Apply endpoint that handles both creation and updates idempotently, while also orchestrating the reconciliation of embedded resources (agents, workflows, MCP servers, skills). Without this handler, the system lacked the ability to:

1. Process Project resources in a create-or-update fashion
2. Parse and validate desired state from embedded resource specifications
3. Fetch and compare actual state from the database
4. Compute and execute changes in dependency order
5. Report reconciliation results back to clients

### Pain Points

- No idempotent apply operation for Project resources
- Missing integration between persistence and reconciliation layers
- No structured way to handle embedded resources within Project specs
- Lack of dependency injection for reconciliation services (tight coupling)
- No comprehensive test coverage for apply scenarios
- No clear path for future reconciliation execution enhancements

## Solution

Implemented a complete Apply Handler following the established pipeline pattern, with a new ReconciliationService abstraction that enables clean separation of concerns and testability. The solution consists of three major components:

1. **ReconciliationService Interface & Implementation**: Defines the contract for reconciliation operations and provides an initial implementation with desired state parsing, actual state fetching, diff computation, and stubbed execution.

2. **Apply Handler**: Orchestrates the create-or-update flow using the pipeline pattern for existence checking, delegates to Create/Update methods, triggers reconciliation, and builds the response with reconciliation summary.

3. **Comprehensive Test Suite**: 25 tests covering idempotency, reconciliation integration, embedded resource handling, validation, and error scenarios.

## Implementation Details

### 1. ReconciliationService Interface (`reconcile/reconciliation_service.go`)

```go
type ReconciliationService interface {
    Reconcile(ctx context.Context, project *projectv1.Project, 
              options *ReconciliationOptions) (*ReconciliationResult, error)
}
```

Enables dependency injection and modularity, allowing for different implementations (mock for testing, production, future optimized versions).

### 2. ReconciliationService Implementation (`reconcile/service.go`)

**Key Methods**:
- `parseDesiredState(project)`: Extracts agents, workflows, MCP servers, and skills from `project.Spec`, resolving slugs for each resource
- `fetchActualState(ctx, projectID)`: Queries the store for all resources owned by the project using the `stigmer.ai/sdk.project` annotation
- `Reconcile()`: Orchestrates the full flow: parse desired → fetch actual → build graph → compute diff → (stub) execute → return result
- `executePlan()`: **Stubbed in D4** - returns success without actual execution, deferring real execution to future phase E2

**Store Integration**:
- Uses `store.FindAllByField()` with `ProjectOwnershipAnnotation` to fetch actual state
- Separates resources by type (agent, workflow, mcp_server, skill) using reflection-based routing

### 3. Apply Handler (`controller/apply.go`)

**Pipeline Steps**:
1. `ValidateProto`: Ensures proto field constraints are met
2. `LoadForApply`: Determines if resource exists (sets `ShouldCreateKey` in context)

**Execution Flow**:
```go
func (c *ProjectController) Apply(ctx, project) (*projectv1.Project, error) {
    // 1. Run pipeline for existence check
    // 2. Delegate to Create or Update based on existence
    // 3. Trigger reconciliation on persisted project
    // 4. Build response with reconciliation summary in status.last_reconciliation
}
```

**Reconciliation Integration**:
- Calls `reconcile()` helper with configurable options (allow deletes, dry run)
- Gracefully handles reconciliation errors (logs but returns project without summary)
- Populates `status.last_reconciliation` in response (not persisted to database)

### 4. Controller Dependency Injection (`controller/project_controller.go`)

**Updated Constructor**:
```go
func NewProjectController(store store.Store, 
                          reconciliationService reconcile.ReconciliationService) 
                          *ProjectController
```

**Fallback Pattern**: If `reconciliationService` is `nil`, creates default implementation automatically, enabling clean testing while providing production flexibility.

### 5. Test Suite (`controller/apply_test.go`)

**Test Categories** (25 total tests):

1. **Idempotency Tests** (4 tests):
   - First apply creates project
   - Second apply updates existing project
   - Multiple applies with changes
   - Applies preserve reconciliation summary

2. **Reconciliation Integration Tests** (6 tests):
   - Empty project shows no changes
   - Projects with embedded MCP servers show creates
   - Projects with embedded skills show creates
   - Projects with embedded agents/workflows show creates
   - Mixed resources return correct counts
   - Reconciliation errors don't fail apply

3. **Validation Tests** (4 tests):
   - Invalid project name rejected
   - Missing org rejected
   - Invalid slug rejected
   - Nested resource validation enforced

4. **Embedded Resource Tests** (6 tests):
   - Agents with full specs processed
   - Workflows with documents processed
   - MCP servers with server types processed
   - Skills with markdown processed
   - Mixed resource types handled
   - Empty embedded resources handled

5. **Mock Service Tests** (5 tests):
   - Custom reconciliation service injection
   - Mock service called correctly
   - Mock service errors handled
   - Service state verified
   - Dry run mode respected

**Helper Functions**: Created `createTestProject`, `createTestProjectWithMcpServers`, `createTestProjectWithSkills`, `createTestProjectWithMixedResources` with proper validation rules for embedded resources (oneof requirements, regex patterns, length constraints).

### 6. Server Wiring (`server/server.go`)

Updated server bootstrap to pass `nil` for `reconciliationService`, explicitly using the default implementation:
```go
projectController := projectcontroller.NewProjectController(store, nil)
```

### 7. Bazel Build Rules

Updated `BUILD.bazel` files:
- Added new source files (`apply.go`, `reconciliation_service.go`, `service.go`)
- Added test files (`apply_test.go`)
- Added dependencies (pipeline steps, store, reconcile package, MCP server/skill APIs)

## Technical Decisions

1. **Stub Execution in D4**: Deferred actual resource creation/update/deletion to future phase E2, focusing on clean architecture and integration patterns first
2. **Dependency Injection**: Used constructor injection for ReconciliationService to enable clean testing and future flexibility
3. **Pipeline Pattern**: Reused established pattern for consistency across handlers
4. **Graceful Reconciliation Errors**: Apply succeeds even if reconciliation fails, ensuring persistence isn't blocked by reconciliation issues
5. **Non-Persisted Summary**: `status.last_reconciliation` appears in response but isn't saved to database, treating it as computed metadata
6. **Store Annotation Pattern**: Used `stigmer.ai/sdk.project` annotation to query project-owned resources, establishing pattern for resource ownership

## Benefits

### For Development Velocity
- Clear interface boundaries enable parallel development of reconciliation execution
- Mock injection allows comprehensive testing without complex setup
- Clean separation of concerns reduces cognitive load

### For Reliability
- 25 tests provide confidence in idempotency, validation, and error handling
- Pipeline pattern ensures consistent validation across all operations
- Graceful error handling prevents reconciliation issues from blocking persistence

### For Future Enhancement
- ReconciliationService interface enables optimized implementations (batching, caching, parallel execution)
- Stubbed execution provides clear integration point for phase E2
- Established patterns (store queries, slug resolution) can be reused for other resources

### For Testing
- Mock service injection enables isolated unit testing
- Helper functions provide consistent test data generation
- Comprehensive test coverage (create, update, mixed resources, errors)

## Impact

### Immediate
- **Project Controller**: Now fully implements Apply handler, removing unimplemented method
- **Reconciliation Engine**: First production integration of parsing, fetching, and diff computation
- **Testing**: Established pattern for testing handlers with mock services

### Near-Term (Next Phases)
- **D1/D2 (Create/Update/Get)**: Can follow established patterns for pipeline, validation, and testing
- **E2 (Execution)**: Clear integration point via `executePlan()` stub
- **E3+ (Advanced Features)**: ReconciliationService interface enables batching, parallel execution, optimistic locking

### Long-Term
- **Multi-Resource Projects**: Foundation for handling complex projects with dozens of embedded resources
- **Reconciliation Observability**: ReconciliationSummary pattern enables monitoring and debugging
- **Platform Evolution**: Clean abstractions allow for future optimizations without breaking changes

## Code Statistics

- **Files Created**: 4 (reconciliation_service.go, service.go, apply.go, apply_test.go)
- **Files Modified**: 5 (project_controller.go, project_controller_test.go, server.go, 2x BUILD.bazel)
- **Lines of Code**: ~800 (including comprehensive tests and documentation)
- **Test Coverage**: 25 tests across 5 categories
- **Dependencies Added**: pipeline/steps, store, reconcile package, MCP server/skill APIs

## Quality Verification

All quality checks passed:
- ✅ Bazel tests: All 25 tests passing
- ✅ `go vet`: Clean
- ✅ `gofmt`: Clean
- ✅ Proto validation: Embedded resource constraints enforced
- ✅ Error handling: Graceful degradation on reconciliation failures

## Related Work

### Foundation (Already Complete)
- **A1: Project Controller Foundation** - Established base controller structure
- **A3: Reconciliation Value Objects** - Defined ReconciliationResult, ReconciliationOptions, DesiredState, ActualState
- **B1: Dependency Graph** - Graph building for resource dependencies
- **C1: Diff Algorithm** - Diff computation between desired and actual state
- **C2: Execution Order** - Topological sorting for dependency-ordered execution

### Current Phase
- **D4: Apply Handler** ← This changelog

### Next Steps
- **D1: Create/Update Handlers** - Individual create and update operations
- **D2: Get Handlers** - Retrieve operations (by ID, by reference)
- **E2: Execution Engine** - Actual resource creation/update/deletion (replace stub)

## Architecture Patterns Established

1. **Service Interface Pattern**: ReconciliationService demonstrates clean dependency injection
2. **Pipeline Pattern Reuse**: LoadForApply step follows established validation pattern
3. **Store Annotation Pattern**: Using annotations for resource ownership queries
4. **Graceful Degradation**: Apply succeeds even when reconciliation fails
5. **Test Helper Pattern**: Reusable functions for creating test fixtures with proper validation

---

**Status**: ✅ Production Ready (with stubbed execution)
**Phase**: D4 (Project Controller - Apply Handler)
**Next**: D1 (Create/Update Handlers), D2 (Get Handlers), E2 (Execution Engine)
**Lines of Code**: ~800 (production code + tests + documentation)
