# Fix Proto Unmarshal Compilation Error in Workflow Execution Controller

**Date**: 2026-01-20 20:27:45  
**Type**: Bug Fix  
**Scope**: Backend / Workflow Execution Controller  
**Impact**: Build System

## Problem

The `make release-local` build was failing with a compilation error:

```
backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go:355:22: 
instance.Unmarshal undefined (type *workflowinstancev1.WorkflowInstance has no field or method Unmarshal)
```

The code was attempting to call `instance.Unmarshal(data)` on a protobuf message struct, but protobuf-generated Go structs do not have an `Unmarshal` method.

## Root Cause

In `findInstanceBySlug()` function within `create.go`, the code was using incorrect protobuf unmarshaling syntax:

```go
// ❌ INCORRECT - protobuf messages don't have Unmarshal method
instance := &workflowinstancev1.WorkflowInstance{}
if err := instance.Unmarshal(data); err != nil {
    // ...
}
```

## Solution

Fixed the protobuf unmarshaling to use the correct API from `google.golang.org/protobuf/proto`:

### Changes Made

**File**: `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go`

1. **Added import**:
```go
import (
    // ... existing imports ...
    "google.golang.org/protobuf/proto"
)
```

2. **Fixed unmarshal call** (line 355):
```go
// ✅ CORRECT - use proto.Unmarshal(data, instance)
instance := &workflowinstancev1.WorkflowInstance{}
if err := proto.Unmarshal(data, instance); err != nil {
    // ...
}
```

## Technical Details

### Protobuf Unmarshaling in Go

The correct syntax for unmarshaling protobuf messages in Go is:

```go
proto.Unmarshal(data []byte, msg proto.Message) error
```

**Parameters**:
- `data`: Byte slice containing the serialized protobuf data
- `msg`: Pointer to the protobuf message struct to populate

**Why this pattern**:
- Protobuf-generated structs implement `proto.Message` interface
- They don't have instance methods for marshaling/unmarshaling
- The `proto` package provides standalone functions
- This allows the proto library to handle versioning and compatibility

### Context: findInstanceBySlug Function

This function searches for a workflow instance by slug:

1. Lists all workflow instance resources from BadgerDB (returns `[][]byte`)
2. Iterates through each byte slice
3. Unmarshals each into `WorkflowInstance` struct
4. Checks if slug matches
5. Returns matching instance or nil

The unmarshal error handling correctly skips instances that can't be deserialized (logged as warnings), allowing the search to continue.

## Impact

**Before Fix**:
- ❌ Build fails with compilation error
- ❌ Cannot run `make release-local`
- ❌ Cannot test workflow execution functionality

**After Fix**:
- ✅ Build compiles successfully
- ✅ `make release-local` works
- ✅ Workflow instance lookup functions correctly

## Testing

**Build Test**:
```bash
make release-local
# Should complete without compilation errors
```

**Runtime Behavior**:
- No functional change - just corrected syntax
- Unmarshaling logic works identically
- Error handling preserved (skips unparseable instances)

## Lessons Learned

### Protobuf Go API Pattern

When working with protobuf in Go, remember:

1. **Marshaling**: `proto.Marshal(msg proto.Message) ([]byte, error)`
2. **Unmarshaling**: `proto.Unmarshal(data []byte, msg proto.Message) error`
3. **No instance methods**: Protobuf structs don't have `Marshal()`/`Unmarshal()` methods
4. **Import path**: Use `google.golang.org/protobuf/proto` (not older `github.com/golang/protobuf/proto`)

### IDE Auto-Complete Pitfall

This error likely came from IDE auto-complete suggesting non-existent methods. Always verify protobuf API usage:
- ✅ Check import statements
- ✅ Verify function signatures
- ✅ Run build early to catch compilation errors

## Related Code

The corrected code is part of the workflow execution creation pipeline:

```
CreateWorkflowExecution
  └── createDefaultInstanceIfNeededStep
      └── findInstanceBySlug()  ← Fixed here
```

This step runs when:
1. User creates execution with `workflow_id` (no instance specified)
2. System needs to find or create default instance
3. Searches existing instances by slug before creating new one

## Files Changed

- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go`
  - Added `google.golang.org/protobuf/proto` import
  - Changed `instance.Unmarshal(data)` to `proto.Unmarshal(data, instance)` on line 355

## Verification

```bash
# Before fix
make release-local
# Error: instance.Unmarshal undefined

# After fix
make release-local
# ✓ CLI built: bin/stigmer
# ✓ Server built: bin/stigmer-server
```

Build system now works correctly for local development and testing.
