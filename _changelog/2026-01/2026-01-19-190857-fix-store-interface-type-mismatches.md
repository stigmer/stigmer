# Fix Store Interface Type Mismatches (Compilation Error Resolution)

**Date**: 2026-01-19  
**Type**: Bug Fix  
**Scope**: Backend Libraries, Services, Tests  
**Impact**: Compilation errors resolved, all packages now build successfully

## Problem

After changing the BadgerDB store interface to accept `apiresourcekind.ApiResourceKind` enum type instead of `string` for the kind parameter, multiple files across the codebase still passed strings, causing compilation failures.

**Error Pattern**:
```
cannot use kindName (variable of type string) as apiresourcekind.ApiResourceKind value in argument to s.store.GetResource
```

**Affected Areas**:
- Pipeline steps (8 files)
- Domain controllers (4 files)
- Test files (6 files)

## Root Cause

The store interface was updated to enforce type safety by accepting the `ApiResourceKind` enum:

```go
// Store interface now requires enum type
type Store interface {
    SaveResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error
    GetResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error
    ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)
    DeleteResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string) error
}
```

However, many call sites were still:
1. Extracting the kind name as a string using `apiresource.GetKindName(kind)`
2. Passing that string to store methods
3. Or directly passing string literals like `"agent"` or `"Agent"`

## Solution

### Pattern 1: Direct Enum Pass-Through (Production Code)

Instead of converting enum → string → pass string, pass the enum directly:

**Before**:
```go
// Get api_resource_kind from request context
kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

// Extract kind name (unnecessary conversion)
kindName, err := apiresource.GetKindName(kind)
if err != nil {
    return fmt.Errorf("failed to get kind name: %w", err)
}

// Pass string to store (TYPE MISMATCH)
err = s.store.SaveResource(ctx.Context(), kindName, metadata.Id, resource)
```

**After**:
```go
// Get api_resource_kind from request context
kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

// Pass enum directly to store (CORRECT TYPE)
err := s.store.SaveResource(ctx.Context(), kind, metadata.Id, resource)
```

**Benefit**: Simpler code, type-safe, no unnecessary string conversion

### Pattern 2: Extract Name Only for Error Messages

When the kind name string is needed for error messages, extract it only at the error point:

**Before**:
```go
kindName, err := apiresource.GetKindName(kind)
if err != nil {
    return fmt.Errorf("failed to get kind name: %w", err)
}

err = s.store.GetResource(ctx.Context(), kindName, id, resource)
if err != nil {
    return grpclib.NotFoundError(kindName, id)
}
```

**After**:
```go
err := s.store.GetResource(ctx.Context(), kind, id, resource)
if err != nil {
    // Extract kind name for error message only
    kindName, _ := apiresource.GetKindName(kind)
    return grpclib.NotFoundError(kindName, id)
}
```

**Benefit**: Cleaner flow, extract string only when actually needed

### Pattern 3: Update Interface Definitions

For custom interfaces (like in session controller list operations):

**Before**:
```go
type listAllSessionsStep struct {
    store interface {
        ListResources(ctx context.Context, kind string) ([][]byte, error)
    }
}
```

**After**:
```go
type listAllSessionsStep struct {
    store interface {
        ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)
    }
}
```

### Pattern 4: Fix Test Literals

Replace string literals with enum values in tests:

**Before**:
```go
err := store.SaveResource(context.Background(), "agent", "agent-123", existing)
```

**After**:
```go
err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, "agent-123", existing)
```

## Files Modified

### Production Code (11 files)

**Pipeline Steps** (`backend/libs/go/grpc/request/pipeline/steps/`):
1. `persist.go` - SaveResource call fixed
2. `delete.go` - GetResource and DeleteResource calls fixed
3. `load_existing.go` - GetResource call fixed
4. `load_target.go` - GetResource call fixed, removed unused `fmt` import
5. `duplicate.go` - ListResources call and function signature fixed, added import
6. `load_by_reference.go` - ListResources call and function signature fixed, added import
7. `load_for_apply.go` - ListResources call and function signature fixed, removed unused import

**Domain Controllers**:
8. `backend/services/stigmer-server/pkg/domain/session/controller/list.go` - Interface signature fixed, removed unused import
9. `backend/services/stigmer-server/pkg/domain/workflow/controller/create.go` - Removed unused import
10. `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/list.go` - Removed unused import
11. `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/query.go` - Removed unused imports

### Test Code (6 files)

**Pipeline Step Tests** (`backend/libs/go/grpc/request/pipeline/steps/`):
1. `duplicate_test.go` - 2 SaveResource calls fixed
2. `load_existing_test.go` - 1 SaveResource call fixed
3. `load_target_test.go` - 1 SaveResource call fixed
4. `load_by_reference_test.go` - 2 SaveResource calls fixed
5. `integration_test.go` - 1 GetResource call fixed
6. `load_for_apply_test.go` - 2 SaveResource calls fixed, removed unnecessary kindName extraction

## Verification

```bash
# Build all packages successfully
$ go build ./...
# Exit code: 0 (success)

# All compilation errors resolved
$ make test 2>&1 | grep "build failed"
# No output (no build failures)
```

## Impact

**Before Fix**:
- ❌ 8 compilation errors in pipeline steps
- ❌ 4 compilation errors in domain controllers
- ❌ 6 compilation errors in tests
- ❌ Multiple packages failed to build
- ❌ Test suite could not run

**After Fix**:
- ✅ All packages compile successfully
- ✅ No type mismatch errors
- ✅ Cleaner code (fewer unnecessary conversions)
- ✅ Type-safe store interface usage
- ✅ Test suite runs (test failures are unrelated validation issues, not compilation errors)

## Type Safety Benefits

This fix enforces compile-time type safety for resource kinds:

1. **Prevents invalid kind strings**: Can't pass arbitrary strings like `"invalid-kind"`
2. **Autocomplete support**: IDEs can suggest valid enum values
3. **Refactoring safety**: Renaming enum values is automatically tracked by compiler
4. **Documentation clarity**: Function signatures clearly show they expect enum types
5. **Runtime validation eliminated**: No need to validate kind strings at runtime

## Lessons Learned

When changing interface signatures:

1. **Search for all call sites**: Use `grep` or IDE find-references to locate all usages
2. **Update tests too**: Don't forget test code - it also needs to match new signatures
3. **Check for string conversions**: Look for `GetKindName()` calls that might be unnecessary
4. **Update interface definitions**: Custom interfaces (not just concrete types) need updates
5. **Clean up unused imports**: After removing conversions, some imports become unused
6. **Verify with full build**: Run `go build ./...` to catch all compilation errors

## Related

- **Store Interface**: `backend/libs/go/badger/store.go` (defines the interface)
- **Kind Enum**: `apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`
- **Metadata Utils**: `backend/libs/go/apiresource/metadata.go` (provides GetKindName helper)
