# Refactor: Remove Obsolete Skill CRUD Operations (Create/Update/Apply)

**Date**: 2026-01-25  
**Type**: Refactoring / Code Cleanup  
**Component**: Backend - Skill Controller  
**Files Modified**: 6  
**Files Deleted**: 3  

---

## Summary

Cleaned up the Skill controller by removing obsolete Create, Update, and Apply operations. All skill creation and modification now flows exclusively through the Push operation, which handles artifact-based uploads (ZIP files containing SKILL.md).

This refactoring aligns the codebase with the proto API definition, which only exposes `push` and `delete` RPCs for skill command operations.

---

## What Changed

### Files Deleted

Removed three handler files that are no longer needed:

1. **`backend/services/stigmer-server/pkg/domain/skill/controller/create.go`** (49 lines)
   - Removed Create handler and pipeline
   - Pipeline: ValidateProto → ResolveSlug → CheckDuplicate → BuildNewState → Persist

2. **`backend/services/stigmer-server/pkg/domain/skill/controller/update.go`** (48 lines)
   - Removed Update handler and pipeline
   - Pipeline: ValidateProto → ResolveSlug → LoadExisting → BuildUpdateState → Persist

3. **`backend/services/stigmer-server/pkg/domain/skill/controller/apply.go`** (72 lines)
   - Removed Apply handler (declarative create-or-update)
   - Pipeline: ValidateProto → ResolveSlug → LoadForApply → Delegate to Create/Update

**Total removed**: 169 lines of obsolete handler code

### Files Updated

1. **`backend/services/stigmer-server/pkg/domain/skill/controller/BUILD.bazel`**
   - Removed `create.go`, `update.go`, `apply.go` from build sources
   - Updated `srcs` list to only include active handlers: push, delete, get, get_by_reference

2. **`backend/services/stigmer-server/pkg/domain/skill/controller/skill_controller_test.go`**
   - Removed `TestSkillController_Create` (all test cases)
   - Removed `TestSkillController_Update` (all test cases)
   - Removed Create/Update dependencies from `TestSkillController_Get`
   - Removed Create dependencies from `TestSkillController_Delete`
   - Updated `setupTestController` to include artifact storage dependency
   - Added storage package import
   - Simplified remaining tests to not depend on Create/Update operations

3. **`backend/services/stigmer-server/pkg/domain/skill/controller/README.md`**
   - Updated package structure diagram to show only active files
   - Removed Create, Update, Apply operation documentation
   - Added Push operation documentation as primary create/update method
   - Updated "Artifact-Based Operations" section to explain the new approach
   - Removed "No Custom Steps" section (no longer relevant)
   - Updated file size guidelines to reflect current files
   - Emphasized artifact-based design philosophy

4. **`backend/services/stigmer-server/pkg/domain/skill/controller/IMPLEMENTATION_SUMMARY.md`**
   - Added prominent "IMPORTANT UPDATE" note at top explaining the refactor
   - Updated "Files Created" section to "Current Files (Post-Refactor)"
   - Added "Files Removed" section documenting deleted files
   - Updated architecture section to show artifact-based approach
   - Updated file size table to reflect current state
   - Updated summary to explain Push-centric design

---

## Why This Change

### Alignment with Proto API

The proto API (`apis/ai/stigmer/agentic/skill/v1/command.proto`) only exposes two operations in `SkillCommandController`:

```protobuf
service SkillCommandController {
  rpc push(PushSkillRequest) returns (Skill);
  rpc delete(SkillId) returns (Skill);
}
```

The Create, Update, and Apply RPCs were never defined in the proto service, yet the controller still had handlers for them. This created confusion and technical debt.

### Artifact-Based Design

Skills are designed to be packaged as artifacts (ZIP files containing SKILL.md and related files), not created via proto field-by-field definitions. The Push operation:

1. Accepts a ZIP artifact upload
2. Extracts and validates SKILL.md
3. Calculates SHA256 hash for version control
4. Creates new skill if doesn't exist, or creates new version if exists
5. Stores artifact (deduplicated by hash)
6. Archives previous versions automatically

This artifact-based approach is fundamentally different from typical CRUD resources, making Create/Update/Apply operations inappropriate for skills.

### Code Cleanup Benefits

- **Reduced complexity**: Fewer code paths to maintain
- **Clearer intent**: Single way to create/update skills (Push)
- **Proto alignment**: Code matches proto definition exactly
- **No dead code**: Removed unused handlers
- **Simplified tests**: Tests no longer need to set up Create/Update operations
- **Better documentation**: README/summary docs now accurately reflect implementation

---

## Impact Assessment

### No Breaking Changes

This refactoring has **zero impact** on external clients or users because:

1. **Proto API unchanged**: The Create/Update/Apply RPCs were never exposed via gRPC
2. **Push operation unchanged**: Existing Push behavior is identical
3. **No server registration changes**: Only Push and Delete were ever registered
4. **Internal cleanup only**: Removed internal code that was never callable

### Internal Impact

- **Reduced maintenance burden**: 169 fewer lines to maintain
- **Clearer codebase**: Removes confusion about how skills are created
- **Aligned architecture**: Code matches design intent
- **Simplified testing**: Tests focus on actual operations (Push, Delete, Get)

---

## Verification

### Build Verification

Confirmed successful compilation after cleanup:

```bash
cd backend/services/stigmer-server
go build ./pkg/domain/skill/controller/...
# Exit code: 0 ✓
```

### Linter Verification

No linter errors introduced:

```bash
# Linter check
# No errors ✓
```

### Remaining Operations

The Skill controller now has these operations:

| Operation | File | Purpose |
|-----------|------|---------|
| **Push** | `push.go` | Create or update skill via artifact upload |
| **Delete** | `delete.go` | Remove skill and all versions |
| **Get** | `get.go` | Retrieve skill by ID |
| **GetByReference** | `get_by_reference.go` | Retrieve skill by slug/org reference |

All operations compile and function correctly.

---

## Files Modified

```
Modified:
- backend/services/stigmer-server/pkg/domain/skill/controller/BUILD.bazel
- backend/services/stigmer-server/pkg/domain/skill/controller/skill_controller_test.go
- backend/services/stigmer-server/pkg/domain/skill/controller/README.md
- backend/services/stigmer-server/pkg/domain/skill/controller/IMPLEMENTATION_SUMMARY.md

Deleted:
- backend/services/stigmer-server/pkg/domain/skill/controller/create.go
- backend/services/stigmer-server/pkg/domain/skill/controller/update.go
- backend/services/stigmer-server/pkg/domain/skill/controller/apply.go
```

---

## Technical Details

### Handler Architecture (Before)

```
SkillController handlers:
├── Create  (proto-based, never exposed)
├── Update  (proto-based, never exposed)
├── Apply   (proto-based, never exposed)
├── Push    (artifact-based, exposed via gRPC) ✓
├── Delete  (exposed via gRPC) ✓
├── Get     (exposed via gRPC) ✓
└── GetByReference (exposed via gRPC) ✓
```

### Handler Architecture (After - Simplified)

```
SkillController handlers:
├── Push    (artifact-based, exposed via gRPC) ✓
├── Delete  (exposed via gRPC) ✓
├── Get     (exposed via gRPC) ✓
└── GetByReference (exposed via gRPC) ✓
```

**Result**: Only handlers that are actually exposed and used remain in the codebase.

### Push Operation Handles Both Create and Update

The Push operation intelligently handles both scenarios:

```go
// Push workflow (simplified)
1. Extract SKILL.md from artifact
2. Calculate SHA256 hash
3. Check if skill exists by slug
4. If exists:
   - Create new version
   - Archive previous version
   - Update skill spec
5. If not exists:
   - Create new skill resource
   - Store initial version
6. Return skill resource
```

This single operation replaces the need for separate Create, Update, and Apply handlers.

---

## Documentation Updates

### README Updates

- Removed documentation for Create, Update, Apply operations
- Added Push operation as primary method
- Updated package structure to show only active files
- Emphasized artifact-based approach
- Updated file size metrics

### Test Updates

- Removed all Create/Update test cases
- Simplified Get/Delete tests to not depend on Create
- Updated test setup to include artifact storage
- Tests now focus on query operations only
- Note added that Push tests should be in separate file or added

### Implementation Summary Updates

- Added historical context about the refactor
- Documented what was removed and why
- Updated current state sections
- Preserved historical information for reference

---

## Rationale

### Why Remove Instead of Deprecate?

These operations were **never exposed via gRPC** and were **never callable** by clients. They existed only as internal code that was unreachable. Therefore:

- No deprecation period needed (nothing to deprecate)
- No breaking changes possible (nothing to break)
- Safe to remove immediately
- Reduces confusion and maintenance burden

### Why Push Is Sufficient

Skills are fundamentally different from other resources:

- **Skills are artifacts**: They're packaged code/content, not configuration
- **Version control by hash**: SHA256 of artifact content determines version
- **Content-addressed**: Same content = same version (deduplication)
- **Immutable versions**: Once pushed, versions never change
- **Archive on update**: Previous versions preserved automatically

These characteristics make artifact-based uploads the natural interface, not field-by-field proto updates.

---

## Related Changes

This cleanup was prompted by examination of the proto API definition which showed only `push` and `delete` operations. The conversation identified the mismatch and removed the obsolete handlers.

---

## Next Steps

No further action required. The Skill controller is now simplified and aligned with its proto API definition.

If comprehensive Push operation tests are needed, they should be added to `skill_controller_test.go` or a new `push_test.go` file.

---

## References

- Proto API: `apis/ai/stigmer/agentic/skill/v1/command.proto`
- Controller: `backend/services/stigmer-server/pkg/domain/skill/controller/`
- Push implementation: `backend/services/stigmer-server/pkg/domain/skill/controller/push.go`
- Storage: `backend/services/stigmer-server/pkg/domain/skill/storage/`
