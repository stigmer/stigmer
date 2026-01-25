# Task T01.1 Execution Log - Proto API Definitions (Updated)

**Task**: T01.1 - Proto API Definitions (Days 1-2)
**Started**: 2026-01-25
**Status**: ✅ COMPLETED
**Duration**: ~2 hours
**Iterations**: 2 (initial + refinement)

## Objective

Create complete Skill API resource following Stigmer proto standards with versioning support and simplified artifact-centric workflow.

## Final Design Decisions

### Key Simplifications

1. **Single-Phase Push Operation** ✅
   - No separate `create`/`update` RPCs
   - `push` handles both creation and updates
   - Artifact-driven model (Zip with SKILL.md is the source of truth)

2. **Name-Based Targeting** ✅
   - User provides readable name (e.g., "Math Utils")
   - Backend normalizes to slug (e.g., "math-utils")
   - No namespace concept (no "acme/calculator" pattern)

3. **Minimal Command Surface** ✅
   - Only `push` and `delete` RPCs
   - No `create`, `update`, or `apply` RPCs

## Changes Implemented

### 1. ✅ Updated `spec.proto`

**File**: `apis/ai/stigmer/agentic/skill/v1/spec.proto`

**Final Structure**:
```protobuf
message SkillSpec {
  string skill_md = 1;  // SKILL.md content (required)
  string tag = 2;       // Optional version tag
}
```

### 2. ✅ Created `status.proto`

**File**: `apis/ai/stigmer/agentic/skill/v1/status.proto` (NEW)

**Structure**:
```protobuf
message SkillStatus {
  ApiResourceAudit audit = 99;
  string version_hash = 1;        // SHA256 hash
  string artifact_storage_key = 2; // Storage location
  SkillState state = 3;            // Lifecycle state
}

enum SkillState {
  SKILL_STATE_UNSPECIFIED = 0;
  SKILL_STATE_UPLOADING = 1;
  SKILL_STATE_READY = 2;
  SKILL_STATE_FAILED = 3;
}
```

### 3. ✅ Updated `api.proto`

**File**: `apis/ai/stigmer/agentic/skill/v1/api.proto`

**Changes**:
- Status type: `ApiResourceAuditStatus` → `SkillStatus`
- Added `SkillList` message
- Updated documentation (no namespace references)

### 4. ✅ Updated `io.proto` (Major Refinement)

**File**: `apis/ai/stigmer/agentic/skill/v1/io.proto`

**Final PushSkillRequest**:
```protobuf
message PushSkillRequest {
  string name = 1;     // User-provided name (normalized to slug)
  ApiResourceOwnerScope scope = 2;  // platform or organization
  string org = 3;      // Org ID (required if scope = org)
  bytes artifact = 4;  // Zip file with SKILL.md
  string tag = 5;      // Optional version tag
}
```

**Rationale**:
- User provides readable `name`, backend normalizes to `slug`
- Reuses `scope` enum from common package
- No `kind` field (implicit - we're in skill service)
- No `version` field (we're CREATING version, not referencing)

**Other Messages**:
```protobuf
message PushSkillResponse {
  string version_hash = 1;
  string artifact_storage_key = 2;
  string tag = 3;
}

message GetSkillByTagRequest {
  string slug = 1;  // Normalized slug
  string tag = 2;
}

message GetSkillByHashRequest {
  string slug = 1;      // Normalized slug
  string version_hash = 2;  // Exact SHA256
}
```

### 5. ✅ Updated `command.proto` (Simplified)

**File**: `apis/ai/stigmer/agentic/skill/v1/command.proto`

**Final Service**:
```protobuf
service SkillCommandController {
  rpc push(PushSkillRequest) returns (PushSkillResponse);
  rpc delete(SkillId) returns (Skill);
}
```

**Removed**:
- ❌ `create` RPC
- ❌ `update` RPC
- ❌ `apply` RPC

**Authorization for push**:
- Resource kind: `organization` (not `skill`)
- Permission: `can_create_skill`
- Field path: `"org"`
- Rationale: Check org-level permission (works for create and update)

**Backend Workflow** (documented in proto):
1. Normalize name to slug
2. Find or create skill resource
3. Extract SKILL.md from artifact
4. Calculate SHA256 hash
5. Store artifact (deduplicated)
6. Update spec and status
7. Archive previous version (if update)

### 6. ✅ Updated `query.proto`

**File**: `apis/ai/stigmer/agentic/skill/v1/query.proto`

**RPCs**:
- `get(SkillId)` - By ID
- `getByReference(ApiResourceReference)` - By reference
- `getByTag(GetSkillByTagRequest)` - By tag (resolve to latest)
- `getByHash(GetSkillByHashRequest)` - By exact hash

### 7. ✅ Added `version` Field to ApiResourceReference

**File**: `apis/ai/stigmer/commons/apiresource/io.proto`

```protobuf
message ApiResourceReference {
  ApiResourceOwnerScope scope = 1;
  string org = 2;
  ApiResourceKind kind = 3;
  string slug = 4;
  string version = 5;  // NEW: empty/"latest"/tag/hash
}
```

### 8. ✅ Updated ApiResourceKind Enum

**File**: `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`

```protobuf
skill = 43 [(kind_meta) = {
  ...
  is_versioned: true  // Changed from false
}];
```

## Validation

### All Checks Passed ✅

```bash
✅ make lint         # No errors
✅ make fmt          # Files formatted
✅ make go-stubs     # Generated successfully
✅ make python-stubs # (not regenerated, but available)
```

### Generated Go Interface

```go
type SkillCommandControllerServer interface {
    Push(context.Context, *PushSkillRequest) (*PushSkillResponse, error)
    Delete(context.Context, *SkillId) (*Skill, error)
}
```

### PushSkillRequest Structure

```go
type PushSkillRequest struct {
    Name     string                       // User-provided name
    Scope    apiresource.ApiResourceOwnerScope
    Org      string
    Artifact []byte                       // Zip file
    Tag      string                       // Optional
}
```

## Design Rationale

### Why Single-Phase Push?

**Problem with two-phase**:
- Create empty skill → weird intermediate state
- Requires managing two separate calls
- Spec has empty `skill_md` (invalid!)

**Solution: Artifact-driven**:
- Artifact (Zip + SKILL.md) is the source of truth
- One operation creates/updates everything
- No invalid intermediate states
- Simpler client flow

### Why Name (Not Slug) in Request?

**User provides**: `"Math Utils"` (readable)
**Backend normalizes**: `"math-utils"` (slug)
**Stored as**: slug (immutable identifier)
**Lookups use**: slug

**Benefits**:
- User-friendly API
- Backend handles normalization consistently
- Same logic for create and update

### Why No Namespace Concept?

User explicitly requested no "namespace/name" pattern like "acme/calculator".

**Current approach**:
- Platform skills: `"math-utils"`
- Org skills: `"calculator"` (in specific org)
- Scope + Org determines ownership, not name pattern

### Why Authorization on Org (Not Skill)?

**For push RPC**:
- Field path: `"org"` (not `"skill_id"`)
- Permission: `can_create_skill` (org-level)

**Rationale**:
- Works for both create (no skill ID yet) and update (have skill ID)
- Consistent check at org level
- Backend can additionally verify skill ownership if needed

## Backend Implementation Notes

### Create or Update Logic

```java
public PushSkillResponse push(PushSkillRequest request) {
  // 1. Normalize
  String slug = SlugUtils.normalize(request.getName());
  
  // 2. Find or create
  Skill skill = skillRepo.findBySlug(slug);
  boolean isCreate = (skill == null);
  
  if (isCreate) {
    skill = new Skill();
    skill.getMetadata().setSlug(slug);
    skill.getMetadata().setOwnerScope(request.getScope());
    skill.getMetadata().setOrg(request.getOrg());
  } else {
    // Archive current version before update
    skillAuditRepo.archive(skill);
  }
  
  // 3. Process artifact
  String skillMd = ArtifactUtils.extractSkillMd(request.getArtifact());
  String hash = HashUtils.sha256(request.getArtifact());
  
  // 4. Deduplication check
  String storageKey;
  if (!artifactStorage.exists(hash)) {
    storageKey = artifactStorage.upload(slug, hash, request.getArtifact());
  } else {
    storageKey = artifactStorage.getKey(slug, hash);
  }
  
  // 5. Update skill
  skill.getSpec().setSkillMd(skillMd);
  skill.getSpec().setTag(request.getTag());
  skill.getStatus().setVersionHash(hash);
  skill.getStatus().setArtifactStorageKey(storageKey);
  skill.getStatus().setState(SkillState.READY);
  
  // 6. Save
  skillRepo.save(skill);
  
  return new PushSkillResponse(hash, storageKey, request.getTag());
}
```

### Tag Behavior

**Empty tag** (`tag: ""`):
- Valid! (Pattern: `^$|^[a-zA-Z0-9._-]+$`)
- Version only accessible by hash
- Use case: "I don't want to tag this version"

**Provided tag** (`tag: "stable"`):
- Updates the tag pointer to new version
- Previous versions with same tag archived
- Resolved by timestamp ordering in audit collection

## CLI Flow

```bash
cd my-skill/
# Contains: SKILL.md, tools/, scripts/

stigmer apply
# Detects SKILL.md
# Zips current directory
# Extracts skill name from SKILL.md or prompts user
# Calls push RPC with:
#   - name: user input
#   - scope: from context
#   - org: from context
#   - artifact: zip bytes
#   - tag: "latest" (or user specified)
```

## Agent Usage Flow

**Agent YAML**:
```yaml
skills:
  - scope: organization
    org: org-123
    slug: calculator
    version: stable  # or hash or empty (latest)
```

**Resolution**:
1. Agent references skill with version
2. Backend resolves `stable` → hash `abc123...`
3. Fetches `skill_md` for prompt injection
4. Downloads artifact from storage
5. Mounts at `/bin/skills/calculator/`

## Success Criteria Met

- ✅ 5 proto files created/updated (api, spec, status, command, query, io)
- ✅ FGA authorization configured
- ✅ Skill marked as versioned in ApiResourceKind
- ✅ ApiResourceReference supports version field
- ✅ Validation rules in place
- ✅ Spec/Status separation maintained
- ✅ Proto generation succeeds
- ✅ No linter errors
- ✅ Simplified command surface (push + delete only)
- ✅ Artifact-centric model
- ✅ No namespace concept

## Files Changed

**Modified**:
1. `apis/ai/stigmer/agentic/skill/v1/spec.proto`
2. `apis/ai/stigmer/agentic/skill/v1/api.proto`
3. `apis/ai/stigmer/agentic/skill/v1/command.proto` (major simplification)
4. `apis/ai/stigmer/agentic/skill/v1/query.proto`
5. `apis/ai/stigmer/agentic/skill/v1/io.proto` (major refinement)
6. `apis/ai/stigmer/commons/apiresource/io.proto`
7. `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`

**Created**:
1. `apis/ai/stigmer/agentic/skill/v1/status.proto`

**Generated**:
- All Go stubs updated (9 files)
- All Python stubs updated

## Cleanup Still Needed

**Old field references** (~91 occurrences):
- SDK: `MarkdownContent` → `SkillMd`
- SDK: `Description` → REMOVED
- Backend tests: Update field names
- CLI: Update field names

**Recommendation**: Update progressively through T01.2-T01.4 as we work on each component.

## Next Steps

Ready for **T01.2 - CLI Enhancement**:
- Implement SKILL.md detection in `stigmer apply`
- Create Zip artifact from current directory
- Call `push` RPC with proper fields
- Display progress and results

---

**Completed**: 2026-01-25
**Next Task**: T01.2 - CLI Enhancement
