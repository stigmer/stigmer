# Fix: Update Pipeline Immutable Field Preservation and Debug Logging Cleanup

**Date**: 2026-01-20  
**Type**: Bug Fix + Cleanup  
**Impact**: Critical (fixes second apply failure) + Developer Experience

## Summary

Fixed critical bug where second `stigmer apply` failed with "duplicate instance" error due to incorrect immutable field preservation in update operations. Also cleaned up debug logging that was polluting user output.

## Problems Identified

### Problem 1: Second Apply Fails with Duplicate Instance Error

**Symptom**:
```bash
# First apply - SUCCESS
stigmer apply
✓ Agent deployed: pr-reviewer (ID: agt-1768914868158993000)
✓ Workflow deployed: review-demo-pr (ID: wfl-1768914822189168000)

# Second apply - FAILURE
stigmer apply
Error: failed to deploy agent 'pr-reviewer': rpc error: code = Unknown desc = 
pipeline step CreateDefaultInstance failed: failed to create default instance: 
rpc error: code = Unknown desc = pipeline step CheckDuplicate failed: 
AgentInstance with slug 'pr-reviewer-default' already exists
```

**Root Cause**: The `preserveImmutableFields` function in `build_update_state.go` was NOT preserving the `metadata.Slug` field during update operations. This caused:
1. Resources to be updated with **empty slugs** in the database
2. Next apply couldn't find existing resources by slug (slug was empty)
3. `LoadForApplyStep` thought resource didn't exist → tried CREATE instead of UPDATE
4. CREATE failed because default instance already existed

### Problem 2: Incorrect Field Preservation Logic

**What Was Wrong**:
```go
// BEFORE (incorrect)
mergedMeta.Id = existingMeta.Id
mergedMeta.Name = existingMeta.Name  // ← WRONG! Name should be mutable
mergedMeta.Slug = existingMeta.Slug  // ← Missing initially, added but still wrong approach
```

**What Java Does (correct)**:
```java
// Java UpdateOperationPreserveResourceIdentifiersStepV2.java (lines 58-61)
var preservedMetadata = newResourceMetadata.toBuilder()
        .setOrg(existingResourceMetadata.getOrg())      // Preserve
        .setSlug(existingResourceMetadata.getSlug())    // Preserve
        .setId(existingResourceMetadata.getId()).build(); // Preserve
// Note: Name is NOT preserved - it can be updated!
```

**Key Insight**: 
- **Immutable fields**: ID, Slug, Org (never change after creation)
- **Mutable fields**: Name, Title, Description, Labels, Tags (can be updated)
- **Slug vs Name**: Slug is derived from the **original** name and never changes, even if name is updated later

### Problem 3: Debug Print Statements Polluting Output

**Symptom**:
```bash
stigmer apply
# ... normal output ...
[DEBUG deployWorkflows] Number of workflows in manifest: 1
[DEBUG deployWorkflows] Workflow 0: metadata.Name=review-demo-pr, spec.Document.Name=review-demo-pr
[DEBUG LoadForApplyStep] Looking for existing resource with slug: pr-reviewer
[DEBUG findBySlug] Listed 3 resources of kind agent
# ... more debug spam ...
```

**Root Cause**: Hardcoded `fmt.Printf("[DEBUG ...")` statements bypassed the `LOG_LEVEL` configuration entirely and always printed to user output.

## Solutions Implemented

### Fix 1: Correct Immutable Field Preservation

**File**: `backend/libs/go/grpc/request/pipeline/steps/build_update_state.go`

**Before**:
```go
// Preserve immutable fields
mergedMeta.Id = existingMeta.Id
mergedMeta.Name = existingMeta.Name // Slug is immutable
```

**After** (aligned with Java):
```go
// Preserve immutable identifiers (matching Java implementation)
mergedMeta.Id = existingMeta.Id     // Resource ID (immutable)
mergedMeta.Slug = existingMeta.Slug // Slug (immutable, derived from original name)
mergedMeta.Org = existingMeta.Org   // Organization (immutable)

// Note: metadata.name is NOT preserved - it can be updated by the client!
```

**Updated Documentation**:
```go
// preserveImmutableFields copies immutable fields from existing to merged resource
//
// Immutable fields (matching Java UpdateOperationPreserveResourceIdentifiersStepV2):
// - metadata.id (resource ID - cannot be changed)
// - metadata.slug (URL-safe identifier - cannot be changed once set)
// - metadata.org (organization - cannot be changed once set)
//
// Mutable fields (NOT preserved, can be updated):
// - metadata.name (display name - CAN be changed)
// - metadata.title, description, labels, tags, etc.
```

**Why This Matters**:
- Fixes the core bug (slug now preserved → second apply works)
- Aligns Go with Java implementation (consistency)
- Allows name updates while keeping slug stable (correct semantics)
- Preserves organization ownership (security)

### Fix 2: Remove Debug Print Statements

Removed 15 hardcoded debug statements that bypassed logging configuration:

**Files Cleaned**:
1. `backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go` (8 statements)
2. `backend/libs/go/grpc/request/pipeline/steps/defaults.go` (2 statements)
3. `client-apps/cli/internal/cli/deploy/deployer.go` (2 statements)
4. `sdk/go/internal/synth/workflow_converter.go` (3 statements)

**Example Removal**:
```go
// REMOVED
fmt.Printf("[DEBUG deployWorkflows] Number of workflows in manifest: %d\n", len(manifest.Workflows))
fmt.Printf("[DEBUG LoadForApplyStep] Looking for existing resource with slug: %s\n", slug)
```

### Fix 3: Add Proper Structured Logging

**File**: `backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go`

**Added**:
```go
import "github.com/rs/zerolog/log"

// In Execute()
log.Debug().
    Str("slug", slug).
    Str("kind", kind.String()).
    Msg("LoadForApply: Looking for existing resource")

log.Debug().
    Str("slug", slug).
    Msg("LoadForApply: Resource not found, will create new")

log.Debug().
    Str("slug", slug).
    Msg("LoadForApply: Resource found, will update")
```

**Benefits**:
- Respects `LOG_LEVEL` environment variable (defaults to "info")
- Only shows when `LOG_LEVEL=debug` is explicitly set
- Structured logging with context (slug, kind, etc.)
- Developer-friendly for debugging without polluting user output

**Updated BUILD.bazel**:
```python
deps = [
    # ... existing deps ...
    "@com_github_rs_zerolog//log",
]
```

## Testing

**Test Scenario**: Second apply after fresh database

**Before Fix**:
```bash
# First apply
stigmer apply
✓ Agent deployed: pr-reviewer (ID: agt-1768914868158993000)

# Second apply - FAILS
stigmer apply
Error: failed to deploy agent 'pr-reviewer': rpc error: code = Unknown desc = 
pipeline step CreateDefaultInstance failed: AgentInstance with slug 
'pr-reviewer-default' already exists
```

**After Fix**:
```bash
# First apply
stigmer apply
✓ Agent deployed: pr-reviewer (ID: agt-1768914868158993000)
✓ Workflow deployed: review-demo-pr (ID: wfl-1768914822189168000)

# Second apply - SUCCESS (same IDs = UPDATE, not CREATE)
stigmer apply
✓ Agent deployed: pr-reviewer (ID: agt-1768914868158993000)  ← Same ID
✓ Workflow deployed: review-demo-pr (ID: wfl-1768914822189168000)  ← Same ID

# Clean output - no debug spam
```

**Verification**:
- ✅ Second apply succeeds
- ✅ Resources are UPDATED (same IDs) not recreated
- ✅ No debug output in user-facing CLI
- ✅ Debug logs available when `LOG_LEVEL=debug`

## Technical Deep Dive

### Java vs Go Implementation Comparison

**Java Update Pipeline** (`AgentUpdateHandler.java`):
```java
// Lines 46-49
.addStep(commonSteps.resolveSlug)      // Resolve slug (for fallback lookup)
.addStep(updateSteps.loadExisting)     // Load existing (by ID or slug)
.addStep(updateSteps.authorize)        // Authorize
.addStep(updateSteps.buildNewState)    // Build new state
```

**Java Preserve Logic** (`UpdateOperationPreserveResourceIdentifiersStepV2.java`):
```java
// Lines 58-61
var preservedMetadata = newResourceMetadata.toBuilder()
        .setOrg(existingResourceMetadata.getOrg())      // Immutable
        .setSlug(existingResourceMetadata.getSlug())    // Immutable
        .setId(existingResourceMetadata.getId()).build(); // Immutable
```

**Go Update Pipeline** (`update.go`):
```go
// Lines 42-45
AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).         // Resolve slug
AddStep(steps.NewLoadExistingStep[*agentv1.Agent](c.store)). // Load existing
AddStep(steps.NewBuildUpdateStateStep[*agentv1.Agent]()).    // Build updated state
AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).      // Persist
```

**Go Preserve Logic** (`build_update_state.go` - AFTER FIX):
```go
// Lines 120-122 (now aligned with Java)
mergedMeta.Id = existingMeta.Id     // Immutable
mergedMeta.Slug = existingMeta.Slug // Immutable
mergedMeta.Org = existingMeta.Org   // Immutable
// Name NOT in list - it's mutable!
```

**Alignment Achieved**:
| Field | Java | Go (Before) | Go (After) | Correct |
|-------|------|-------------|------------|---------|
| `id` | Preserved | Preserved | Preserved | ✅ |
| `slug` | Preserved | Missing/Wrong | Preserved | ✅ |
| `org` | Preserved | Missing | Preserved | ✅ |
| `name` | NOT preserved | Preserved (WRONG) | NOT preserved | ✅ |

### Update Semantics

**What happens during update**:
1. User sends update request with new name: `"My New Agent Name"`
2. `ResolveSlug` runs but is idempotent (slug already exists, skips)
3. `LoadExisting` loads resource from database (has old slug, old org)
4. `BuildUpdateState`:
   - Starts with input (new name, potentially new slug/org from user)
   - **Preserves immutable fields** from existing: ID, Slug, Org
   - Keeps mutable fields from input: Name, Title, Description
5. Result: Name is updated, but Slug and Org stay the same

**Example**:
```
Existing in DB:
  id: "agt-123"
  name: "old-name"
  slug: "old-name"
  org: "acme"

User sends update:
  id: "agt-123"
  name: "new-name"  ← User wants to change
  slug: "new-name"  ← User's client may set this
  org: "other-org"  ← User's client may set this

After preserveImmutableFields:
  id: "agt-123"      ← From existing (preserved)
  name: "new-name"   ← From input (allowed to change)
  slug: "old-name"   ← From existing (preserved - immutable!)
  org: "acme"        ← From existing (preserved - immutable!)
```

### Logging Configuration

**Environment Variable**: `LOG_LEVEL`
- **Location**: `backend/services/stigmer-server/pkg/config/config.go:23`
- **Default**: `"info"` (correct for production)
- **Options**: `"debug"`, `"info"`, `"warn"`, `"error"`

**How It Works**:
```go
// backend/services/stigmer-server/cmd/server/main.go:216-223
func setupLogging(cfg *config.Config) {
    level, err := zerolog.ParseLevel(cfg.LogLevel)
    if err != nil {
        level = zerolog.InfoLevel
    }
    zerolog.SetGlobalLevel(level)
    // ...
}
```

**Before Fix**: `fmt.Printf` bypassed this entirely
**After Fix**: `log.Debug()` respects the configured level

## Files Modified

**Backend Pipeline Steps**:
- `backend/libs/go/grpc/request/pipeline/steps/build_update_state.go` - Fixed preservation logic
- `backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go` - Removed debug prints, added structured logging
- `backend/libs/go/grpc/request/pipeline/steps/defaults.go` - Removed debug prints
- `backend/libs/go/grpc/request/pipeline/steps/BUILD.bazel` - Added zerolog dependency

**CLI Deployer**:
- `client-apps/cli/internal/cli/deploy/deployer.go` - Removed debug prints

**SDK**:
- `sdk/go/internal/synth/workflow_converter.go` - Removed debug prints

## Impact

**User Impact**:
- ✅ `stigmer apply` now works correctly for repeated applications (idempotent)
- ✅ UPDATE semantics work properly (resources updated, not recreated)
- ✅ Clean CLI output (no debug spam)
- ✅ Name can be updated while keeping slug stable

**Developer Impact**:
- ✅ Debug logging available when needed (`LOG_LEVEL=debug`)
- ✅ Structured logs with context for troubleshooting
- ✅ Go implementation aligned with Java (consistency)
- ✅ Clear documentation of immutable vs mutable fields

**System Impact**:
- ✅ Correct resource update semantics (preserves identifiers, allows property changes)
- ✅ Database integrity maintained (slugs remain stable)
- ✅ Authorization context preserved (org cannot be changed)

## Lessons Learned

### 1. Immutable Field Semantics Matter

**Key Insight**: Not all metadata fields have the same mutability semantics.

**Immutable** (identity, never change):
- `id` - Resource identifier
- `slug` - URL-safe identifier (derived from original name)
- `org` - Organization ownership

**Mutable** (properties, can change):
- `name` - Display name
- `title`, `description` - User-facing text
- `labels`, `tags` - Metadata

**Why**: Slug is a **stable identifier** for URLs and lookups. If name changes, slug stays the same to avoid breaking references.

### 2. Debug Logging Must Respect Configuration

**Anti-Pattern**: Hardcoded `fmt.Printf` for debugging
```go
❌ fmt.Printf("[DEBUG] Some value: %v\n", value)
```

**Best Practice**: Structured logging with level control
```go
✅ log.Debug().Str("field", value).Msg("Operation description")
```

**Benefits**:
- Respects `LOG_LEVEL` configuration
- Structured data (machine parseable)
- Context-rich (fields, not just strings)
- Production-safe (won't spam users)

### 3. Cross-Language Consistency Is Critical

When implementing the same logic in multiple languages (Java and Go), **semantic alignment** is essential:
- Same immutable/mutable field treatment
- Same update semantics (what gets preserved)
- Same pipeline step order and responsibilities

**Discovery**: The original Go code diverged from Java by:
1. Preserving `name` (should be mutable)
2. Not preserving `slug` initially (should be immutable)
3. Not preserving `org` (should be immutable)

**Solution**: Review Java implementation as the source of truth and align Go accordingly.

### 4. Testing Update Operations Requires Second Apply

**Insufficient Test**: Single apply succeeds
```bash
stigmer apply  # ✓ First apply works
# Stop here - bug not detected!
```

**Proper Test**: Second apply with existing resources
```bash
stigmer apply  # ✓ First apply
stigmer apply  # ✗ Second apply fails - BUG FOUND!
```

**Why**: Update path is different from create path. Bugs in field preservation only manifest on subsequent applies.

## Related Work

**Previous Changelog**: `2026-01-20-184248-fix-stigmer-apply-debug-logging.md`
- Initial investigation with debug logging
- Identified slug preservation issue
- This changelog completes the fix

**Java Reference Implementation**:
- `UpdateOperationBuildNewStateStepV2.java` - Build new state for updates
- `UpdateOperationPreserveResourceIdentifiersStepV2.java` - Preserve immutable fields
- Lines 58-61 show correct preservation logic

## Next Steps

**Immediate**:
- ✅ Fix is complete and tested
- ✅ Go implementation aligned with Java
- ✅ Debug logging cleaned up

**Future Improvements**:
- Consider integration tests for update path specifically
- Document immutable field semantics in architecture docs
- Add validation that slug cannot be modified via API

## References

**Code Locations**:
- Go Update Logic: `backend/libs/go/grpc/request/pipeline/steps/build_update_state.go`
- Java Update Logic: `backend/libs/java/grpc/grpc-request/.../UpdateOperationPreserveResourceIdentifiersStepV2.java`
- Logging Config: `backend/services/stigmer-server/pkg/config/config.go`

**Related Concepts**:
- Update semantics: Merge input with existing, preserve identity
- Immutable fields: Set once at creation, never change
- Structured logging: Machine-parseable logs with context
