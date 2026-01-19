# Remove Slug Truncation to Prevent Collisions

**Date**: 2026-01-20  
**Category**: Bug Fix / Enhancement  
**Scope**: Backend Pipeline - Slug Generation  
**Impact**: Critical - Prevents data integrity issues

## Problem

The slug generation logic in `backend/libs/go/grpc/request/pipeline/steps/slug.go` had a critical flaw that could cause slug collisions:

**Truncation Issue**: Slugs were truncated to 59 characters, causing different resource names to generate identical slugs.

**Example collision scenario**:
- Name 1: `"...maximum allowed length for kubernetes-AAAA"`
- Name 2: `"...maximum allowed length for kubernetes-BBBB"`
- Both truncated to: `"...maximum-all"` ← **COLLISION**

When the second resource was created, it would be rejected by `CheckDuplicateStep` with "already exists" error, but the root cause (silent truncation) was not obvious.

**Additional test failures**:
- Unicode character handling (was keeping non-ASCII characters)
- Long name truncation (expected 59 chars, was producing 60 or 63)
- Space preservation in `removeNonAlphanumeric` helper

## Root Cause

The Go implementation differed from the Java implementation (`ApiRequestResourceSlugGenerator.java`):

| Feature | Java | Go (Before) | Go (After) |
|---------|------|-------------|------------|
| Truncation | ❌ None | ✅ 59 chars | ❌ None |
| Collision Prevention | ✅ Full slug | ❌ Truncation caused collisions | ✅ Full slug |
| Unicode Handling | ✅ ASCII only | ❌ Unicode allowed | ✅ ASCII only |

The Java implementation generates full slugs without truncation, relying on duplicate checking at the persistence layer.

## Solution

### 1. Removed Truncation Logic

**Changed in `slug.go`**:
```go
// Before: Truncated to 59 characters
if len(slug) > 59 {
    slug = slug[:59]
    slug = strings.TrimRight(slug, "-")
}

// After: No truncation - preserves full slug
// No truncation - preserves full slug to avoid collisions
// If length validation is needed, it should be done at a higher layer
// with a clear error message rather than silent truncation
```

**Rationale**: 
- Different names with same first 59 characters now generate different slugs
- Prevents silent collisions
- Aligns with Java implementation
- If slug length becomes a concern, explicit validation can be added with clear error messages

### 2. Fixed Unicode Character Handling

**Changed in `removeNonAlphanumeric()`**:
```go
// Before: Allowed all Unicode letters
if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' {
    builder.WriteRune(r)
}

// After: ASCII alphanumeric only
if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || 
   (r >= '0' && r <= '9') || r == '-' || r == ' ' {
    builder.WriteRune(r)
}
```

**Impact**: Unicode characters (Chinese, Japanese, etc.) are now properly removed from slugs, ensuring only ASCII alphanumeric characters, hyphens, and spaces are kept.

### 3. Added Space Preservation

Spaces are now preserved in `removeNonAlphanumeric()` (they get converted to hyphens earlier in the pipeline), ensuring the helper function works correctly when called directly.

### 4. Updated Tests

**Modified test case**:
```go
// Test name updated to reflect new behavior
name: "long name - should preserve full length"

// Expected slug is now full-length
expectedSlug: "this-is-a-very-long-agent-name-that-exceeds-the-maximum-allowed-length-for-kubernetes-dns-labels"
```

**Added collision prevention test**:
```go
func TestGenerateSlug_NoCollisions(t *testing.T) {
    // Verifies that different names generate different slugs
    // Documents why truncation was removed
    
    name1 := "...maximum allowed AAAA"
    name2 := "...maximum allowed BBBB"
    
    slug1 := generateSlug(name1)
    slug2 := generateSlug(name2)
    
    // Should be different
    assert.NotEqual(t, slug1, slug2)
}
```

### 5. Removed Unused Import

Removed `unicode` package import since `unicode.IsLetter()` is no longer used.

## Impact

### Positive

1. **No Silent Collisions**: Different names always generate different slugs
2. **Data Integrity**: Prevents accidental resource overwrites from slug collisions
3. **Java Parity**: Go and Java implementations now behave identically
4. **Clear Errors**: If slug length is a concern, validation can provide explicit error messages
5. **Test Coverage**: New test verifies collision prevention behavior

### Potential Concerns

**Very long slugs**: Resources with extremely long names will now have correspondingly long slugs.

**Mitigation**: 
- `CheckDuplicateStep` will catch any actual duplicate slugs
- If length becomes a problem, explicit validation can be added with clear error messages
- Kubernetes DNS label limit (63 chars) doesn't apply to slugs stored in database

## Files Changed

**Modified**:
- `backend/libs/go/grpc/request/pipeline/steps/slug.go` - Removed truncation, fixed unicode handling
- `backend/libs/go/grpc/request/pipeline/steps/slug_test.go` - Updated tests, added collision test

**Test Results**: All tests pass (✅ 16/16 slug tests)

## Migration Notes

**Existing Resources**: No migration needed. Existing resources with truncated slugs remain unchanged. Only new resources will use the full-length slug generation.

**Backward Compatibility**: ✅ Fully compatible. Existing slugs continue to work.

## Related

- **Java Reference**: `ApiRequestResourceSlugGenerator.java` in `stigmer-cloud/backend/libs/java/api/api-shape`
- **Duplicate Checking**: `duplicate.go` - Catches any slug collisions at persistence layer
- **Issue**: User identified collision risk during code review
