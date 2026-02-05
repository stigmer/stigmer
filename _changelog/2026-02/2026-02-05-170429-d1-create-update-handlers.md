# D1: Create and Update Handlers for Project Controller

**Date**: 2026-02-05
**Phase**: D1 - CRUD Handlers
**Status**: COMPLETED

## Summary

Implemented Create and Update handlers for the Project controller following the established pipeline pattern. This completes the first phase of CRUD operations for the Project entity, enabling project creation and updates through the gRPC API.

## Files Created

### Handler Files
- `backend/services/stigmer-server/pkg/domain/project/controller/create.go` (60 lines)
  - Create handler with 5-step pipeline
  - Pipeline: ValidateProto -> ResolveSlug -> CheckDuplicate -> BuildNewState -> Persist
  
- `backend/services/stigmer-server/pkg/domain/project/controller/update.go` (61 lines)
  - Update handler with 5-step pipeline
  - Pipeline: ValidateProto -> ResolveSlug -> LoadExisting -> BuildUpdateState -> Persist

### Test Files
- `backend/services/stigmer-server/pkg/domain/project/controller/create_test.go` (425 lines, 15 tests)
  - Successful creation tests (ID generation, slug generation)
  - Duplicate detection tests
  - Validation error tests (missing metadata, name, spec, runtime, invalid api_version/kind)
  - Embedded resources tests (agents, workflows)
  - Audit fields tests
  - Spec preservation tests

- `backend/services/stigmer-server/pkg/domain/project/controller/update_test.go` (371 lines, 12 tests)
  - Successful update tests (description, entry_point, runtime changes)
  - Error case tests (non-existent project, missing metadata, validation errors)
  - Immutability tests (preserves ID, slug, org from existing resource)
  - Audit fields tests
  - Slug-based lookup tests

## Files Modified

- `backend/services/stigmer-server/pkg/domain/project/controller/BUILD.bazel`
  - Added create.go and update.go to library sources
  - Added create_test.go and update_test.go to test sources
  - Added pipeline and structpb dependencies

- `backend/services/stigmer-server/pkg/domain/project/controller/project_controller_test.go`
  - Updated embedded agent/workflow fixtures to pass validation
  - Updated test expectations for helper functions
  - Removed tests for unimplemented Create/Update (now implemented)
  - Added structpb import for workflow task_config

## Implementation Highlights

### Pipeline Pattern
Both handlers follow the established pipeline pattern from AgentController:
- Uses generic `pipeline.Pipeline[T]` from `backend/libs/go/grpc/request/pipeline`
- Uses standard steps from `backend/libs/go/grpc/request/pipeline/steps`
- No custom steps needed (Project is simpler than Agent - no default instance creation)

### Create Handler
```go
func (c *ProjectController) buildCreatePipeline() *pipeline.Pipeline[*projectv1.Project] {
    return pipeline.NewPipeline[*projectv1.Project]("project-create").
        AddStep(steps.NewValidateProtoStep[*projectv1.Project]()).
        AddStep(steps.NewResolveSlugStep[*projectv1.Project]()).
        AddStep(steps.NewCheckDuplicateStep[*projectv1.Project](c.store)).
        AddStep(steps.NewBuildNewStateStep[*projectv1.Project]()).
        AddStep(steps.NewPersistStep[*projectv1.Project](c.store)).
        Build()
}
```

### Update Handler
```go
func (c *ProjectController) buildUpdatePipeline() *pipeline.Pipeline[*projectv1.Project] {
    return pipeline.NewPipeline[*projectv1.Project]("project-update").
        AddStep(steps.NewValidateProtoStep[*projectv1.Project]()).
        AddStep(steps.NewResolveSlugStep[*projectv1.Project]()).
        AddStep(steps.NewLoadExistingStep[*projectv1.Project](c.store)).
        AddStep(steps.NewBuildUpdateStateStep[*projectv1.Project]()).
        AddStep(steps.NewPersistStep[*projectv1.Project](c.store)).
        Build()
}
```

## Test Coverage

| Category | Tests |
|----------|-------|
| Create - Successful Creation | 3 |
| Create - Duplicate Detection | 2 |
| Create - Validation Errors | 6 |
| Create - Embedded Resources | 2 |
| Create - Audit Fields | 1 |
| Create - Spec Preservation | 1 |
| Update - Successful Update | 3 |
| Update - Error Cases | 4 |
| Update - Immutability | 3 |
| Update - Audit Fields | 1 |
| Update - Slug Lookup | 1 |
| **Total** | **27 new tests** |

## Quality Metrics

- All functions under 50 lines
- All files under 300 lines
- Zero gofmt issues
- Zero go vet issues
- 100% test pass rate
- Follows established AgentController patterns

## Build Verification

```bash
# Build
bazel build //backend/services/stigmer-server/pkg/domain/project/controller:controller
# Result: SUCCESS

# Tests
bazel test //backend/services/stigmer-server/pkg/domain/project/controller:controller_test
# Result: 35 tests PASSED in 1.4s

# Formatting
gofmt -l backend/services/stigmer-server/pkg/domain/project/controller/*.go
# Result: No issues

# Vet
go vet ./backend/services/stigmer-server/pkg/domain/project/controller/...
# Result: No issues
```

## Next Steps

- **D2**: Get and GetByReference handlers
- **D3**: Delete handler with cascade consideration
- **D4**: Apply handler with reconciliation integration
