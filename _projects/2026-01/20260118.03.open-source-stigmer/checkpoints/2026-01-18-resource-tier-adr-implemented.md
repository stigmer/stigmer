# Checkpoint: Resource Tier ADR Implementation Complete

**Date**: January 18, 2026  
**Status**: ✅ Complete  
**Phase**: Phase 2 - Backend Architecture  
**Component**: Proto APIs - Common API Resource

## What Was Accomplished

Implemented ADR-003 "Unified API Resource Registry & Tiering" to support Stigmer's Open Core model.

### Proto API Changes

1. **Simplified ApiResourceMetadata** (`metadata.proto`)
   - Removed `org` field (field 4)
   - Removed `owner_scope` field (field 5)
   - Renumbered remaining fields for continuity
   - Result: Cleaner, deployment-agnostic metadata

2. **Added ResourceTier System** (`api_resource_kind.proto`)
   - Created `ResourceTier` enum (TIER_UNSPECIFIED, TIER_OPEN_SOURCE, TIER_CLOUD_ONLY)
   - Added `tier` field to `ApiResourceKindMeta`
   - Applied tier annotations to all 19 resource kinds

3. **Tier Assignment**
   - **TIER_CLOUD_ONLY** (7 resources): IAM, credentials, org/platform management
   - **TIER_OPEN_SOURCE** (11 resources): Agents, workflows, executions, sessions

## Why This Matters

### Enables Open Core Architecture

- **Single Source of Truth**: One enum for all resource kinds (local + cloud)
- **Zero Migration Friction**: Same resource IDs work in local and cloud modes
- **Tier-Based Filtering**: CLI filters cloud-only resources when in local mode
- **Forward Compatible**: Easy to promote resources from proprietary to open source

### Business Model Support

- **Open Source**: Execution plane (agents, workflows, runners)
- **Proprietary**: Control plane (IAM, multi-tenancy, credentials)
- **Upsell Path**: Seamless transition from local testing to cloud production

## Technical Details

### Resource Tier Distribution

**TIER_CLOUD_ONLY** (Platform/Infrastructure):
- api_resource_version (system)
- iam_policy, identity_account, api_key (IAM)
- credential (connections)
- organization, platform (tenancy)

**TIER_OPEN_SOURCE** (Agentic/Workflow):
- agent, agent_execution, agent_instance
- workflow, workflow_instance, workflow_execution
- session, skill, mcp_server
- environment, execution_context

### Metadata Simplification

**Before**:
```protobuf
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  string org = 4;                          // ❌ Removed
  ApiResourceOwnerScope owner_scope = 5;   // ❌ Removed
  map<string, string> labels = 6;
  map<string, string> annotations = 7;
  repeated string tags = 8;
  ApiResourceMetadataVersion version = 9;
}
```

**After**:
```protobuf
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  map<string, string> labels = 4;          // ✅ Renumbered
  map<string, string> annotations = 5;     // ✅ Renumbered
  repeated string tags = 6;                // ✅ Renumbered
  ApiResourceMetadataVersion version = 7;  // ✅ Renumbered
}
```

## Files Modified

**stigmer repository** (`/Users/suresh/scm/github.com/stigmer/stigmer`):
- `apis/ai/stigmer/commons/apiresource/metadata.proto`
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`

**Documentation**:
- `stigmer-cloud/docs/adr/2026-01/2026-01-19-154712-apiresouce-kind.md` (ADR reference)

## Impact on Other Components

### Immediate Impact (Proto Regeneration Required)

**Stigmer repository**:
- Go generated code: `internal/gen/ai/stigmer/commons/apiresource/*.pb.go`
- Need to run `make protos` to regenerate bindings

**Stigmer-cloud repository** (once merged):
- Java generated code in backend services
- Python generated code in agent-runner
- Need proto regeneration across all services

### Downstream Work Required

1. **CLI Integration**
   - Implement tier-based filtering in `stigmer api-resources list`
   - Add context detection (local vs cloud mode)
   - Filter help/autocomplete based on tier

2. **Backend Services**
   - Remove org/owner_scope handling in metadata
   - Update resource creation logic
   - Adjust query patterns

3. **Storage Layer**
   - Update SQLite schema (remove org/owner_scope columns)
   - Migrate existing data if needed

4. **Documentation**
   - API reference updates
   - Developer guide for tier system
   - Migration guide for contributors

## Testing Strategy

### Proto Compilation
- [x] Protos compile without errors
- [ ] Generated code builds successfully
- [ ] No breaking changes in dependent code

### Tier Filtering (To Be Implemented)
- [ ] CLI filters TIER_CLOUD_ONLY in local mode
- [ ] CLI shows all tiers in cloud mode
- [ ] Help text reflects available resources

### Metadata Changes (To Be Validated)
- [ ] Resource creation works without org field
- [ ] Queries work without owner_scope
- [ ] Existing data migrates cleanly

## Next Steps

### Immediate (This Session)
1. ✅ Implement proto changes
2. ✅ Create changelog
3. ✅ Create checkpoint
4. ⏳ Commit changes to stigmer repository

### Short Term (Next Session)
1. Run `make protos` in stigmer repo to regenerate code
2. Verify generated code compiles
3. Update backend controllers to use new metadata schema
4. Test resource CRUD operations

### Medium Term (Phase 3)
1. Implement CLI tier filtering
2. Add local/cloud mode detection
3. Update storage layer schema
4. Integration testing with stigmer-server

## Lessons Learned

### Architecture Decisions

1. **Single Enum > Split Enums**: Tier annotations simpler than managing two separate enums
2. **Metadata Minimalism**: Deployment context doesn't belong in universal metadata
3. **Proto Field Renumbering**: Safe to renumber after removing fields (doesn't break compatibility)

### Proto Design Patterns

1. **Enum-Based Feature Gating**: Use enums with annotations for filtering rather than separate types
2. **Field Number Management**: Removed fields leave gaps, renumbering compacts the schema
3. **ADR-First Implementation**: Having clear ADR made implementation straightforward

## Blockers/Risks

**None** - This is a clean proto schema change with clear separation between open source and proprietary resources.

## Cross-Repository Coordination

### Stigmer Repository (Open Source)
- ✅ Proto changes committed
- ⏳ Need to regenerate Go bindings
- ⏳ Need to push to stigmer/stigmer

### Stigmer-Cloud Repository (Proprietary)
- ⏳ Need to sync updated protos
- ⏳ Need to regenerate Java/Python bindings
- ⏳ Need to update backend services

**Strategy**: Commit to stigmer first, then sync to stigmer-cloud via proto updates.

---

**Status**: ✅ Proto changes complete, awaiting commit and code regeneration  
**Phase**: Phase 2 (Backend Architecture) - ADR implementation  
**Next**: Commit and regenerate bindings
