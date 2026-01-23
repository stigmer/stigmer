# Infrastructure: Switch to ULID for ID Generation Consistency

**Date**: 2026-01-22  
**Type**: Infrastructure Improvement  
**Status**: ✅ Complete

## Context

While working on E2E integration testing, identified that Stigmer OSS was using Unix nanosecond timestamps for resource ID generation while Stigmer Cloud uses ULID. This inconsistency could cause issues with:
- Cross-environment testing
- Data migration scenarios
- Documentation examples
- User expectations

## What Was Done

### ID Generation Migration

**Before**:
```
Format: {prefix}-{unix-nano-timestamp}
Example: agt-1705678901234567890
```

**After**:
```
Format: {prefix}-{lowercase-ulid}
Example: agt-01arz3ndektsv4rrffq69g5fav
```

### Changes Made

1. **Updated ID Generation Logic**
   - File: `backend/libs/go/grpc/request/pipeline/steps/defaults.go`
   - Function: `generateID(prefix string) string`
   - Switched from `time.Now().UnixNano()` to ULID generation
   - Applied lowercase conversion for consistency with cloud

2. **Added Dependencies**
   - Added `github.com/oklog/ulid/v2` (v2.1.1)
   - Added `crypto/rand` import for secure randomness
   - Added `strings` import for lowercase conversion

3. **Updated Documentation**
   - Enhanced function comments to explain ULID format
   - Updated examples in BuildNewStateStep documentation
   - Clarified benefits (sortability, collision resistance, UUID compatibility)

## Benefits

- **Consistency**: OSS and Cloud now use same ID format
- **Sortability**: IDs maintain lexicographic time-ordering
- **Collision Resistance**: Cryptographic randomness prevents ID collisions
- **Standards Alignment**: ULID is widely adopted industry standard
- **UUID Compatible**: 128-bit format compatible with UUID systems

## Compatibility

✅ **Fully backward compatible**
- Existing timestamp-based IDs continue to work
- System handles mixed ID formats gracefully
- No migration required for existing resources
- No breaking changes

## Testing

- ✅ Code compiles successfully
- ✅ ID format verified (lowercase, 26-char alphanumeric)
- ✅ Maintains idempotent behavior (only generates if not set)

## Impact on E2E Tests

**Minimal impact on E2E testing work**:
- E2E tests use CLI commands that handle any ID format
- Agent ID extraction regex already accommodates variable-length IDs
- Tests pass with both timestamp and ULID formats

**Future benefit**:
- E2E tests can now be used against both OSS and Cloud environments
- ID format consistency simplifies cross-environment validation

## Files Modified

```
backend/libs/go/grpc/request/pipeline/steps/defaults.go
backend/libs/go/go.mod
backend/libs/go/go.sum
```

## References

- **Changelog**: `_changelog/2026-01/2026-01-22-233514-switch-id-generation-to-ulid.md`
- **ULID Spec**: https://github.com/ulid/spec
- **Go Library**: https://github.com/oklog/ulid

---

**Note**: This was infrastructure work done during the E2E integration testing project timeframe. While not directly part of the E2E testing goals, it improves consistency between OSS and Cloud environments, which benefits testing scenarios.
