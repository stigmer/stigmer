# Refactor Skill Push Handler to Use Pipeline Framework

**Date**: 2026-01-25  
**Type**: Refactor  
**Scope**: backend/skill, apis/skill, pipeline/steps  
**Branch**: feat/enhance-skill-api

## Overview

Refactored the Skill Push handler (`push.go`) to fully leverage the pipeline framework, following the same architectural patterns used throughout Stigmer OSS. This refactoring eliminates custom validation, ID generation, and audit field logic in favor of reusable common library functions.

## What Changed

### 1. Proto API Changes

**Return Type Changed:**
- `rpc push(PushSkillRequest) returns (Skill)` (previously returned `PushSkillResponse`)
- Deprecated `PushSkillResponse` message (kept for backward compatibility)

**Rationale**: Consistent with other CRUD operations (Create, Update, Delete all return the full Skill resource).

**Files Modified:**
- `apis/ai/stigmer/agentic/skill/v1/command.proto`
- `apis/ai/stigmer/agentic/skill/v1/io.proto`
- Proto stubs regenerated (Go and Python)

### 2. Pipeline Framework Implementation

**Complete Rewrite Using Pipeline Pattern:**

**Before**: Direct inline implementation (~160 lines)
- Mixed validation, business logic, and persistence
- Custom validation logic
- Custom ID generation (timestamp-based)
- Manual audit field construction
- Custom slug generation
- Difficult to test individual concerns

**After**: Pipeline-based implementation with 10 composable steps (~520 lines)
- Clear separation of concerns
- Reuses common validation (`ValidateProtoStep`)
- Reuses common ID generation with ULID
- Reuses common audit field helpers
- Reuses common slug generation
- Each step independently testable

**Pipeline Steps:**
1. `ValidateProtoStep` - Proto validation (common)
2. `BuildInitialSkillStep` - Build Skill from request
3. `ResolveSlugForPushStep` - Generate slug using common library
4. `FindExistingBySlugStep` - Find by slug (uses new helper)
5. `GenerateIDIfNeededStep` - Generate ID with proper prefix (common library)
6. `ExtractAndHashArtifactStep` - Extract SKILL.md and calculate hash
7. `CheckAndStoreArtifactStep` - Store artifact with deduplication
8. `PopulateSkillFieldsStep` - Populate spec/status with artifact data
9. `ArchiveCurrentSkillStep` - Archive NEW skill for version history
10. `StoreSkillStep` - Persist to BadgerDB

### 3. Common Library Enhancements

**Exported Functions for Reuse:**

**In `pipeline/steps/slug.go`:**
- Exported `GenerateSlug(name string) string` (previously private)
- Allows custom steps to reuse slug generation logic

**In `pipeline/steps/defaults.go`:**
- Exported `GenerateID(prefix string) string` (previously private)
- Exported `SetAuditFieldsForCreate(resource)` - Wrapper for create audit fields
- Exported `SetAuditFieldsForUpdate(resource)` - Wrapper for update audit fields
- Allows custom steps to reuse ID and audit field logic

**New Helper in `pipeline/steps/helpers.go`:**
- Created `FindResourceBySlug[T](ctx, store, kind, slug)` generic helper
- Eliminates duplicated findBySlug logic across multiple steps
- Type-safe with generics

### 4. Key Implementation Improvements

**Proper Resource ID Generation:**
- Uses `apiresourcelib.GetIdPrefix(kind)` to extract prefix from proto options
- Generates ULID-based IDs: `skl-{ulid}` (e.g., `skl-01arz3ndektsv4rrffq69g5fav`)
- Consistent with Create and all other operations

**Find by Slug First (Like Apply):**
- Builds Skill with user-provided name (immutable)
- Generates slug from name
- Finds existing skill by slug (not by ID)
- If found: Copies existing ID → Update mode
- If not found: Generates new ID → Create mode

**Proper Audit Field Handling:**
- For create: Uses `steps.SetAuditFieldsForCreate(skill)` - sets created_at = updated_at = now
- For update: Uses `steps.SetAuditFieldsForUpdate(skill)` - preserves created_at, updates updated_at
- Uses proto reflection (works generically for all resources)

**Archive Timing Fixed:**
- Archives NEW skill (with all new data) AFTER populating fields
- Archive happens BEFORE storing to DB
- Archive contains the latest version with new artifact data
- Can be queried by tag or hash for version history

**Context Keys as Constants:**
- All context keys defined as constants (prevents typos)
- Documented with comments explaining purpose
- Consistent with other handlers

### 5. Benefits of Refactoring

**Consistency:**
- ✅ Matches pattern used in Create, Update, Delete, Apply handlers
- ✅ Uses same ID generation logic
- ✅ Uses same audit field logic
- ✅ Uses same slug generation logic

**Maintainability:**
- ✅ Clear separation of concerns (one step = one responsibility)
- ✅ Eliminates duplicated code
- ✅ Easier to understand and debug
- ✅ Centralized implementations in common library

**Testability:**
- ✅ Each step can be unit tested independently
- ✅ Integration tests can verify full pipeline

**Observability:**
- ✅ Built-in step tracing and logging
- ✅ Clear visibility into pipeline execution

**Extensibility:**
- ✅ Easy to add/remove/reorder steps
- ✅ New steps can reuse common library functions

## Technical Details

### Type System Design

Push handler transforms between different types:
- **Input**: `PushSkillRequest` (contains name, artifact, scope, org, tag)
- **Output**: `Skill` (full API resource)
- **Context**: Uses metadata map with `SkillKey` constant to store the Skill being built
- **Rationale**: `RequestContext[T].newState` is typed as `T`, but we're transforming types, so we use context metadata

### Name vs Slug Handling

- **Name**: User-provided value (stored as-is, immutable field)
- **Slug**: Normalized version generated from name (used for lookups)
- Both stored in metadata
- Slug is used to determine if skill already exists

### Archive Strategy

**Archive Key Format**: `skill_audit/<resource_id>/<timestamp>`

**What Gets Archived**: The NEW skill (after all fields populated)
- Contains latest artifact data (hash, storage key, SKILL.md)
- Contains updated timestamps
- Immutable record for version history

**Query Patterns**:
- Query by tag: Returns latest version with that tag (sorted by timestamp)
- Query by hash: Returns exact version match

## Files Modified

### Proto API (3 files)
- `apis/ai/stigmer/agentic/skill/v1/command.proto` - Changed return type
- `apis/ai/stigmer/agentic/skill/v1/io.proto` - Deprecated PushSkillResponse
- Proto stubs regenerated (Go and Python)

### Common Pipeline Library (4 files)
- `backend/libs/go/grpc/request/pipeline/steps/slug.go` - Exported GenerateSlug
- `backend/libs/go/grpc/request/pipeline/steps/defaults.go` - Exported ID and audit helpers
- `backend/libs/go/grpc/request/pipeline/steps/helpers.go` - Created FindResourceBySlug helper
- `backend/libs/go/grpc/request/pipeline/steps/BUILD.bazel` - Added helpers.go

### Skill Controller (2 files)
- `backend/services/stigmer-server/pkg/domain/skill/controller/push.go` - Complete refactor
- `backend/services/stigmer-server/pkg/domain/skill/controller/BUILD.bazel` - Updated deps

## Migration Notes

**Breaking Change**: Proto API signature changed
- Clients expecting `PushSkillResponse` need to handle full `Skill` resource
- Response now includes all skill data (metadata, spec, status)
- Migration path: Access `skill.status.version_hash` instead of `response.version_hash`

**CLI Impact**: CLI needs update to handle Skill response
- Extract version_hash from `skill.Status.VersionHash`
- Extract storage_key from `skill.Status.ArtifactStorageKey`

## Security Considerations

All security measures preserved:
- ✅ Uses google/safearchive for ZIP extraction
- ✅ Prevents path traversal and symlink attacks
- ✅ Validates ZIP size and compression ratios (ZIP bomb prevention)
- ✅ Extracts SKILL.md in memory only (executables never touch disk)
- ✅ Stores sealed ZIP with restricted permissions (0600)
- ✅ Content-addressable storage with deduplication

## Testing

**Build Verification:**
- ✅ Go build successful
- ✅ All dependencies properly imported
- ✅ Type-safe with proper error handling

**Next Steps for Testing:**
- Unit tests for custom pipeline steps
- Integration tests for full push flow
- CLI compatibility verification with new response type

## Architectural Alignment

This refactoring aligns Push handler with:
- ✅ **Stigmer OSS pipeline architecture** - All handlers use pipeline pattern
- ✅ **Common library patterns** - Reuses ID generation, validation, audit fields
- ✅ **Apply handler pattern** - Find by slug first, then create or update
- ✅ **Context metadata pattern** - Uses constants for context keys

## Performance Considerations

**Lookup Strategy:**
- Uses `ListResources` and linear scan (acceptable for local OSS usage)
- Same pattern as other handlers (Apply, GetByReference)
- For production scale, consider indexed lookups

## Related Work

**Previous Changes:**
- Skill artifact storage implementation (dfcc1b6)
- CLI skill upload implementation (38d9f12)
- Skill artifact documentation (8994bf6, 4afd4ac)

**This Change Completes:**
- Backend pipeline framework adoption for Push handler
- API consistency (all operations return full resource)
- Code reusability (eliminates duplication)

## Learnings

### Pattern: Type Transformation in Pipelines

When input type ≠ output type (e.g., `PushSkillRequest` → `Skill`):
- Cannot use `RequestContext[T].newState` (typed as input type)
- Use context metadata with constant key: `ctx.Set(SkillKey, skill)`
- Document clearly in constants with comment

### Pattern: Reusing Common Library Functions

Best practices for code reuse:
1. Export generic helpers from common library
2. Use constants for all context keys
3. Import and use instead of reimplementing
4. Document TODOs if functionality should be exported but isn't yet

### Pattern: Archive Timing

Archive the NEW resource (after modifications) not the OLD one:
- Allows querying by tag/hash to get latest version
- Archive contains the actual pushed version
- Place archive step AFTER populate, BEFORE persist

## Impact Summary

**Code Quality:**
- Reduced code duplication
- Improved maintainability
- Enhanced testability
- Better observability

**Consistency:**
- All handlers now use pipeline pattern
- Standardized ID generation across all operations
- Unified audit field management
- Consistent slug generation

**Developer Experience:**
- Clearer code structure
- Self-documenting pipeline steps
- Easier to extend with new steps
- Centralized common logic
