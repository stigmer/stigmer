# Changelog: Implement Skill API Proto Definitions with Versioning Support

**Date**: 2026-01-25  
**Type**: Feature (Proto API)  
**Scope**: apis/skill, apis/commons  
**Task**: T01.1 - Proto API Definitions

## Summary

Implemented complete versioned Skill API resource following Stigmer proto standards with simplified artifact-centric workflow. Removed separate create/update RPCs in favor of single `push` operation that handles both creation and updates through artifact uploads.

## Changes

### Proto API Definitions Created/Updated (8 files)

#### 1. Skill Spec Proto (`apis/ai/stigmer/agentic/skill/v1/spec.proto`)

**Changes**:
- Field rename: `markdown_content` → `skill_md` (clearer, format-explicit)
- Removed: `description` field (not needed in spec)
- Added: `tag` field (optional, mutable version pointer)
- Validation: Pattern for tag format `^$|^[a-zA-Z0-9._-]+$`

**Rationale**: Spec contains only user-provided fields (user intent). `skill_md` explicitly indicates SKILL.md content for prompt injection.

#### 2. Skill Status Proto (`apis/ai/stigmer/agentic/skill/v1/status.proto`) - NEW FILE

**Created**:
- `SkillStatus` message with system-managed fields:
  - `audit` (ApiResourceAudit at field 99)
  - `version_hash` (SHA256, 64 hex chars) - immutable version identifier
  - `artifact_storage_key` (storage location)
  - `state` (SkillState enum)
- `SkillState` enum: UNSPECIFIED, UPLOADING, READY, FAILED

**Rationale**: Status contains only system-generated fields (observed state), clear separation from user intent.

#### 3. Skill API Proto (`apis/ai/stigmer/agentic/skill/v1/api.proto`)

**Changes**:
- Status type changed: `ApiResourceAuditStatus` → `SkillStatus`
- Added: `SkillList` message for paginated results
- Updated: Documentation (removed namespace references)

#### 4. Skill I/O Proto (`apis/ai/stigmer/agentic/skill/v1/io.proto`) - MAJOR REDESIGN

**PushSkillRequest redesigned** (artifact-centric approach):
```protobuf
message PushSkillRequest {
  string name = 1;              // User-provided name (backend normalizes to slug)
  ApiResourceOwnerScope scope = 2;  // platform or organization
  string org = 3;               // Org ID (required if scope = org)
  bytes artifact = 4;           // Zip file containing SKILL.md
  string tag = 5;               // Optional version tag
}
```

**Previous design**: Required `skill_id` (two-phase: create → push)  
**New design**: Name-based targeting (single-phase: push handles both create and update)

**Added messages**:
- `PushSkillResponse` (returns version_hash, artifact_storage_key, tag)
- `GetSkillByTagRequest` (slug + tag for resolution)
- `GetSkillByHashRequest` (slug + exact hash)

**Rationale**: 
- Simplified workflow: one operation instead of two
- No weird intermediate states (empty skill_md)
- Artifact-driven model (Zip with SKILL.md is source of truth)

#### 5. Skill Command Proto (`apis/ai/stigmer/agentic/skill/v1/command.proto`) - SIMPLIFIED

**Service simplified** to only:
```protobuf
rpc push(PushSkillRequest) returns (PushSkillResponse);
rpc delete(SkillId) returns (Skill);
```

**Removed RPCs**: `create`, `update`, `apply`

**Authorization for push**:
- Resource kind: `organization` (not skill)
- Permission: `can_create_skill`
- Field path: `"org"`
- Works for both create and update (org-level check)

**Backend workflow documented** in proto comments:
1. Normalize name to slug
2. Find or create skill resource
3. Extract SKILL.md from artifact
4. Calculate SHA256 hash
5. Store artifact (deduplicated)
6. Update spec and status
7. Archive previous version (if update)

#### 6. Skill Query Proto (`apis/ai/stigmer/agentic/skill/v1/query.proto`)

**Added RPCs**:
- `getByTag(GetSkillByTagRequest)` - Resolve tag to latest version
- `getByHash(GetSkillByHashRequest)` - Get specific version by hash

**Existing RPCs**: `get`, `getByReference`

#### 7. ApiResourceReference Enhancement (`apis/ai/stigmer/commons/apiresource/io.proto`)

**Added field**:
```protobuf
string version = 5;  // Optional: empty/"latest"/tag/hash
```

**Validation pattern**: `^$|^latest$|^[a-zA-Z0-9._-]+$|^[a-f0-9]{64}$`

**Supports three formats**:
1. Empty/unset → "latest" (default)
2. Tag name → Resolve to version with tag (e.g., "stable", "v1.0")
3. Exact hash → Immutable reference (64 hex chars)

**Rationale**: Enable versioned resource references across all API resources (Skills now, extensible to others later).

#### 8. ApiResourceKind Enum (`apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`)

**Updated**: `skill` enum metadata `is_versioned: false` → `is_versioned: true`

## Design Decisions

### 1. Simplified Push Operation (Single-Phase)

**Decision**: Remove separate `create`/`update` RPCs, use only `push`

**Rationale**:
- **Problem with two-phase**: Create empty skill → weird intermediate state with empty `skill_md` (invalid!)
- **Solution**: Artifact-driven model where Zip with SKILL.md is the source of truth
- **Benefit**: One operation creates/updates everything, no invalid states

### 2. Name-Based Targeting (Not Slug)

**Decision**: User provides readable `name`, backend normalizes to `slug`

**Example**: User provides `"Math Utils"` → backend normalizes to `"math-utils"`

**Rationale**:
- User-friendly API (readable names)
- Backend handles normalization consistently
- Same logic for create and update

### 3. No Namespace Concept

**Decision**: Simple skill names only (no "acme/calculator" pattern)

**Format**:
- Platform skills: `"math-utils"`
- Org skills: `"calculator"` (within specific org)
- Ownership determined by `scope` + `org`, not name pattern

**Rationale**: User requested no namespace concept to keep skill naming simple.

### 4. Tag Validation

**Pattern**: `^$|^[a-zA-Z0-9._-]+$`

**Behavior**:
- Empty string (`""`) IS valid → version only accessible by hash
- With value (`"stable"`) → version accessible by tag AND hash

**Use case for empty**: User saying "I don't want to tag this version"

### 5. Authorization Strategy

**For push RPC**:
- Resource kind: `organization` (not `skill`)
- Field path: `"org"`

**Rationale**: 
- Works for both create (no skill ID yet) and update (have skill ID)
- Consistent org-level permission check
- Backend can additionally verify skill ownership if needed

### 6. Spec vs Status Separation

**Spec (User Intent)**:
- `skill_md` - SKILL.md content
- `tag` - Optional version pointer

**Status (System State)**:
- `version_hash` - SHA256 hash (immutable)
- `artifact_storage_key` - Storage location
- `state` - Lifecycle state
- `audit` - Timestamps

**Rationale**: Follow Kubernetes pattern - user owns spec, system owns status.

### 7. Content-Addressable Storage

**Behavior**: SHA256 hash from Zip content → Same content = same hash = single storage copy

**Deduplication**:
```java
String hash = calculateSHA256(zipContent);
if (artifactStorage.exists(hash)) {
    // Skip re-upload, just update metadata/tags
} else {
    artifactStorage.upload(hash, zipContent);
}
```

**Benefits**:
- Efficiency: No duplicate storage
- Integrity: Hash verifies content not corrupted
- Immutability: Hash changes if content changes

## Backend Implementation Notes

### Create or Update Flow

```java
public PushSkillResponse push(PushSkillRequest request) {
  // 1. Normalize name to slug
  String slug = SlugUtils.normalize(request.getName());
  
  // 2. Find or create skill
  Skill skill = skillRepo.findBySlug(slug);
  boolean isCreate = (skill == null);
  
  if (isCreate) {
    skill = createNewSkill(slug, request.getScope(), request.getOrg());
  } else {
    skillAuditRepo.archive(skill);  // Archive before update
  }
  
  // 3. Process artifact
  String skillMd = ArtifactUtils.extractSkillMd(request.getArtifact());
  String hash = HashUtils.sha256(request.getArtifact());
  
  // 4. Deduplication
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

### MongoDB Schema

**Main collection** (`skills`): Current state only (one record per skill)
**Audit collection** (`skill_audit`): Complete history (immutable snapshots)

**Archival trigger**: Every modification to main collection
**Version ordering**: Use `status.audit.spec_audit.updated_at` timestamp (no separate version_number field)

### Tag Resolution

**Query with tag "stable"**:
1. Check main table: if `spec.tag == "stable"` → return
2. Else, query audit: find latest by timestamp with `spec.tag == "stable"`

**Query with hash**:
1. Check main table: if `status.version_hash == hash` → return
2. Else, query audit: find exact match on `status.version_hash`

## CLI Integration

### Expected Flow

```bash
cd my-skill/
# Contains: SKILL.md, tools/, scripts/

stigmer apply
# Detects SKILL.md
# Zips current directory
# Extracts skill name from SKILL.md or prompts user
# Calls push RPC with:
#   - name: user input (e.g., "Calculator")
#   - scope: from context (org or platform)
#   - org: from context (if org scope)
#   - artifact: zip bytes
#   - tag: "latest" or user specified
```

### User Experience

**First push** (create):
```
$ stigmer apply
✓ Detected SKILL.md
✓ Skill name: calculator
✓ Creating skill artifact...
✓ Uploading to Stigmer...
✓ Skill created: calculator
  Version: abc123def456... (stable)
  Storage: skills/calculator_abc123def456.zip
```

**Subsequent push** (update):
```
$ stigmer apply
✓ Detected SKILL.md
✓ Skill name: calculator
✓ Creating skill artifact...
✓ Uploading to Stigmer...
✓ Skill updated: calculator
  Version: xyz789abc123... (stable)
  Previous version archived
```

## Agent Usage

### Agent YAML

```yaml
skills:
  - scope: organization
    org: org-123
    slug: calculator
    version: stable  # or hash or empty (latest)
```

### Resolution Flow

1. Agent references skill with version
2. Backend resolves `stable` → hash `abc123...`
3. Fetches `skill_md` for prompt injection
4. Downloads artifact from storage
5. Mounts at `/bin/skills/calculator/`

## Validation Results

All checks passed:
- ✅ `make lint` - No errors
- ✅ `make fmt` - Files formatted
- ✅ `make go-stubs` - Generated successfully
- ✅ All Go stubs compile
- ✅ Validation patterns in place

## Breaking Changes

**⚠️ Breaking**: This completely replaces the previous Skill API (as requested, no backward compatibility)

**Old field names** → **New field names**:
- `markdown_content` → `skill_md`
- `description` → REMOVED

**Old RPCs** → **New RPCs**:
- `create` → REMOVED (use `push`)
- `update` → REMOVED (use `push`)
- `apply` → REMOVED (use `push`)

**Cleanup needed** (~91 references in codebase):
- SDK Go: `MarkdownContent` → `SkillMd`
- Backend tests: Update field names
- CLI code: Update references
- Will be handled progressively in T01.2-T01.4

## Files Modified

**Proto files**:
- `apis/ai/stigmer/agentic/skill/v1/spec.proto`
- `apis/ai/stigmer/agentic/skill/v1/api.proto`
- `apis/ai/stigmer/agentic/skill/v1/command.proto`
- `apis/ai/stigmer/agentic/skill/v1/query.proto`
- `apis/ai/stigmer/agentic/skill/v1/io.proto`
- `apis/ai/stigmer/commons/apiresource/io.proto`
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`

**Proto files created**:
- `apis/ai/stigmer/agentic/skill/v1/status.proto`

**Generated files**:
- All Go stubs regenerated (9 files in `apis/stubs/go/ai/stigmer/agentic/skill/v1/`)
- All Python stubs regenerated

## Next Steps

**T01.2 - CLI Enhancement**:
- Implement SKILL.md detection in `stigmer apply`
- Create Zip artifact from current directory
- Call `push` RPC with proper fields (name, scope, org, artifact, tag)
- Display progress and results

**T01.3 - Backend Implementation**:
- Implement `SkillCommandHandler.push()`
- Implement `SkillQueryHandler.getByTag()` and `getByHash()`
- Create storage abstraction (local + cloud)
- Implement MongoDB audit collection archival
- Add deduplication logic

**T01.4 - Agent Integration**:
- Update agent proto to use versioned skill references
- Remove inline skill feature
- Implement skill resolution logic
- Update prompt engineering to inject `skill_md`

## References

- Design Decisions: `_projects/2026-01/20260125.01.skill-api-enhancement/design-decisions/`
- Task Plan: `_projects/2026-01/20260125.01.skill-api-enhancement/tasks/T01_0_plan.md`
- Execution Log: `_projects/2026-01/20260125.01.skill-api-enhancement/tasks/T01_1_execution_v2.md`
