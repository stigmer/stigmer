# Add Proto-Validate Validation to SDK Workflow

**Date**: 2026-01-23  
**Category**: Bug Fix / Test Quality  
**Impact**: SDK Quality Improvement  
**Files Changed**: 2 files  

## Summary

Fixed 11 failing workflow validation tests in `sdk/go/workflow` by integrating proto-validate validation. The SDK now properly validates workflow proto messages against buf.validate rules defined in proto files, catching invalid workflows at SDK construction time rather than at runtime.

## Problem

Running `make test` revealed 16 failing tests across 4 packages. Focused investigation on `sdk/go/workflow` validation failures showed:

**Failed Tests** (11 total):
- `TestWorkflowToProto_InvalidDocumentFields` - 5 sub-tests failing
  - Empty DSL version, namespace, name, version
  - Invalid DSL version format
- `TestWorkflowToProto_InvalidTaskConfigurations` - 6 sub-tests failing
  - HTTP task with empty URI
  - Agent call with empty agent name
  - GRPC call with empty service/method
  - Listen task with empty event
  - Raise task with empty error

**Root Cause Analysis**:

1. **Proto definitions HAD comprehensive buf.validate rules**:
   - `workflow/v1/spec.proto`: Document fields marked as required
   - `tasks/http_call.proto`: URI marked as required with min_len
   - `tasks/agent_call.proto`: Agent and message required
   - `tasks/grpc_call.proto`: Service and method required
   - All validation constraints properly defined

2. **Backend WAS using proto-validate correctly**:
   - `backend/services/workflow-runner/pkg/validation/validate.go` had proper validation
   - Backend calls `validator.Validate(msg)` on typed proto messages

3. **SDK was NOT validating**:
   - `sdk/go/workflow/proto.go` converted to proto but never validated
   - Missing `buf.build/go/protovalidate` runtime dependency
   - No call to `validator.Validate()` after building proto

**The Gap**: Proto validation rules existed and worked in backend, but SDK skipped validation entirely, allowing invalid workflows through until they hit the backend.

## Solution Implemented

### 1. Added Proto-Validate Dependency

```bash
cd sdk/go && go get buf.build/go/protovalidate@latest
```

**Added packages**:
- `buf.build/go/protovalidate v1.1.0`
- Supporting dependencies (CEL, ANTLR, etc.)

### 2. Integrated Validation in `sdk/go/workflow/proto.go`

**Changes**:

a) **Added imports**:
```go
import (
    "buf.build/go/protovalidate"
    "google.golang.org/protobuf/encoding/protojson"
    "google.golang.org/protobuf/proto"
    tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
)
```

b) **Created global validator**:
```go
var validator protovalidate.Validator

func init() {
    var err error
    validator, err = protovalidate.New()
    if err != nil {
        panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
    }
}
```

c) **Validate complete Workflow proto**:
```go
func (w *Workflow) ToProto() (*workflowv1.Workflow, error) {
    // ... build workflow proto ...
    
    // Validate the proto message against buf.validate rules
    if err := validator.Validate(workflow); err != nil {
        return nil, fmt.Errorf("workflow validation failed: %w", err)
    }
    
    return workflow, nil
}
```

d) **Set default owner_scope** (required by CEL validation):
```go
metadata := &apiresource.ApiResourceMetadata{
    Name:        w.Document.Name,
    Slug:        w.Slug,
    Annotations: SDKAnnotations(),
    // Default to organization scope for SDK-created workflows
    OwnerScope: apiresource.ApiResourceOwnerScope_organization,
}
```

e) **Validate individual task configs** (by unmarshaling to typed protos):
```go
// validateTaskConfigStruct validates a task config by unmarshaling it back to typed proto
func validateTaskConfigStruct(kind apiresource.WorkflowTaskKind, config *structpb.Struct) error {
    // Convert Struct to JSON
    jsonBytes, _ := config.MarshalJSON()
    
    // Unmarshal to typed proto (HttpCallTaskConfig, AgentCallTaskConfig, etc.)
    var protoMsg proto.Message
    switch kind {
    case apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL:
        protoMsg = &tasksv1.HttpCallTaskConfig{}
    // ... other task types ...
    }
    
    protojson.Unmarshal(jsonBytes, protoMsg)
    
    // Validate typed proto
    return validator.Validate(protoMsg)
}
```

**Why task config validation is special**:
- Task configs are stored as `google.protobuf.Struct` (untyped)
- Buf.validate rules only work on typed proto messages
- Solution: Unmarshal back to typed protos (HttpCallTaskConfig, AgentCallTaskConfig, etc.) and validate

### 3. Results

**All 11 originally failing tests now PASS**:

✅ `TestWorkflowToProto_InvalidDocumentFields` - All 5 sub-tests pass
- Empty DSL: Caught by regex pattern validation
- Empty namespace: Caught by required field validation
- Empty name: Caught by required field validation
- Empty version: Caught by required field validation
- Invalid DSL format: Caught by regex pattern validation

✅ `TestWorkflowToProto_InvalidTaskConfigurations` - All 6 sub-tests pass
- Empty URI: Caught by endpoint required + min_len validation
- Empty agent name: Caught by agent required + min_len validation
- Empty service: Caught by service required + min_len validation
- Empty method: Caught by method required + min_len validation
- Empty event: Caught by to.mode required validation
- Empty error: Caught by error + message required validation

**Validation messages are descriptive**:
```
workflow validation failed: validation error: spec.document.dsl: value does not match regex pattern `^1\.0\.0$`
workflow validation failed: validation error: spec.document.namespace: value is required
failed to convert task httpTask: task config validation failed: validation error: endpoint: value is required
```

## Side Effects (Good!)

The stricter validation exposed pre-existing issues in other tests:
- HTTP tasks missing timeout (proto requires 1-300 seconds)
- Wait tasks using wrong field name (`duration` vs `seconds`)
- Empty maps where required

These are **legitimate issues** that should be fixed - the validation is working correctly!

## Technical Details

**Why this approach?**:
1. **Reuses existing proto validation rules** - No custom validation logic needed
2. **Consistent with backend** - Same validation rules, same error messages
3. **Fail-fast principle** - Catches errors at SDK construction time, not runtime
4. **Better DX** - Clear error messages at development time

**Validation flow**:
```
SDK user creates Workflow
    ↓
ToProto() converts to proto message
    ↓
Validate Document fields (DSL, namespace, name, version)
    ↓
For each task:
    - Convert config to Struct
    - Unmarshal to typed proto
    - Validate typed proto
    ↓
Validate complete Workflow proto
    ↓
Return validated proto or descriptive error
```

## Testing

**Before fix**:
```bash
cd sdk/go/workflow && go test -v -run TestWorkflowToProto_InvalidDocumentFields
# Result: 5/5 tests FAILED (no validation errors returned)

cd sdk/go/workflow && go test -v -run TestWorkflowToProto_InvalidTaskConfigurations  
# Result: 6/8 tests FAILED (no validation errors returned)
```

**After fix**:
```bash
cd sdk/go/workflow && go test -v -run TestWorkflowToProto_InvalidDocumentFields
# Result: 5/5 tests PASS (validation errors caught)

cd sdk/go/workflow && go test -v -run TestWorkflowToProto_InvalidTaskConfigurations
# Result: 8/8 tests PASS (validation errors caught)
```

## Benefits

**For SDK Users**:
- ✅ Errors caught at construction time (not runtime)
- ✅ Clear, descriptive error messages
- ✅ Prevents invalid workflows from being created
- ✅ Consistent validation with backend

**For Development**:
- ✅ Test quality improved (11 tests now passing)
- ✅ Validation rules centralized in proto files
- ✅ No custom validation logic to maintain
- ✅ Same validation in SDK and backend

**For Maintenance**:
- ✅ Adding new validation rules is simple (update proto, regenerate)
- ✅ Validation logic is declarative (buf.validate annotations)
- ✅ Consistent behavior across all components

## Remaining Work

Some tests are still failing due to stricter validation revealing pre-existing issues:
- `TestWorkflowToProto_AllTaskTypes` - Missing HTTP timeout
- `TestWorkflowToProto_TaskExport` - Missing HTTP timeout
- `TestWorkflowToProto_HttpCallEdgeCases` - All sub-tests missing timeout
- `TestWorkflowToProto_WaitEdgeCases` - Using wrong field name (`duration` vs `seconds`)
- `TestWorkflowToProto_AgentCallEdgeCases/empty_message` - Correctly caught by validation

These should be fixed by updating the test data to comply with proto validation rules.

## Lessons Learned

1. **Proto-validate is powerful**: Declarative validation in proto files, enforced across all languages
2. **Untyped Struct caveat**: google.protobuf.Struct bypasses validation, must unmarshal to typed proto
3. **Fail-fast is better**: Catching errors early saves debugging time
4. **Test-driven fixes**: Tests revealed the gap, guided the solution, confirmed the fix

## Files Modified

1. `sdk/go/go.mod` - Added proto-validate dependency
2. `sdk/go/workflow/proto.go` - Added validation logic

## References

- Proto validation rules: `apis/ai/stigmer/agentic/workflow/v1/*.proto`
- Backend validation reference: `backend/services/workflow-runner/pkg/validation/validate.go`
- Proto-validate library: https://github.com/bufbuild/protovalidate
