# Fix Pipeline Tests for NewState Auto-Initialization

**Date**: 2026-01-23 20:09:45  
**Type**: Test Fix  
**Scope**: Backend Libs (Go) - gRPC Request Pipeline  
**Files Changed**: 4 files, 22 insertions(+), 10 deletions(-)

## Summary

Fixed two failing pipeline tests caused by recent `newState` behavior change where `NewRequestContext` now automatically clones the input for immutability. Tests were expecting old behavior (nil `newState` and immutable name field) and needed updates to match new implementation.

## Problem

Running `make test` showed failures in:
1. `TestContextState` - Expected `NewState()` to be initially `nil`
2. `TestBuildUpdateStateStep_Execute` - Expected `name` to be preserved (immutable) during updates

Both failures were caused by recent changes to how `newState` is initialized and handled.

## Root Cause Analysis

### Issue 1: Context NewState Initialization

**Test expectation (OLD)**:
```go
// Initially NewState should be nil
if ctx.NewState() != nil {
    t.Error("NewState should initially be nil")
}
```

**Implementation (NEW)**:
```go
// backend/libs/go/grpc/request/pipeline/context.go:52
newState: proto.Clone(input).(T), // Automatically clone for immutability
```

The implementation was changed to **automatically clone** the input into `newState` during `NewRequestContext` creation for immutability, but the test still expected `nil`.

### Issue 2: Name Field Mutability

**Test expectation (OLD)**:
```go
// Check that name was preserved from existing (not from input)
if updated.Metadata.Name != "existing-agent" {
    t.Errorf("Expected name to be preserved as %q, got %q", "existing-agent", updated.Metadata.Name)
}
```

**Stigmer Cloud implementation (Java)**:
```java
// UpdateOperationPreserveResourceIdentifiersStepV2.java:58-61
var preservedMetadata = newResourceMetadata.toBuilder()
        .setOrg(existingResourceMetadata.getOrg())
        .setSlug(existingResourceMetadata.getSlug())
        .setId(existingResourceMetadata.getId()).build();
// Note: name is NOT preserved - it's mutable!
```

The Stigmer OSS Go implementation correctly allows `name` to be mutable (matching Cloud behavior), but the test incorrectly expected it to be immutable.

## Verification Against Cloud Implementation

Checked Stigmer Cloud Java backend to confirm field mutability:

**Immutable fields** (preserved during update):
- ✅ `id` - Resource identifier
- ✅ `slug` - URL-safe identifier (derived from original name)
- ✅ `org` - Organization

**Mutable fields** (can be updated):
- ✅ `name` - Display name (users can rename resources)
- ✅ Other metadata fields (title, description, labels, tags)

This makes sense because:
- Slug provides stable URL references even if display name changes
- Users should be able to fix typos or rename resources
- Only identity fields (id, slug, org) should be immutable

## Solution

### Fix 1: Update Context Test for Auto-Initialization

Changed test to expect `newState` to be automatically initialized with a clone:

```go
// NewState should be automatically initialized with a clone of input
if ctx.NewState() == nil {
    t.Error("NewState should be automatically initialized, not nil")
}

// NewState should be a different instance from input (cloned for immutability)
if ctx.NewState() == ctx.Input() {
    t.Error("NewState should be a clone, not the same instance as Input")
}
```

### Fix 2: Update Build Update Test for Mutable Name

Changed test to expect `name` to be updated from input:

```go
// Check that name was updated from input (name is mutable, not preserved)
if updated.Metadata.Name != "updated-agent" {
    t.Errorf("Expected name to be updated to %q, got %q", "updated-agent", updated.Metadata.Name)
}
```

Also updated comment to clarify:
```go
Name: "updated-agent", // Different name - should be updated (name is mutable)
```

## Test Results

**Before fixes**:
```
FAIL: TestContextState - NewState should initially be nil
FAIL: TestBuildUpdateStateStep_Execute - Expected name to be preserved as "existing-agent", got "updated-agent"
```

**After fixes**:
```
PASS: TestContextState
PASS: TestBuildUpdateStateStep_Execute
PASS: All backend libs tests (cached)
```

## Impact

**Scope**: Internal test code only

**Changes**:
- ✅ Tests now align with implementation behavior
- ✅ Tests validate correct auto-initialization of `newState`
- ✅ Tests validate correct name mutability (matching Cloud)
- ✅ Backend libs test suite passes completely

**No functional changes**: The implementation was already correct; only tests needed updates to match.

## Files Modified

```
backend/libs/go/grpc/request/pipeline/context_test.go                (3 changes)
backend/libs/go/grpc/request/pipeline/steps/build_update_state_test.go   (4 changes)
apis/stubs/go/go.mod                                                      (BUILD.bazel generation)
backend/services/workflow-runner/pkg/zigflow/tasks/...                   (unrelated changes)
```

## Cross-Repository Consistency

This fix ensures Stigmer OSS behavior matches Stigmer Cloud:
- ✅ Both use auto-initialized `newState` for immutability
- ✅ Both allow `name` to be mutable during updates
- ✅ Both preserve only `id`, `slug`, and `org` as immutable

## Related

- **Original change**: Auto-initialization of `newState` in `NewRequestContext`
- **Cloud reference**: `UpdateOperationPreserveResourceIdentifiersStepV2.java`
- **Test files**: `context_test.go`, `build_update_state_test.go`
