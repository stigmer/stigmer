# Add Validation Step to Agent Create Pipeline

**Date**: 2026-01-18  
**Type**: Backend Enhancement  
**Scope**: `backend/services/stigmer-server`, `backend/libs/go/grpc/request/pipeline/steps`

## Summary

Added the `ValidateProtoStep` to the agent creation pipeline and improved its constructor signature to match other generic pipeline steps. This ensures that proto field constraints (defined using buf validate) are validated before any other processing occurs.

## Changes Made

### 1. Added Validation to Agent Create Pipeline

**File**: `backend/services/stigmer-server/pkg/controllers/agent/create.go`

- Added `ValidateProtoStep` as the first step in the agent creation pipeline
- Updated pipeline documentation to reflect that validation is now implemented (removed TODO)
- Validation step runs before slug resolution, duplicate checking, and all other steps

### 2. Simplified ValidateProtoStep Constructor

**File**: `backend/libs/go/grpc/request/pipeline/steps/validation.go`

- Changed `NewValidateProtoStep()` signature from returning `(*ValidateProtoStep[T], error)` to `*ValidateProtoStep[T]`
- Constructor now panics on initialization failure instead of returning an error
- This matches the pattern of other generic step constructors (`NewResolveSlugStep`, `NewSetDefaultsStep`, etc.)
- Initialization errors are setup-time errors, not runtime errors, so panic is appropriate

**Rationale**: Returning an error from the constructor forced special handling in every pipeline that used it, breaking the clean fluent API pattern. Since validator initialization failure is a fatal setup error (not a recoverable runtime error), panicking is more appropriate and allows the step to be used consistently with other steps.

### 3. Updated Validation Tests

**File**: `backend/libs/go/grpc/request/pipeline/steps/validation_test.go`

- Removed error handling from all test functions
- Simplified test setup to match pattern of other step tests
- Updated integration test to use inline step construction

## Impact

### Improved Validation

- Agent creation requests are now validated against proto field constraints before processing
- Validation errors are caught early, before database operations or other side effects
- Consistent with Stigmer Cloud's validation approach (Step 1 in the pipeline)

### Cleaner API

- `ValidateProtoStep` can now be used exactly like other generic steps
- No special error handling required in pipeline construction
- More maintainable and consistent codebase

### Developer Experience

- Pipeline construction is simpler and more readable
- One-liner to add validation: `AddStep(steps.NewValidateProtoStep[*agentv1.Agent]())`
- No need to handle initialization errors in every pipeline

## Technical Details

### Pipeline Order

The agent creation pipeline now executes steps in this order:

1. **ValidateProtoConstraints** - Validate proto field constraints using buf validate ✅ (new)
2. Authorize - Verify caller has permission (TODO)
3. **ResolveSlug** - Generate slug from metadata.name
4. **CheckDuplicate** - Verify no duplicate exists
5. **SetDefaults** - Set ID, kind, api_version, timestamps
6. **Persist** - Save agent to repository
7. CreateIamPolicies - Establish ownership relationships (TODO)
8. **CreateDefaultInstance** - Create default agent instance
9. **UpdateAgentStatusWithDefaultInstance** - Update agent status with default_instance_id
10. Publish - Publish event (TODO)

### Validation Rules

The validation step uses `buf.build/go/protovalidate` to validate all constraints defined in proto files using buf validate annotations (e.g., `buf.validate.field`, required fields, min/max values, regex patterns, etc.).

## Files Changed

```
backend/libs/go/grpc/request/pipeline/steps/validation.go
backend/libs/go/grpc/request/pipeline/steps/validation_test.go
backend/services/stigmer-server/pkg/controllers/agent/create.go
```

## Migration Notes

This change is backwards compatible:
- Existing pipelines without validation continue to work
- New pipelines can add validation with a single line
- The `ValidateProtoStep` was already designed as a generic, reusable component

## Next Steps

- Add `ValidateProtoStep` to other resource creation pipelines (workflows, tasks, etc.)
- Define buf validate constraints in proto files where needed
- Consider adding validation to update operations as well

---

**Related**: 
- Pipeline framework: `backend/libs/go/grpc/request/pipeline/`
- Other generic steps: `ResolveSlugStep`, `CheckDuplicateStep`, `SetDefaultsStep`, `PersistStep`
- Validation step: `backend/libs/go/grpc/request/pipeline/steps/validation.go`
