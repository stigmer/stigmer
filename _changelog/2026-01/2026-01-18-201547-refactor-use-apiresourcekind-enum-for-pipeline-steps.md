# Refactor: Use ApiResourceKind Enum for Pipeline Steps

**Date**: 2026-01-18  
**Type**: Refactoring  
**Scope**: Backend Infrastructure (Go)  
**Impact**: Architecture alignment with Java implementation

## Summary

Refactored the Go backend pipeline infrastructure to use the strongly-typed `ApiResourceKind` enum and extract metadata from proto options, eliminating hard-coded string literals. This aligns the Go implementation with the existing Java architecture pattern.

## Problem Statement

The pipeline steps were using hard-coded string literals for resource identification:

```go
// Before - hard-coded strings
AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, "Agent"))
AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent"))  
AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent"))
```

**Issues**:
1. No type safety - strings could be misspelled
2. Manual maintenance required - changes to ID prefixes required code updates
3. Inconsistency with Java implementation
4. Duplicate information - metadata already exists in proto options

## Solution Implemented

Created metadata utility package and updated all pipeline steps to use the `ApiResourceKind` enum with automatic metadata extraction from proto options.

### 1. Created Metadata Utility Package

**Location**: `backend/libs/go/apiresource/`

**Files created**:
- `metadata.go` - Core utilities for enum and metadata extraction
- `metadata_test.go` - Comprehensive test coverage
- `README.md` - Documentation and examples

**Key functions**:
```go
// Get enum from proto message
GetKindEnum(msg proto.Message) (ApiResourceKind, error)

// Get metadata from enum (extracts from proto options)
GetKindMeta(kind ApiResourceKind) (*ApiResourceKindMeta, error)

// Convenience methods
GetIdPrefix(kind ApiResourceKind) (string, error)
GetKindName(kind ApiResourceKind) (string, error)
GetDisplayName(kind ApiResourceKind) (string, error)
```

### 2. Updated Pipeline Steps

**Modified files**:
- `backend/libs/go/grpc/request/pipeline/steps/defaults.go`
- `backend/libs/go/grpc/request/pipeline/steps/duplicate.go`
- `backend/libs/go/grpc/request/pipeline/steps/persist.go`

**Changes**:
```go
// Before
func NewSetDefaultsStep[T proto.Message](idPrefix string) *SetDefaultsStep[T]

// After - uses enum
func NewSetDefaultsStep[T proto.Message](kind ApiResourceKind) *SetDefaultsStep[T]
```

Steps now extract metadata internally:
```go
// Extract ID prefix from proto options
idPrefix, err := apiresource.GetIdPrefix(s.kind)
metadata.Id = generateID(idPrefix)  // e.g., "agt-1705678901234567890"
```

### 3. Updated Controllers

**Modified files**:
- `backend/services/stigmer-server/pkg/controllers/agent/create.go`
- `backend/services/stigmer-server/pkg/controllers/agent/update.go`

**Changes**:
```go
// After - enum-based
kind := apiresourcekind.ApiResourceKind_agent

return pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, kind)).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent](kind)).
    AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, kind)).
    Build()
```

### 4. Updated All Test Files

**Modified test files**:
- `defaults_test.go`
- `duplicate_test.go`
- `persist_test.go`
- `integration_test.go`

All tests now use `apiresourcekind.ApiResourceKind_agent` instead of string literals.

## Technical Details

### Proto Options Integration

The implementation leverages existing proto options defined in `api_resource_kind.proto`:

```protobuf
agent = 40 [(kind_meta) = {
    group: agentic
    version: v1
    name: "Agent"
    display_name: "Agent"
    id_prefix: "agt"              // Automatically extracted
    is_versioned: false
    not_search_indexed: false
    tier: TIER_OPEN_SOURCE
}];
```

The Go code uses proto reflection and extensions to access this metadata:
```go
// Get enum value descriptor
valueDesc := kind.Descriptor().Values().ByNumber(protoreflect.EnumNumber(kind))

// Extract kind_meta extension
meta := proto.GetExtension(valueDesc.Options(), apiresourcekind.E_KindMeta)
```

### Architecture Alignment with Java

This refactoring aligns the Go backend with the existing Java pattern:

**Java**:
```java
ApiResourceRef agentRef = ApiResourceRef.newBuilder()
        .setKind(ApiResourceKind.agent.name())  // Uses enum
        .setId(agentId)
        .build();
```

**Go (now)**:
```go
kind := apiresourcekind.ApiResourceKind_agent
meta, _ := apiresource.GetKindMeta(kind)
// meta.IdPrefix == "agt"
// meta.Name == "Agent"
```

## Benefits

1. **Type Safety** - Compile-time checking prevents typos and incorrect kind values
2. **Single Source of Truth** - Metadata lives in proto definitions only
3. **No Manual Maintenance** - ID prefix changes in proto automatically propagate
4. **Consistency** - Same pattern as Java implementation
5. **Future-Proof** - New resource kinds work automatically
6. **Better IDE Support** - Autocomplete for enum values

## Impact

### Files Changed
- **9 modified files** (7 step files + 2 controller files)
- **3 new files** (metadata package)

### Build Status
All packages build successfully:
- ✅ `backend/libs/go/apiresource`
- ✅ `backend/libs/go/grpc/request/pipeline/steps`
- ✅ `backend/services/stigmer-server/pkg/controllers/agent`

### Breaking Changes
None for external consumers. Internal controller code updated to use new API.

## Migration Pattern

For new controllers or resources, follow this pattern:

```go
// 1. Define the kind constant
kind := apiresourcekind.ApiResourceKind_agent

// 2. Pass enum to pipeline steps
pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, kind)).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent](kind)).
    AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, kind)).
    Build()
```

The steps will automatically extract metadata from the enum's proto options.

## Related Work

This refactoring was prompted by user feedback noting the inconsistency between Go and Java implementations. The user specifically pointed out:
- Java already extracts metadata from proto options
- Hard-coded strings are error-prone
- The enum should be the single source of truth

## Testing

All existing integration tests updated and passing. The new `metadata_test.go` provides comprehensive coverage of the metadata extraction utilities.

## Next Steps

This pattern should be applied to other pipeline steps and controllers as they are created or refactored.

## References

- Proto definition: `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`
- Metadata package: `backend/libs/go/apiresource/`
- Example usage: `backend/services/stigmer-server/pkg/controllers/agent/create.go`
