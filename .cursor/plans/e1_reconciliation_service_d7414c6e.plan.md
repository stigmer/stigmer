---
name: E1 Reconciliation Service
overview: Implement comprehensive test coverage for the ReconciliationService, validating the core reconciliation orchestration logic (parseDesiredState, fetchActualState, Reconcile) with 30+ tests using mock store patterns.
todos:
  - id: e1-mock-store
    content: Create mockStore implementation in service_test.go with configurable behaviors for FindAllByField
    status: completed
  - id: e1-test-fixtures
    content: Create test fixtures for Project with embedded resources (agents, workflows, mcp_servers, skills)
    status: completed
  - id: e1-reconcile-tests
    content: Implement 8 Reconcile orchestration tests covering nil/empty/error cases
    status: completed
  - id: e1-parse-tests
    content: Implement 8 parseDesiredState tests covering all resource types and slug resolution
    status: completed
  - id: e1-fetch-tests
    content: Implement 6 fetchActualState tests with mock store
    status: completed
  - id: e1-options-tests
    content: Implement 5 options behavior tests (dry-run, prune)
    status: completed
  - id: e1-integration-tests
    content: Implement 5 integration tests for complex scenarios
    status: completed
  - id: e1-build-bazel
    content: Update BUILD.bazel to include service_test.go
    status: completed
isProject: false
---

# E1: Reconciliation Service Core - Test Implementation

## Current State Analysis

The ReconciliationService implementation is already complete in:

- `[reconciliation_service.go](backend/services/stigmer-server/pkg/domain/project/reconcile/reconciliation_service.go)` - Interface definition
- `[service.go](backend/services/stigmer-server/pkg/domain/project/reconcile/service.go)` - Full implementation

Implemented methods:

- `Reconcile()` - Full orchestration flow
- `parseDesiredState()` - Extracts resources from Project.Spec
- `fetchActualState()` - Queries store by ownership annotation
- `resolveSlug()` - Slug extraction/generation
- `planToResult()` - Dry-run result conversion
- `filterDeletes()` - Prune option handling
- `executePlan()` - **Stub** (returns plan as success, actual execution deferred to E2)

**Missing**: Comprehensive unit tests for the service layer.

## Implementation Plan

### 1. Create Mock Store for Testing

Create `mock_store_test.go` with a configurable mock that implements `store.Store`:

```go
type mockStore struct {
    findAllByFieldFunc func(ctx, kind, path, value) ([][]byte, error)
    // other methods return errors by default
}
```

Key behaviors to mock:

- `FindAllByField` - Returns serialized proto bytes for owned resources
- Other methods - Return `ErrNotFound` or appropriate errors

### 2. Test Categories (30+ tests)

**A. Reconcile Orchestration Tests (8 tests)**

- `TestReconcile_NilProject_ReturnsError`
- `TestReconcile_ProjectWithoutID_ReturnsError`
- `TestReconcile_NilOptions_UsesDefaults`
- `TestReconcile_EmptyProject_ReturnsEmptyResult`
- `TestReconcile_FirstApply_ReturnsAllCreates`
- `TestReconcile_NoChanges_ReturnsEmptyResult`
- `TestReconcile_MixedChanges_ReturnsCorrectCounts`
- `TestReconcile_StoreError_ReturnsError`

**B. parseDesiredState Tests (8 tests)**

- `TestParseDesiredState_NilSpec_ReturnsEmpty`
- `TestParseDesiredState_EmptySpec_ReturnsEmpty`
- `TestParseDesiredState_SingleAgent_ExtractsCorrectly`
- `TestParseDesiredState_MultipleAgents_AllExtracted`
- `TestParseDesiredState_AllResourceTypes_ExtractsAll`
- `TestParseDesiredState_UsesSlugIfSet`
- `TestParseDesiredState_GeneratesSlugFromName`
- `TestParseDesiredState_SkipsResourcesWithNoSlug`

**C. fetchActualState Tests (6 tests)**

- `TestFetchActualState_NoResources_ReturnsEmpty`
- `TestFetchActualState_AgentsOnly_ReturnsAgents`
- `TestFetchActualState_AllTypes_ReturnsAll`
- `TestFetchActualState_SkipsUnmarshalErrors`
- `TestFetchActualState_StoreError_ReturnsError`
- `TestFetchActualState_UsesCorrectAnnotationPath`

**D. Options Behavior Tests (5 tests)**

- `TestReconcile_DryRun_DoesNotExecute`
- `TestReconcile_DryRun_ReturnsFullPlan`
- `TestReconcile_PruneDisabled_NoDeletes`
- `TestReconcile_PruneEnabled_IncludesDeletes`
- `TestReconcile_DefaultOptions_PruneEnabledNotDryRun`

**E. Integration/End-to-End Tests (5 tests)**

- `TestReconcile_ComplexScenario_CorrectPlan`
- `TestReconcile_DependencyOrderRespected`
- `TestReconcile_UpdateDetectsSpecChanges`
- `TestReconcile_UpdateIgnoresMetadataChanges`
- `TestReconcile_OrphanDetection`

### 3. Test File Structure

Create `service_test.go` in the reconcile package:

```
backend/services/stigmer-server/pkg/domain/project/reconcile/
  service_test.go     # New: 30+ tests for ReconciliationService
```

### 4. Update BUILD.bazel

Add `service_test.go` to the test sources in `[BUILD.bazel](backend/services/stigmer-server/pkg/domain/project/reconcile/BUILD.bazel)`.

## Key Implementation Details

### Mock Store Pattern

```go
type mockStore struct {
    resources map[apiresourcekind.ApiResourceKind]map[string][]byte
}

func (m *mockStore) FindAllByField(
    ctx context.Context,
    kind apiresourcekind.ApiResourceKind,
    fieldPath string,
    value string,
) ([][]byte, error) {
    // Return pre-configured resources
}
```

### Test Fixtures

Reuse fixture patterns from `diff_test.go`:

- `createTestAgent(slug, description)`
- `createTestWorkflow(slug, description)`
- etc.

Add project-specific fixtures:

- `createTestProject(name string) *projectv1.Project`
- `createTestProjectWithSpec(spec *projectv1.ProjectSpec) *projectv1.Project`

### Proto Serialization for Mock Store

```go
func marshalToBytes(msg proto.Message) []byte {
    bytes, _ := proto.Marshal(msg)
    return bytes
}
```

## Quality Requirements

- All tests use table-driven format where applicable
- Descriptive test names following Go conventions
- No test dependencies on execution order
- Comprehensive error message assertions
- Test coverage > 80% for service.go

