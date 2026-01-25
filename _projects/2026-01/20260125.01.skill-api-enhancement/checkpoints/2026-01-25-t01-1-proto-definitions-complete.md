# Checkpoint: T01.1 Proto API Definitions Complete

**Date**: 2026-01-25  
**Task**: T01.1 - Proto API Definitions  
**Status**: ✅ COMPLETED  
**Duration**: ~2 hours (including refinements based on user feedback)

## Accomplishments

### Proto Files Implemented (8 files)

1. ✅ **spec.proto** - Updated with `skill_md` and `tag` fields
2. ✅ **status.proto** - Created new file with SkillStatus and SkillState enum
3. ✅ **api.proto** - Updated to use custom SkillStatus
4. ✅ **io.proto** - Redesigned with name-based PushSkillRequest
5. ✅ **command.proto** - Simplified to only `push` and `delete` RPCs
6. ✅ **query.proto** - Added `getByTag` and `getByHash` RPCs
7. ✅ **ApiResourceReference** - Added `version` field for versioned references
8. ✅ **ApiResourceKind** - Marked skill as `is_versioned: true`

###Key Design Decisions Applied

1. **Single-Phase Push Operation** - `push` handles both create and update
2. **Name-Based Targeting** - User provides readable name, backend normalizes to slug
3. **No Namespace Concept** - Simple skill names (no "namespace/name" pattern)
4. **Spec/Status Separation** - Clear separation of user intent vs system state
5. **Content-Addressable Storage** - SHA256 hash for deduplication
6. **Artifact-Centric Model** - Zip with SKILL.md is the source of truth

### Validation

- ✅ `make lint` - No errors
- ✅ `make fmt` - Files formatted
- ✅ `make go-stubs` - Generated successfully
- ✅ All proto patterns follow Stigmer standards

## What Was Built

### PushSkillRequest (Final Design)

```protobuf
message PushSkillRequest {
  string name = 1;                      // User-provided (normalized to slug)
  ApiResourceOwnerScope scope = 2;      // platform or organization
  string org = 3;                       // Org ID (if scope = org)
  bytes artifact = 4;                   // Zip with SKILL.md
  string tag = 5;                       // Optional version tag
}
```

**Simplifications from initial design**:
- Removed: `skill_id` field (no longer needed)
- Removed: Separate `create`, `update`, `apply` RPCs
- Added: Name-based targeting with backend normalization

### SkillCommandController (Final Service)

```protobuf
service SkillCommandController {
  rpc push(PushSkillRequest) returns (PushSkillResponse);
  rpc delete(SkillId) returns (Skill);
}
```

**Authorization**: Org-level `can_create_skill` permission (works for both create and update)

## Breaking Changes

**⚠️ As requested**: No backward compatibility maintained

**Old → New field names**:
- `markdown_content` → `skill_md`
- `description` → REMOVED

**Cleanup needed** (~91 references):
- SDK Go package
- Backend controller tests
- CLI code
- Examples

**Plan**: Update progressively through T01.2-T01.4 as we work on each component

## Files Changed

**Modified**:
- `apis/ai/stigmer/agentic/skill/v1/spec.proto`
- `apis/ai/stigmer/agentic/skill/v1/api.proto`
- `apis/ai/stigmer/agentic/skill/v1/command.proto`
- `apis/ai/stigmer/agentic/skill/v1/query.proto`
- `apis/ai/stigmer/agentic/skill/v1/io.proto`
- `apis/ai/stigmer/commons/apiresource/io.proto`
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`

**Created**:
- `apis/ai/stigmer/agentic/skill/v1/status.proto`

**Generated**:
- All Go stubs (9 files)
- All Python stubs

## User Feedback Incorporated

### Iteration 1: Initial Design
- Standard create/update/push pattern
- `skill_id` in PushSkillRequest

### Iteration 2: After User Feedback
- **Simplified to single push operation** (user: "push and delete only")
- **Name-based targeting** (user: "take name, backend normalizes to slug")
- **Removed namespace concept** (user: "do not introduce that new concept")
- **Fields from ApiResourceReference** (user: "take scope, org, slug - not kind, not version")

## Documentation Created

- **Changelog**: `_changelog/2026-01/2026-01-25-143037-implement-skill-api-proto-definitions.md`
- **Execution Log**: `tasks/T01_1_execution_v2.md`
- **Cleanup Plan**: `tasks/T01_1_cleanup_needed.md`

## Success Criteria Met

- ✅ All 5 proto files created/updated following standards
- ✅ FGA authorization configured for all RPCs
- ✅ Skill registered in ApiResourceKind enum as versioned
- ✅ ApiResourceReference supports version field
- ✅ buf.validate constraints in place
- ✅ Proto follows Spec/Status separation
- ✅ Proto generation succeeds (Go + Python)
- ✅ No linter errors
- ✅ Simplified command surface (push + delete only)
- ✅ Artifact-centric model implemented

## Ready for Next Phase

**T01.2 - CLI Enhancement** is ready to start:
- Proto definitions are complete and stable
- Push RPC signature is finalized
- SKILL.md detection can be implemented
- Zip artifact creation can proceed
- CLI can call push RPC with proper fields

## References

- Design Decisions: `design-decisions/`
- Task Plan: `tasks/T01_0_plan.md`
- Execution Log: `tasks/T01_1_execution_v2.md`
- Changelog: `_changelog/2026-01/2026-01-25-143037-implement-skill-api-proto-definitions.md`

---

**Next Task**: T01.2 - CLI Enhancement (SKILL.md detection and push implementation)
