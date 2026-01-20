# Unify ApiResourceMetadata Schema Across OSS and Cloud

**Date**: 2026-01-18  
**Type**: Refactoring  
**Scope**: Proto API Definitions  
**Impact**: Schema unification enabling code reuse between OSS and Cloud

## Summary

Added `org` and `owner_scope` fields to the Stigmer OSS `ApiResourceMetadata` proto definition to achieve a unified schema with the Cloud version. This enables direct code reuse of generated proto libraries and eliminates the need for separate metadata types or wrapper objects.

## Problem Statement

Previously, the OSS and Cloud versions had divergent `ApiResourceMetadata` schemas:

**OSS Version (Before)**:
```protobuf
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  map<string, string> labels = 4;          // ← Field 4
  map<string, string> annotations = 5;      // ← Field 5
  repeated string tags = 6;
  ApiResourceMetadataVersion version = 7;
}
```

**Cloud Version**:
```protobuf
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  string org = 4;                           // ← Field 4 (multi-tenancy)
  ApiResourceOwnerScope owner_scope = 5;    // ← Field 5 (RBAC)
  map<string, string> labels = 6;
  map<string, string> annotations = 7;
  repeated string tags = 8;
  ApiResourceMetadataVersion version = 9;
}
```

**Issues**:
1. **Code Duplication**: Cloud couldn't import OSS proto libraries directly
2. **Maintenance Burden**: Two separate proto definitions to maintain
3. **Migration Complexity**: Local-to-Cloud data migration required schema transformation
4. **Development Friction**: Either fork the proto or create wrapper types

## Solution Implemented

Added the multi-tenancy fields to the OSS schema with clear documentation about their dual-mode behavior.

### Unified Schema

**OSS Version (After)**:
```protobuf
message ApiResourceMetadata {
  // Human-readable name of the resource.
  string name = 1;

  // URL-friendly identifier, unique within scope.
  string slug = 2;

  // System-generated unique identifier.
  string id = 3;

  // Organization to which this resource belongs.
  // In Local Mode: This is ignored (or defaults to "default").
  // In Cloud Mode: This is enforced by the Authorization Service.
  string org = 4;

  // Owner scope determines visibility and access control for this resource.
  // Defines who can see and access this resource.
  // In Local Mode: Defaults to identity_account or platform (depending on resource).
  // In Cloud Mode: Critical for RBAC.
  // Default: organization (set by middleware in Cloud Mode).
  ApiResourceOwnerScope owner_scope = 5 [(buf.validate.field).enum.defined_only = true];

  // Key-value labels for organization and filtering.
  map<string, string> labels = 6;

  // Key-value annotations for additional metadata.
  map<string, string> annotations = 7;

  // Tags for categorization.
  repeated string tags = 8;

  // Version information for the resource.
  ApiResourceMetadataVersion version = 9;
}
```

### Field Renumbering

To maintain compatibility with the Cloud version, existing fields were renumbered:

| Field | Before (OSS) | After (Unified) |
|-------|--------------|-----------------|
| `labels` | Field 4 | Field 6 |
| `annotations` | Field 5 | Field 7 |
| `tags` | Field 6 | Field 8 |
| `version` | Field 7 | Field 9 |

**Note**: This is a breaking change for existing OSS deployments that have persisted proto data. Migration will be required.

### Documentation of Dual-Mode Behavior

Each multi-tenancy field includes comments explaining its behavior in both contexts:

**`org` field**:
- **Local Mode**: Ignored or defaults to `"default"`
- **Cloud Mode**: Enforced by Authorization Service

**`owner_scope` field**:
- **Local Mode**: Defaults to `identity_account` or `platform` based on resource type
- **Cloud Mode**: Critical for RBAC, set by middleware to `organization`

### Enum Already Present

The `ApiResourceOwnerScope` enum was already defined in both versions identically:

```protobuf
enum ApiResourceOwnerScope {
  api_resource_owner_scope_unspecified = 0;
  platform = 1;          // Platform-owned resources
  organization = 2;      // Organization-owned resources
  identity_account = 3;  // User-owned resources
}
```

## Benefits

### 1. Single Source of Truth

**Before**:
```
stigmer/apis/           → OSS proto definitions
stigmer-cloud/apis/     → Cloud proto definitions (forked + extended)
```

**After**:
```
stigmer/apis/           → Unified proto definitions
stigmer-cloud/          → Imports stigmer/apis directly (no fork)
```

### 2. Code Reuse

Cloud backend can now import OSS-generated libraries directly:

```go
// Cloud can use OSS proto library
import "github.com/stigmer/stigmer/apis/gen/go/ai/stigmer/..."

// Same structs, no conversion needed
func CreateAgent(agent *agentv1.Agent) error {
  // agent.Metadata.Org is available
  // agent.Metadata.OwnerScope is available
}
```

### 3. Migration Path

Local exports are now Cloud-compatible:

```yaml
# OSS YAML export
apiVersion: agent.stigmer.ai/v1
kind: Agent
metadata:
  name: my-agent
  slug: my-agent
  id: agt-abc123
  org: ""                    # Empty in OSS
  owner_scope: identity_account
# ... rest of spec
```

Cloud import:
```go
// Import from OSS
agent := parseYAML(ossExport)

// Fill in org during import
agent.Metadata.Org = targetOrgId

// No schema transformation needed!
```

### 4. Enterprise-Friendly OSS

OSS users can build their own multi-tenant systems using the same schema:

- Fields are already present for multi-tenancy
- No need to fork or extend protos
- Can implement custom org/scope logic if desired

## Implementation Details

### File Modified

**Path**: `apis/ai/stigmer/commons/apiresource/metadata.proto`

**Changes**:
1. Added `org` field at position 4
2. Added `owner_scope` field at position 5 with `defined_only` validation
3. Renumbered existing fields from 4-7 to 6-9
4. Added comprehensive documentation comments

### No Behavioral Changes

This is a **schema-only** change. No code changes required because:

- Go/Python code generation will add the new fields
- Existing code that doesn't use these fields continues to work
- OSS runtime ignores these fields (empty strings and default enums)
- Cloud runtime populates and uses these fields

### Breaking Change Notice

**Proto Binary Compatibility**: This is a breaking change for persisted binary proto data because field numbers changed.

**Mitigation**:
1. OSS deployments: Data migration required to renumber fields
2. Cloud: Already using correct field numbers (no migration needed)
3. New deployments: Start with unified schema

## Testing Considerations

### OSS Testing

Verify that OSS runtime handles empty/default values correctly:

```go
// OSS should handle these gracefully
agent.Metadata.Org == ""                                    // Empty
agent.Metadata.OwnerScope == api_resource_owner_scope_unspecified  // Default
```

### Cloud Testing

Verify that Cloud runtime populates fields:

```go
// Cloud middleware should set
agent.Metadata.Org == "org-xyz789"
agent.Metadata.OwnerScope == organization
```

### Migration Testing

Test local-to-cloud data migration:

```go
// Load OSS YAML
ossAgent := loadFromYAML("oss-export.yaml")

// Populate cloud fields
ossAgent.Metadata.Org = cloudContext.OrgId
// owner_scope already set by OSS (identity_account or platform)

// Should work without schema transformation
cloudStore.Create(ossAgent)
```

## Architecture Decision

### Why Add to OSS Instead of Keeping Separate?

**Option A: Separate Schemas** (Rejected)
- ❌ Cloud must fork and maintain duplicate protos
- ❌ Code generation creates separate libraries
- ❌ Data migration requires transformation
- ❌ Increases maintenance burden

**Option B: Cloud Wrappers** (Rejected)
- ❌ Cloud code must wrap every OSS resource
- ❌ Increases code complexity
- ❌ Harder to maintain consistency

**Option C: Unified Schema** (Chosen) ✅
- ✅ Single proto definition
- ✅ Direct code reuse
- ✅ Simple data migration
- ✅ Enterprise-friendly OSS

### Is This a "Leak"?

**No.** This exposes a **capability**, not **logic** or **sensitive data**.

- Does NOT expose: Cloud-specific algorithms, billing logic, customer data
- DOES expose: Schema that supports multi-tenancy (which is beneficial)
- Enterprise OSS users can leverage these fields for their own multi-tenant systems

## Next Steps

### Immediate

- [x] Update OSS proto schema
- [ ] Regenerate proto libraries (`make protos`)
- [ ] Update Cloud to import OSS proto library
- [ ] Remove Cloud proto fork (if exists)

### Future

- [ ] Create data migration guide for existing OSS deployments
- [ ] Update Cloud backend to use OSS proto imports
- [ ] Verify all Cloud services use unified schema
- [ ] Update documentation with migration path

## Related Changes

### This Change Enables

1. **Cloud Simplification**: Remove forked proto definitions
2. **Library Consolidation**: Single proto library for both contexts
3. **Improved Testing**: Test with same proto structs in both modes
4. **Better Documentation**: Single schema reference for developers

### Future Unification Work

This sets the pattern for other proto messages that may need dual-mode support:

- Status messages (local vs cloud state)
- Spec messages (local vs cloud configuration)
- Other metadata structures

## Conclusion

This unification follows the **Open Core** model principle: a shared, powerful core that works standalone in OSS and powers the Cloud platform. By including multi-tenancy fields in OSS with clear documentation, we:

- Eliminate code duplication
- Enable seamless migration
- Empower enterprise OSS users
- Simplify Cloud development

The small cost of unused fields in OSS is vastly outweighed by the engineering benefits of a unified schema.
